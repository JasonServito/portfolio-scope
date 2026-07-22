import { randomUUID } from "node:crypto";

import {
  AgentName,
  BackgroundJobType,
  Prisma,
  ResearchStatus,
} from "@prisma/client";

import { db } from "@/lib/db";
import { requireMutableUser } from "@/lib/auth/authorization";
import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import {
  SPECIALIST_AGENT_NAMES,
  type AgentResult,
  type ResearchFinding,
  type ResearchRating,
  type ResearchSource,
  type StockResearch,
} from "@/lib/research/types";

const ALL_AGENT_NAMES = [...SPECIALIST_AGENT_NAMES, "SYNTHESIS"] as const;
type ResearchJobWithResults = Prisma.ResearchJobGetPayload<{
  include: { stock: true; agentRuns: true; report: true };
}>;

function jsonArray<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asAgentResult(run: {
  agentName: string;
  status: string;
  rating: string | null;
  confidence: { toNumber(): number } | null;
  summary: string;
  findingsJson: Prisma.JsonValue;
  sourcesJson: Prisma.JsonValue;
  warningsJson: Prisma.JsonValue;
}): AgentResult {
  return {
    agentName: run.agentName as AgentResult["agentName"],
    status: run.status === "FAILED" ? "FAILED" : "COMPLETED",
    rating: (run.rating ?? "NEUTRAL") as ResearchRating,
    confidence: run.confidence?.toNumber() ?? 0,
    summary: run.summary,
    findings: jsonArray<ResearchFinding>(run.findingsJson),
    sources: jsonArray<ResearchSource>(run.sourcesJson),
    warnings: jsonArray<string>(run.warningsJson),
  };
}

export async function getLatestResearch(
  ticker: string,
): Promise<StockResearch | null> {
  const symbol = ticker.toUpperCase();
  const job = await db.researchJob.findFirst({
    where: {
      stock: { ticker: symbol },
      user: { isDemo: true },
      status: "COMPLETED",
      report: { isNot: null },
    },
    include: { stock: true, agentRuns: true, report: true },
    orderBy: { completedAt: "desc" },
  });

  return shapeResearch(job);
}

export async function getLatestResearchForUser(
  userId: string,
  ticker: string,
): Promise<StockResearch | null> {
  const job = await db.researchJob.findFirst({
    where: {
      userId,
      stock: { ticker: ticker.toUpperCase() },
      status: "COMPLETED",
      report: { isNot: null },
    },
    include: { stock: true, agentRuns: true, report: true },
    orderBy: { completedAt: "desc" },
  });

  return shapeResearch(job);
}

export async function getOwnedResearchJob(
  userId: string,
  jobId: string,
) {
  const job = await db.researchJob.findFirst({
    where: { id: jobId, userId },
    include: { stock: true, agentRuns: true, report: true },
  });

  if (!job) return null;

  return {
    id: job.id,
    status: job.status,
    ticker: job.stock.ticker,
    companyName: job.stock.companyName,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    research: shapeResearch(job),
  };
}

export async function listResearchJobs(userId: string) {
  return db.researchJob.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      stock: { select: { ticker: true, companyName: true } },
      report: { select: { generatedAt: true, expiresAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

function shapeResearch(job: ResearchJobWithResults | null): StockResearch | null {
  if (!job?.report) return null;
  const order = new Map(ALL_AGENT_NAMES.map((name, index) => [name, index]));

  return {
    jobId: job.id,
    ticker: job.stock.ticker,
    companyName: job.stock.companyName,
    status: "COMPLETED",
    generatedAt: job.report.generatedAt.toISOString(),
    expiresAt: job.report.expiresAt.toISOString(),
    agents: job.agentRuns
      .map(asAgentResult)
      .sort(
        (a, b) =>
          (order.get(a.agentName) ?? 99) - (order.get(b.agentName) ?? 99),
      ),
    report: {
      overview: job.report.overview,
      bullCase: jsonArray<string>(job.report.bullCaseJson),
      bearCase: jsonArray<string>(job.report.bearCaseJson),
      risks: jsonArray<string>(job.report.risksJson),
      missingData: jsonArray<string>(job.report.missingDataJson),
      confidence: job.report.confidence.toNumber(),
    },
  };
}

export async function runResearch(
  userId: string,
  ticker: string,
  dependencies: {
    publisher?: JobPublisher;
    environment?: NodeJS.ProcessEnv;
    now?: () => Date;
  } = {},
) {
  const symbol = ticker.toUpperCase();
  await requireMutableUser(userId);
  const environment = dependencies.environment ?? process.env;
  if (!isBackgroundFeatureEnabled("RESEARCH_GENERATION_ENABLED", environment)) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Research generation is disabled.",
    );
  }
  const stock = await db.stock.findUnique({ where: { ticker: symbol } });
  if (!stock) return null;

  const now = dependencies.now?.() ?? new Date();
  const fresh = await db.researchJob.findFirst({
    where: {
      userId,
      stockId: stock.id,
      status: ResearchStatus.COMPLETED,
      report: { is: { expiresAt: { gt: now } } },
    },
    include: { stock: true, agentRuns: true, report: true },
    orderBy: { completedAt: "desc" },
  });
  if (fresh) {
    const research = shapeResearch(fresh);
    if (research) return { ...research, reused: true };
  }

  const active = await db.researchJob.findFirst({
    where: {
      userId,
      stockId: stock.id,
      status: {
        in: [
          ResearchStatus.PENDING,
          ResearchStatus.RUNNING,
          ResearchStatus.PARTIALLY_COMPLETED,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (active) {
    return {
      jobId: active.id,
      ticker: stock.ticker,
      companyName: stock.companyName,
      status: active.status,
      correlationId: active.correlationId,
      reused: true,
    };
  }

  const correlationId = randomUUID();
  let job;
  try {
    job = await db.$transaction(async (transaction) => {
      const created = await transaction.researchJob.create({
        data: {
          userId,
          stockId: stock.id,
          status: ResearchStatus.PENDING,
          correlationId,
          requestedAgents: ALL_AGENT_NAMES.map((name) => AgentName[name]),
        },
      });
      await transaction.agentRun.createMany({
        data: SPECIALIST_AGENT_NAMES.map((agentName) => ({
          researchJobId: created.id,
          agentName,
          status: "PENDING" as const,
          summary: "",
          findingsJson: [],
          sourcesJson: [],
          warningsJson: [],
        })),
      });
      return created;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrent = await db.researchJob.findFirst({
        where: {
          userId,
          stockId: stock.id,
          status: {
            in: [
              ResearchStatus.PENDING,
              ResearchStatus.RUNNING,
              ResearchStatus.PARTIALLY_COMPLETED,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
      });
      if (concurrent) {
        return {
          jobId: concurrent.id,
          ticker: stock.ticker,
          companyName: stock.companyName,
          status: concurrent.status,
          correlationId: concurrent.correlationId,
          reused: true,
        };
      }
    }
    throw error;
  }

  try {
    await Promise.all(
      SPECIALIST_AGENT_NAMES.map((agentName) =>
        enqueueBackgroundJob(
          {
            type: BackgroundJobType.RESEARCH_AGENT_RUN,
            idempotencyKey: `research:${job.id}:agent:${agentName}`,
            correlationId,
            payload: { researchJobId: job.id, agentName },
            userId,
            researchJobId: job.id,
            agentName,
          },
          {
            publisher: dependencies.publisher,
            environment,
          },
        ),
      ),
    );
  } catch (error) {
    await db.researchJob.update({
      where: { id: job.id },
      data: { status: ResearchStatus.PARTIALLY_COMPLETED },
    });
    throw error;
  }

  return {
    jobId: job.id,
    ticker: stock.ticker,
    companyName: stock.companyName,
    status: job.status,
    correlationId,
    reused: false,
  };
}
