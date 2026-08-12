import { randomUUID } from "node:crypto";

import {
  AiBudgetScope,
  AiUsageStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { db } from "@/lib/db";
import type { AiResearchConfig } from "@/lib/research/ai/config";

const USD_SCALE = 1_000_000;
const GLOBAL_SCOPE_KEY = "GLOBAL";

type BudgetDatabase = Pick<PrismaClient, "$transaction">;

export type AiBudgetErrorCode =
  | "AI_GLOBAL_BUDGET_EXHAUSTED"
  | "AI_USER_BUDGET_EXHAUSTED"
  | "AI_JOB_BUDGET_EXHAUSTED"
  | "AI_JOB_TOKEN_LIMIT_EXCEEDED"
  | "AI_USAGE_ALREADY_RESERVED"
  | "AI_USAGE_RECONCILIATION_REQUIRED";

export class AiBudgetError extends Error {
  constructor(
    readonly code: AiBudgetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiBudgetError";
  }
}

export type AiUsageReservation = {
  usageId: string;
  idempotencyKey: string;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  reservedCostUsd: number;
};

export type ActualAiUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  providerRequestId: string | null;
};

export function utcMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function estimateInputTokenUpperBound(input: string) {
  return Math.max(1, Buffer.byteLength(input, "utf8"));
}

function roundUsdUp(value: number) {
  return Math.ceil((value - Number.EPSILON) * USD_SCALE) / USD_SCALE;
}

export function calculateAiCostUsd(
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
  },
  pricing: {
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  },
) {
  const cached = Math.min(
    Math.max(0, usage.cachedInputTokens ?? 0),
    Math.max(0, usage.inputTokens),
  );
  const uncached = Math.max(0, usage.inputTokens) - cached;
  return roundUsdUp(
    (uncached * pricing.inputUsdPerMillion +
      cached * pricing.cachedInputUsdPerMillion +
      Math.max(0, usage.outputTokens) * pricing.outputUsdPerMillion) /
      1_000_000,
  );
}

function number(value: Prisma.Decimal | number) {
  return typeof value === "number" ? value : value.toNumber();
}

async function withSerializableRetry<T>(
  database: BudgetDatabase,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Unreachable transaction retry state.");
}

async function ensureBudgetPeriod(
  transaction: Prisma.TransactionClient,
  input: {
    scope: AiBudgetScope;
    scopeKey: string;
    userId: string | null;
    periodStart: Date;
    limitUsd: number;
  },
) {
  const period = await transaction.aiBudgetPeriod.upsert({
    where: {
      scopeKey_periodStart: {
        scopeKey: input.scopeKey,
        periodStart: input.periodStart,
      },
    },
    update: {},
    create: input,
  });

  await transaction.$queryRaw`
    SELECT "id"
    FROM "AiBudgetPeriod"
    WHERE "id" = ${period.id}
    FOR UPDATE
  `;
  const locked = await transaction.aiBudgetPeriod.findUniqueOrThrow({
    where: { id: period.id },
  });
  const consumed = number(locked.reservedUsd) + number(locked.usedUsd);
  const effectiveLimit = Math.max(consumed, input.limitUsd);
  if (number(locked.limitUsd) !== effectiveLimit) {
    return transaction.aiBudgetPeriod.update({
      where: { id: locked.id },
      data: { limitUsd: effectiveLimit },
    });
  }
  return locked;
}

function assertBudgetCapacity(
  period: {
    reservedUsd: Prisma.Decimal;
    usedUsd: Prisma.Decimal;
    limitUsd: Prisma.Decimal;
  },
  amountUsd: number,
  code: "AI_GLOBAL_BUDGET_EXHAUSTED" | "AI_USER_BUDGET_EXHAUSTED",
) {
  if (
    number(period.reservedUsd) + number(period.usedUsd) + amountUsd >
    number(period.limitUsd) + Number.EPSILON
  ) {
    throw new AiBudgetError(
      code,
      code === "AI_GLOBAL_BUDGET_EXHAUSTED"
        ? "The monthly AI budget is exhausted."
        : "Your monthly AI research quota is exhausted.",
    );
  }
}

export async function reserveAiUsage(
  input: {
    idempotencyKey: string;
    userId: string;
    researchJobId: string;
    agentRunId?: string | null;
    operation: string;
    promptVersion: string;
    attemptNumber: number;
    reservedInputTokens: number;
    reservedOutputTokens: number;
    config: AiResearchConfig;
    now?: Date;
  },
  database: BudgetDatabase = db,
): Promise<AiUsageReservation> {
  const reservedCostUsd = calculateAiCostUsd(
    {
      inputTokens: input.reservedInputTokens,
      outputTokens: input.reservedOutputTokens,
    },
    input.config.pricing,
  );
  const periodStart = utcMonthStart(input.now);

  return withSerializableRetry(database, async (transaction) => {
    const existing = await transaction.aiUsage.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      throw new AiBudgetError(
        existing.status === AiUsageStatus.UNCONFIRMED
          ? "AI_USAGE_RECONCILIATION_REQUIRED"
          : "AI_USAGE_ALREADY_RESERVED",
        existing.status === AiUsageStatus.UNCONFIRMED
          ? "A prior provider attempt requires cost reconciliation."
          : "This provider attempt has already been reserved.",
      );
    }

    const global = await ensureBudgetPeriod(transaction, {
      scope: AiBudgetScope.GLOBAL,
      scopeKey: GLOBAL_SCOPE_KEY,
      userId: null,
      periodStart,
      limitUsd: input.config.globalMonthlyBudgetUsd,
    });
    const user = await ensureBudgetPeriod(transaction, {
      scope: AiBudgetScope.USER,
      scopeKey: input.userId,
      userId: input.userId,
      periodStart,
      limitUsd: input.config.userMonthlyBudgetUsd,
    });
    assertBudgetCapacity(global, reservedCostUsd, "AI_GLOBAL_BUDGET_EXHAUSTED");
    assertBudgetCapacity(user, reservedCostUsd, "AI_USER_BUDGET_EXHAUSTED");

    await transaction.$queryRaw`
      SELECT "id"
      FROM "ResearchJob"
      WHERE "id" = ${input.researchJobId} AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    const researchJob = await transaction.researchJob.findFirst({
      where: { id: input.researchJobId, userId: input.userId },
    });
    if (!researchJob?.aiTokenLimit || !researchJob.aiCostLimitUsd) {
      throw new AiBudgetError(
        "AI_JOB_BUDGET_EXHAUSTED",
        "This research job does not have an approved AI budget.",
      );
    }
    const reservedTokens =
      input.reservedInputTokens + input.reservedOutputTokens;
    if (
      researchJob.aiReservedTokens + researchJob.aiUsedTokens + reservedTokens >
      researchJob.aiTokenLimit
    ) {
      throw new AiBudgetError(
        "AI_JOB_TOKEN_LIMIT_EXCEEDED",
        "This research job reached its token limit.",
      );
    }
    if (
      number(researchJob.aiReservedCostUsd) +
        number(researchJob.aiUsedCostUsd) +
        reservedCostUsd >
      number(researchJob.aiCostLimitUsd) + Number.EPSILON
    ) {
      throw new AiBudgetError(
        "AI_JOB_BUDGET_EXHAUSTED",
        "This research job reached its cost limit.",
      );
    }

    await Promise.all([
      transaction.aiBudgetPeriod.update({
        where: { id: global.id },
        data: { reservedUsd: { increment: reservedCostUsd } },
      }),
      transaction.aiBudgetPeriod.update({
        where: { id: user.id },
        data: { reservedUsd: { increment: reservedCostUsd } },
      }),
      transaction.researchJob.update({
        where: { id: researchJob.id },
        data: {
          aiReservedTokens: { increment: reservedTokens },
          aiReservedCostUsd: { increment: reservedCostUsd },
        },
      }),
    ]);

    const usage = await transaction.aiUsage.create({
      data: {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        status: AiUsageStatus.RESERVED,
        userId: input.userId,
        researchJobId: researchJob.id,
        agentRunId: input.agentRunId ?? null,
        periodStart,
        provider: input.config.provider,
        model: input.config.model,
        operation: input.operation,
        promptVersion: input.promptVersion,
        pricingVersion: input.config.pricingVersion,
        inputCostPerMillionUsd: input.config.pricing.inputUsdPerMillion,
        cachedInputCostPerMillionUsd:
          input.config.pricing.cachedInputUsdPerMillion,
        outputCostPerMillionUsd: input.config.pricing.outputUsdPerMillion,
        reservedInputTokens: input.reservedInputTokens,
        reservedOutputTokens: input.reservedOutputTokens,
        reservedCostUsd,
        attemptNumber: input.attemptNumber,
      },
    });

    return {
      usageId: usage.id,
      idempotencyKey: usage.idempotencyKey,
      reservedInputTokens: usage.reservedInputTokens,
      reservedOutputTokens: usage.reservedOutputTokens,
      reservedCostUsd: number(usage.reservedCostUsd),
    };
  });
}

async function lockUsageAndCounters(
  transaction: Prisma.TransactionClient,
  usageId: string,
) {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "AiUsage"
    WHERE "id" = ${usageId}
    FOR UPDATE
  `;
  const usage = await transaction.aiUsage.findUniqueOrThrow({
    where: { id: usageId },
  });
  if (usage.status !== AiUsageStatus.RESERVED) return { usage, periods: [] };

  const periods = await transaction.aiBudgetPeriod.findMany({
    where: {
      periodStart: usage.periodStart,
      scopeKey: { in: [GLOBAL_SCOPE_KEY, usage.userId ?? ""] },
    },
  });
  periods.sort((left, right) => {
    if (left.scope !== right.scope)
      return left.scope === AiBudgetScope.GLOBAL ? -1 : 1;
    return left.scopeKey.localeCompare(right.scopeKey);
  });
  for (const period of periods) {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "AiBudgetPeriod"
      WHERE "id" = ${period.id}
      FOR UPDATE
    `;
  }
  if (usage.researchJobId) {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "ResearchJob"
      WHERE "id" = ${usage.researchJobId}
      FOR UPDATE
    `;
  }
  return { usage, periods };
}

export async function settleAiUsageInTransaction(
  transaction: Prisma.TransactionClient,
  usageId: string,
  actual: ActualAiUsage,
) {
  const { usage, periods } = await lockUsageAndCounters(transaction, usageId);
  if (usage.status !== AiUsageStatus.RESERVED) return usage;
  const pricing = {
    inputUsdPerMillion: number(usage.inputCostPerMillionUsd),
    cachedInputUsdPerMillion: number(usage.cachedInputCostPerMillionUsd),
    outputUsdPerMillion: number(usage.outputCostPerMillionUsd),
  };
  const actualCostUsd = calculateAiCostUsd(actual, pricing);
  const actualTokens = actual.inputTokens + actual.outputTokens;
  const reservedTokens = usage.reservedInputTokens + usage.reservedOutputTokens;
  if (
    actualTokens > reservedTokens ||
    actualCostUsd > number(usage.reservedCostUsd) + Number.EPSILON
  ) {
    return transaction.aiUsage.update({
      where: { id: usage.id },
      data: {
        status: AiUsageStatus.UNCONFIRMED,
        inputTokens: actual.inputTokens,
        cachedInputTokens: actual.cachedInputTokens,
        outputTokens: actual.outputTokens,
        estimatedCostUsd: actualCostUsd,
        providerRequestId: actual.providerRequestId,
        errorCode: "AI_USAGE_EXCEEDED_RESERVATION",
      },
    });
  }

  for (const period of periods) {
    await transaction.aiBudgetPeriod.update({
      where: { id: period.id },
      data: {
        reservedUsd: { decrement: usage.reservedCostUsd },
        usedUsd: { increment: actualCostUsd },
      },
    });
  }
  if (usage.researchJobId) {
    await transaction.researchJob.update({
      where: { id: usage.researchJobId },
      data: {
        aiReservedTokens: { decrement: reservedTokens },
        aiUsedTokens: { increment: actualTokens },
        aiReservedCostUsd: { decrement: usage.reservedCostUsd },
        aiUsedCostUsd: { increment: actualCostUsd },
      },
    });
  }
  return transaction.aiUsage.update({
    where: { id: usage.id },
    data: {
      status: AiUsageStatus.SETTLED,
      inputTokens: actual.inputTokens,
      cachedInputTokens: actual.cachedInputTokens,
      outputTokens: actual.outputTokens,
      estimatedCostUsd: actualCostUsd,
      providerRequestId: actual.providerRequestId,
      settledAt: new Date(),
    },
  });
}

export async function settleAiUsage(
  usageId: string,
  actual: ActualAiUsage,
  database: BudgetDatabase = db,
) {
  const usage = await withSerializableRetry(database, (transaction) =>
    settleAiUsageInTransaction(transaction, usageId, actual),
  );
  if (
    usage.status === AiUsageStatus.UNCONFIRMED &&
    usage.errorCode === "AI_USAGE_EXCEEDED_RESERVATION"
  ) {
    throw new AiBudgetError(
      "AI_USAGE_RECONCILIATION_REQUIRED",
      "Provider usage exceeded its conservative reservation.",
    );
  }
  return usage;
}

export async function releaseAiUsage(
  usageId: string,
  errorCode: string,
  database: BudgetDatabase = db,
) {
  return withSerializableRetry(database, async (transaction) => {
    const { usage, periods } = await lockUsageAndCounters(transaction, usageId);
    if (usage.status !== AiUsageStatus.RESERVED) return usage;
    for (const period of periods) {
      await transaction.aiBudgetPeriod.update({
        where: { id: period.id },
        data: { reservedUsd: { decrement: usage.reservedCostUsd } },
      });
    }
    if (usage.researchJobId) {
      await transaction.researchJob.update({
        where: { id: usage.researchJobId },
        data: {
          aiReservedTokens: {
            decrement: usage.reservedInputTokens + usage.reservedOutputTokens,
          },
          aiReservedCostUsd: { decrement: usage.reservedCostUsd },
        },
      });
    }
    return transaction.aiUsage.update({
      where: { id: usage.id },
      data: {
        status: AiUsageStatus.RELEASED,
        errorCode,
        settledAt: new Date(),
      },
    });
  });
}

export async function markAiUsageUnconfirmed(
  usageId: string,
  errorCode: string,
  evidence: { providerRequestId?: string | null } = {},
  database: BudgetDatabase = db,
) {
  return database.$transaction((transaction) =>
    transaction.aiUsage.updateMany({
      where: { id: usageId, status: AiUsageStatus.RESERVED },
      data: {
        status: AiUsageStatus.UNCONFIRMED,
        errorCode,
        providerRequestId: evidence.providerRequestId,
      },
    }),
  );
}

export async function getUserAiUsageSummary(userId: string, now = new Date()) {
  const periodStart = utcMonthStart(now);
  const [budget, usage] = await Promise.all([
    db.aiBudgetPeriod.findUnique({
      where: { scopeKey_periodStart: { scopeKey: userId, periodStart } },
    }),
    db.aiUsage.aggregate({
      where: { userId, periodStart },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
      },
      _count: true,
    }),
  ]);
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    limitUsd: budget ? number(budget.limitUsd) : 0,
    reservedUsd: budget ? number(budget.reservedUsd) : 0,
    usedUsd: budget ? number(budget.usedUsd) : 0,
    calls: usage._count,
    inputTokens: usage._sum.inputTokens ?? 0,
    outputTokens: usage._sum.outputTokens ?? 0,
    estimatedCostUsd: usage._sum.estimatedCostUsd
      ? number(usage._sum.estimatedCostUsd)
      : 0,
  };
}

export async function getGlobalAiUsageSummary(now = new Date()) {
  const periodStart = utcMonthStart(now);
  const [budget, usage, reconciliationRequired] = await Promise.all([
    db.aiBudgetPeriod.findUnique({
      where: {
        scopeKey_periodStart: { scopeKey: GLOBAL_SCOPE_KEY, periodStart },
      },
    }),
    db.aiUsage.aggregate({
      where: { periodStart },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
      },
      _count: true,
    }),
    db.aiUsage.count({
      where: {
        periodStart,
        status: {
          in: [AiUsageStatus.RESERVED, AiUsageStatus.UNCONFIRMED],
        },
      },
    }),
  ]);
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    limitUsd: budget ? number(budget.limitUsd) : 0,
    reservedUsd: budget ? number(budget.reservedUsd) : 0,
    usedUsd: budget ? number(budget.usedUsd) : 0,
    calls: usage._count,
    inputTokens: usage._sum.inputTokens ?? 0,
    outputTokens: usage._sum.outputTokens ?? 0,
    estimatedCostUsd: usage._sum.estimatedCostUsd
      ? number(usage._sum.estimatedCostUsd)
      : 0,
    reconciliationRequired,
  };
}
