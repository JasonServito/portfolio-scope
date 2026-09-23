import { randomUUID } from "node:crypto";

import {
  AgentName,
  BackgroundJobType,
  Prisma,
  ResearchGenerationMode,
  ResearchStatus,
} from "@prisma/client";

import { requireMutableUser } from "@/lib/auth/authorization";
import { db } from "@/lib/db";
import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";
import { getUserAiUsageSummary, utcMonthStart } from "@/lib/research/ai/budget";
import {
  AI_CALCULATION_VERSION,
  AI_SPECIALIST_AGENT_VERSION,
  AiConfigurationError,
  createQueuedAiGenerationConfig,
  getAiResearchConfig,
  type QueuedAiGenerationConfig,
} from "@/lib/research/ai/config";
import {
  researchEvidenceCoverageSchema,
  upcomingEarningsFromEvidence,
} from "@/lib/research/ai/evidence-coverage";
import {
  diffResearchReports,
  type ReportDiffClaim,
} from "@/lib/research/ai/report-diff";
import {
  hasCurrentReportEvidence,
  prepareResearchEvidenceSnapshot,
  type ResearchEvidenceSnapshot,
} from "@/lib/research/ai/retrieval";
import {
  researchEvidenceSchema,
  stableHash,
  type ResearchEvidence,
} from "@/lib/research/ai/schemas";
import { recentEventsFromResearch } from "@/lib/research/recent-events";
import {
  initialSpecialistAgentNames,
  scheduledSpecialistAgentNames,
  SPECIALIST_AGENT_NAMES,
  type AgentResult,
  type ResearchClaim,
  type ResearchEvidenceRecord,
  type ResearchEvidenceReference,
  type ResearchFinding,
  type ResearchRating,
  type ResearchSource,
  type StockResearch,
} from "@/lib/research/types";

const ALL_AGENT_NAMES = [...SPECIALIST_AGENT_NAMES, "SYNTHESIS"] as const;

const researchInclude = Prisma.validator<Prisma.ResearchJobInclude>()({
  stock: true,
  agentRuns: true,
  report: {
    include: {
      claims: {
        include: { evidence: { orderBy: { ordinal: "asc" } } },
        orderBy: { ordinal: "asc" },
      },
    },
  },
});

type ResearchJobWithResults = Prisma.ResearchJobGetPayload<{
  include: typeof researchInclude;
}>;

function jsonArray<T>(value: Prisma.JsonValue | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asAgentResult(
  run: ResearchJobWithResults["agentRuns"][number],
): AgentResult {
  return {
    agentName: run.agentName,
    status: run.status === "FAILED" ? "FAILED" : "COMPLETED",
    rating: (run.rating ?? "NEUTRAL") as ResearchRating,
    confidence: run.confidence?.toNumber() ?? 0,
    availability: run.availability ?? null,
    summary: run.summary,
    findings: jsonArray<ResearchFinding>(run.findingsJson),
    sources: jsonArray<ResearchSource>(run.sourcesJson),
    warnings: jsonArray<string>(run.warningsJson),
    claims: jsonArray<NonNullable<AgentResult["claims"]>[number]>(
      run.claimsJson,
    ),
    missingData: jsonArray<string>(run.missingDataJson),
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    outputSchemaVersion: run.outputSchemaVersion,
    agentVersion: run.agentVersion,
  };
}

function shapeEvidence(
  evidence: NonNullable<
    ResearchJobWithResults["report"]
  >["claims"][number]["evidence"][number],
): ResearchEvidenceReference {
  return {
    id: evidence.referenceKey,
    role: evidence.role,
    sourceKind: evidence.sourceKind,
    title: evidence.title,
    sourceReference: evidence.sourceReference,
    sourceUrl: evidence.sourceUrl,
    accessionNumber: evidence.accessionNumber,
    section: evidence.section,
    sourceDate: evidence.sourceDate?.toISOString().slice(0, 10) ?? null,
    retrievedAt: evidence.retrievedAt?.toISOString() ?? null,
    excerpt: evidence.excerpt,
  };
}

function shapeClaims(
  report: NonNullable<ResearchJobWithResults["report"]>,
): ResearchClaim[] {
  return (report.claims ?? []).map((claim) => ({
    id: claim.id,
    claimKey: claim.claimKey,
    category: claim.category,
    kind: claim.kind,
    statement: claim.statement,
    confidence: claim.confidence.toNumber(),
    assumptions: jsonArray<string>(claim.assumptionsJson),
    sourceDate: claim.sourceDate?.toISOString().slice(0, 10) ?? null,
    asOfDate: claim.asOfDate.toISOString().slice(0, 10),
    evidence: claim.evidence.map(shapeEvidence),
  }));
}

/** Evidence items of the persisted snapshot that still pass the runtime schema. */
function parseSnapshotEvidence(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidates = (value as Record<string, unknown>).evidence;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate): ResearchEvidence[] => {
    const parsed = researchEvidenceSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function shapeEvidenceRegistry(
  evidence: readonly ResearchEvidence[],
): ResearchEvidenceRecord[] {
  return evidence.map((item) => ({
    id: item.id,
    sourceKind: item.sourceKind,
    title: item.title,
    sourceReference: item.sourceReference,
    sourceUrl: item.sourceUrl,
    accessionNumber: item.accessionNumber,
    section: item.section,
    sourceDate: item.sourceDate,
    retrievedAt: item.retrievedAt,
    excerpt: item.excerpt,
  }));
}

function shapeEvidenceCoverage(value: Prisma.JsonValue | null) {
  const parsed = researchEvidenceCoverageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function shapeResearch(
  job: ResearchJobWithResults | null,
): StockResearch | null {
  if (!job?.report) return null;
  const order = new Map(ALL_AGENT_NAMES.map((name, index) => [name, index]));
  const report = job.report;
  const snapshotEvidence = parseSnapshotEvidence(job.sourceSnapshotJson);
  const agents = job.agentRuns
    .map(asAgentResult)
    .sort(
      (a, b) =>
        (order.get(a.agentName) ?? 99) - (order.get(b.agentName) ?? 99),
    );

  return {
    jobId: job.id,
    ticker: job.stock.ticker,
    companyName: job.stock.companyName,
    status: "COMPLETED",
    generatedAt: report.generatedAt.toISOString(),
    expiresAt: report.expiresAt.toISOString(),
    generationMode: job.generationMode,
    agents,
    report: {
      rating: report.rating,
      overview: report.overview,
      bullCase: jsonArray<string>(report.bullCaseJson),
      bearCase: jsonArray<string>(report.bearCaseJson),
      risks: jsonArray<string>(report.risksJson),
      missingData: jsonArray<string>(report.missingDataJson),
      disagreements: jsonArray<string>(report.disagreementsJson),
      confidence: report.confidence.toNumber(),
      whatWouldChange: jsonArray<string>(report.whatWouldChangeJson),
      evidenceCoverage: shapeEvidenceCoverage(report.evidenceCoverageJson),
      upcomingEarnings: upcomingEarningsFromEvidence(snapshotEvidence),
      recentEvents: recentEventsFromResearch(agents, snapshotEvidence),
    },
    claims: shapeClaims(report),
    evidenceRegistry: shapeEvidenceRegistry(snapshotEvidence),
    metadata: {
      provider: report.provider,
      model: report.model,
      promptVersion: report.promptVersion,
      outputSchemaVersion: report.outputSchemaVersion,
      retrievalVersion: report.retrievalVersion,
      calculationVersion: report.calculationVersion,
      sourceDataVersion: job.sourceDataVersion,
      inputDataVersion: report.inputDataVersion,
      reportVersion: report.reportVersion,
      sourceSnapshotSha256: report.sourceSnapshotSha256,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      estimatedCostUsd: report.estimatedCostUsd?.toNumber() ?? null,
    },
  };
}

export async function getLatestResearch(ticker: string) {
  const job = await db.researchJob.findFirst({
    where: {
      stock: { ticker: ticker.toUpperCase() },
      user: { isDemo: true },
      generationMode: ResearchGenerationMode.DETERMINISTIC,
      status: ResearchStatus.COMPLETED,
      report: { isNot: null },
    },
    include: researchInclude,
    orderBy: { completedAt: "desc" },
  });
  return shapeResearch(job);
}

export async function getLatestResearchForUser(userId: string, ticker: string) {
  const job = await db.researchJob.findFirst({
    where: {
      userId,
      stock: { ticker: ticker.toUpperCase() },
      status: ResearchStatus.COMPLETED,
      report: { isNot: null },
    },
    include: researchInclude,
    orderBy: { completedAt: "desc" },
  });
  return shapeResearch(job);
}

function evidenceFromStoredReference(
  value: NonNullable<
    ResearchJobWithResults["report"]
  >["claims"][number]["evidence"][number],
): ResearchEvidence {
  return {
    id: value.referenceKey,
    sourceKind: value.sourceKind,
    title: value.title,
    sourceReference: value.sourceReference,
    sourceUrl: value.sourceUrl,
    accessionNumber: value.accessionNumber,
    section: value.section,
    objectKey: value.objectKey,
    sha256: value.sha256,
    sourceDate: value.sourceDate?.toISOString().slice(0, 10) ?? null,
    retrievedAt: value.retrievedAt?.toISOString() ?? null,
    excerpt: value.excerpt,
    passageStart: value.passageStart,
    passageEnd: value.passageEnd,
    secFilingId: value.secFilingId,
    secRawSourceId: value.secRawSourceId,
    secFinancialFactId: value.secFinancialFactId,
    metadata: (value.metadataJson ??
      {}) as unknown as ResearchEvidence["metadata"],
  };
}

function structuredReportSnapshot(job: ResearchJobWithResults) {
  if (!job.report) return null;
  const evidenceById = new Map<string, ResearchEvidence>();
  const claims: ReportDiffClaim[] = (job.report.claims ?? []).map((claim) => {
    for (const evidence of claim.evidence) {
      evidenceById.set(
        evidence.referenceKey,
        evidenceFromStoredReference(evidence),
      );
    }
    return {
      category: claim.category,
      kind: claim.kind,
      statement: claim.statement,
      confidence: claim.confidence.toNumber(),
      evidenceIds: claim.evidence
        .filter((evidence) => evidence.role === "SUPPORTING")
        .map((evidence) => evidence.referenceKey),
      counterEvidenceIds: claim.evidence
        .filter((evidence) => evidence.role === "COUNTER")
        .map((evidence) => evidence.referenceKey),
      assumptions: jsonArray<string>(claim.assumptionsJson),
    };
  });
  return {
    rating: job.report.rating,
    confidence: job.report.confidence.toNumber(),
    claims,
    evidence: [...evidenceById.values()],
    sourceSnapshotSha256: job.report.sourceSnapshotSha256,
    sourceDataVersion: job.sourceDataVersion,
  };
}

async function getPreviousReportDiff(
  userId: string,
  current: ResearchJobWithResults,
) {
  const currentSnapshot = structuredReportSnapshot(current);
  if (!currentSnapshot) return null;
  const previous = await db.researchJob.findFirst({
    where: {
      userId,
      stockId: current.stockId,
      id: { not: current.id },
      createdAt: { lt: current.createdAt },
      status: ResearchStatus.COMPLETED,
      report: { isNot: null },
    },
    include: researchInclude,
    orderBy: { createdAt: "desc" },
  });
  if (!previous) return null;
  const previousSnapshot = structuredReportSnapshot(previous);
  if (!previousSnapshot) return null;
  return {
    previousJobId: previous.id,
    diff: diffResearchReports(previousSnapshot, currentSnapshot),
  };
}

export async function getOwnedResearchJob(userId: string, jobId: string) {
  const job = await db.researchJob.findFirst({
    where: { id: jobId, userId },
    include: researchInclude,
  });
  if (!job) return null;

  return {
    id: job.id,
    status: job.status,
    ticker: job.stock.ticker,
    companyName: job.stock.companyName,
    generationMode: job.generationMode,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    research: shapeResearch(job),
    comparison:
      job.status === ResearchStatus.COMPLETED
        ? await getPreviousReportDiff(userId, job)
        : null,
  };
}

export async function listResearchJobs(userId: string) {
  return db.researchJob.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      generationMode: true,
      requestedRegeneration: true,
      createdAt: true,
      completedAt: true,
      stock: { select: { ticker: true, companyName: true } },
      report: {
        select: {
          generatedAt: true,
          expiresAt: true,
          model: true,
          reportVersion: true,
          estimatedCostUsd: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getResearchWorkspaceSummary(
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const enabled = isFeatureEnabled("AI_RESEARCH_ENABLED", environment);
  let configurationReady = false;
  let reportLimit: number | null = null;
  let userBudgetUsd: number | null = null;
  if (enabled) {
    try {
      const config = getAiResearchConfig(environment);
      configurationReady = true;
      reportLimit = config.userMonthlyReportLimit;
      userBudgetUsd = config.userMonthlyBudgetUsd;
    } catch {
      configurationReady = false;
    }
  }
  return {
    enabled,
    configurationReady,
    reportLimit,
    userBudgetUsd,
    usage: await getUserAiUsageSummary(userId),
  };
}

function externalFingerprint(
  snapshot: ResearchEvidenceSnapshot,
  generationConfig: QueuedAiGenerationConfig,
) {
  return stableHash({
    generationMode: ResearchGenerationMode.EXTERNAL,
    generationConfig,
    sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    inputDataVersion: snapshot.inputDataVersion,
  });
}

export async function runResearch(
  userId: string,
  ticker: string,
  dependencies: {
    publisher?: JobPublisher;
    environment?: NodeJS.ProcessEnv;
    now?: () => Date;
    regenerate?: boolean;
    prepareSnapshot?: typeof prepareResearchEvidenceSnapshot;
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
      generationMode: active.generationMode,
      correlationId: active.correlationId,
      reused: true,
    };
  }

  const externalEnabled = isFeatureEnabled("AI_RESEARCH_ENABLED", environment);
  let config: ReturnType<typeof getAiResearchConfig> | null = null;
  let generationConfig: QueuedAiGenerationConfig | null = null;
  let snapshot: ResearchEvidenceSnapshot | null = null;
  let generationFingerprint: string | null = null;
  if (externalEnabled) {
    try {
      config = getAiResearchConfig(environment);
    } catch (error) {
      throw new JobRequestError(
        JobErrorCode.AI_CONFIGURATION_ERROR,
        503,
        "AI research is enabled but its server configuration is incomplete.",
        error instanceof AiConfigurationError ? { cause: error } : undefined,
      );
    }
    snapshot = await (
      dependencies.prepareSnapshot ?? prepareResearchEvidenceSnapshot
    )({
      stockId: stock.id,
      ticker: stock.ticker,
      companyName: stock.companyName,
    });
    generationConfig = createQueuedAiGenerationConfig(config);
    generationFingerprint = externalFingerprint(snapshot, generationConfig);
  }

  if (!dependencies.regenerate) {
    const fresh = await db.researchJob.findFirst({
      where: {
        userId,
        stockId: stock.id,
        generationMode: externalEnabled
          ? ResearchGenerationMode.EXTERNAL
          : ResearchGenerationMode.DETERMINISTIC,
        ...(externalEnabled ? { generationFingerprint } : {}),
        status: ResearchStatus.COMPLETED,
        report: { is: { expiresAt: { gt: now } } },
      },
      include: researchInclude,
      orderBy: { completedAt: "desc" },
    });
    if (fresh) {
      const research = shapeResearch(fresh);
      if (research) return { ...research, reused: true };
    }
  }

  const correlationId = randomUUID();
  const generationMode = config
    ? ResearchGenerationMode.EXTERNAL
    : ResearchGenerationMode.DETERMINISTIC;
  const scheduledSpecialists = scheduledSpecialistAgentNames(generationMode);
  // Every scheduled specialist gets a pending run. News is deferred to a
  // second stage (queued by the first-stage completions in the background
  // executor) only when the snapshot holds current reports and it will make
  // a model call whose reservation must not overlap theirs; otherwise it
  // short-circuits without a reservation and is queued with the others.
  const initialSpecialists =
    snapshot && hasCurrentReportEvidence(snapshot)
      ? initialSpecialistAgentNames(generationMode)
      : scheduledSpecialists;
  let job;
  try {
    const transactionResult = await db.$transaction(async (transaction) => {
      if (config) {
        await transaction.$queryRaw`
          SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
        `;

        const concurrent = await transaction.researchJob.findFirst({
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
        if (concurrent) return { job: concurrent, reused: true } as const;

        const dayStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        const nextDayStart = new Date(dayStart);
        nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
        const requestedForStockToday = await transaction.researchJob.count({
          where: {
            userId,
            stockId: stock.id,
            generationMode: ResearchGenerationMode.EXTERNAL,
            createdAt: { gte: dayStart, lt: nextDayStart },
          },
        });
        if (requestedForStockToday >= 1) {
          throw new JobRequestError(
            JobErrorCode.AI_DAILY_REPORT_LIMIT_EXCEEDED,
            429,
            "A fresh AI research report was already requested for this stock today.",
          );
        }

        const concurrentMonthlyRequests = await transaction.researchJob.count({
          where: {
            userId,
            generationMode: ResearchGenerationMode.EXTERNAL,
            createdAt: { gte: utcMonthStart(now) },
            status: { not: ResearchStatus.CANCELLED },
          },
        });
        if (concurrentMonthlyRequests >= config.userMonthlyReportLimit) {
          throw new JobRequestError(
            JobErrorCode.AI_REPORT_LIMIT_EXCEEDED,
            429,
            "Your monthly AI research report limit has been reached.",
          );
        }
      }
      const created = await transaction.researchJob.create({
        data: {
          userId,
          stockId: stock.id,
          status: ResearchStatus.PENDING,
          generationMode: config
            ? ResearchGenerationMode.EXTERNAL
            : ResearchGenerationMode.DETERMINISTIC,
          requestedRegeneration: dependencies.regenerate ?? false,
          generationFingerprint,
          sourceDataVersion: snapshot?.sourceDataVersion ?? null,
          inputDataVersion: snapshot?.inputDataVersion ?? null,
          retrievalVersion: snapshot?.retrievalVersion ?? null,
          calculationVersion: config ? AI_CALCULATION_VERSION : null,
          generationConfigJson: generationConfig
            ? (generationConfig as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          sourceSnapshotJson: snapshot
            ? (snapshot as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          sourceSnapshotSha256: snapshot?.sourceSnapshotSha256 ?? null,
          aiTokenLimit: config?.maxTokensPerJob ?? null,
          aiCostLimitUsd: config?.maxCostPerJobUsd ?? null,
          correlationId,
          requestedAgents: [...scheduledSpecialists, "SYNTHESIS" as const].map(
            (name) => AgentName[name],
          ),
          ...(config ? { createdAt: now } : {}),
        },
      });
      await transaction.agentRun.createMany({
        data: scheduledSpecialists.map((agentName) => ({
          researchJobId: created.id,
          agentName,
          status: "PENDING" as const,
          summary: "",
          findingsJson: [],
          sourcesJson: [],
          warningsJson: [],
          agentVersion: config
            ? AI_SPECIALIST_AGENT_VERSION
            : "deterministic-v1",
        })),
      });
      return { job: created, reused: false } as const;
    });
    if (transactionResult.reused) {
      return {
        jobId: transactionResult.job.id,
        ticker: stock.ticker,
        companyName: stock.companyName,
        status: transactionResult.job.status,
        generationMode: transactionResult.job.generationMode,
        correlationId: transactionResult.job.correlationId,
        reused: true,
      };
    }
    job = transactionResult.job;
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
          generationMode: concurrent.generationMode,
          correlationId: concurrent.correlationId,
          reused: true,
        };
      }
    }
    throw error;
  }

  try {
    await Promise.all(
      initialSpecialists.map((agentName) =>
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
          { publisher: dependencies.publisher, environment },
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
    generationMode: job.generationMode,
    correlationId,
    reused: false,
  };
}
