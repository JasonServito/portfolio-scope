import {
  AgentName,
  AgentStatus,
  AiUsageStatus,
  BackgroundJobStatus,
  BackgroundJobType,
  Prisma,
  ResearchGenerationMode,
  ResearchStatus,
} from "@prisma/client";

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";
import { runCompetitorsAgent } from "@/lib/research/agents/competitors-agent";
import { runFinancialsAgent } from "@/lib/research/agents/financials-agent";
import { runNewsAgent } from "@/lib/research/agents/news-agent";
import { runPoliticalActivityAgent } from "@/lib/research/agents/political-activity-agent";
import { runRiskAgent } from "@/lib/research/agents/risk-agent";
import {
  AiBudgetError,
  markAiUsageUnconfirmed,
  settleAiUsageInTransaction,
  type ActualAiUsage,
} from "@/lib/research/ai/budget";
import {
  AI_OUTPUT_SCHEMA_VERSION,
  AI_PROMPT_VERSION,
  AI_REPORT_VERSION,
  AI_SPECIALIST_AGENT_VERSION,
  AI_SYNTHESIS_AGENT_VERSION,
  AI_VERIFIER_MAX_OUTPUT_TOKENS,
  AiConfigurationError,
  getQueuedAiResearchConfig,
  type AiResearchConfig,
} from "@/lib/research/ai/config";
import { ratingForClaims } from "@/lib/research/ai/consistency";
import { computeEvidenceCoverage } from "@/lib/research/ai/evidence-coverage";
import {
  GroundedModelCallError,
  runGroundedModelCall,
  runValidatedModelCall,
} from "@/lib/research/ai/model-runner";
import { specialistPrompt, synthesisPrompt } from "@/lib/research/ai/prompts";
import {
  OpenAIResponsesResearchModelProvider,
  type ResearchModelProvider,
} from "@/lib/research/ai/providers";
import {
  buildResearchEvidenceSnapshot,
  hasCurrentReportEvidence,
  ResearchEvidenceSnapshotError,
  selectSpecialistEvidence,
  selectSynthesisEvidence,
  type ResearchEvidenceSnapshot,
} from "@/lib/research/ai/retrieval";
import {
  claimKey,
  specialistModelOutputSchema,
  synthesisModelOutputSchema,
  validateGroundedOutput,
  type ModelClaim,
  type ResearchEvidence,
  type SpecialistModelOutput,
  type SynthesisModelOutput,
} from "@/lib/research/ai/schemas";
import {
  applyClaimVerification,
  claimVerificationSchema,
  validateClaimVerification,
  verificationPrompt,
  type ClaimVerification,
} from "@/lib/research/ai/verification";
import { seededResearchProvider } from "@/lib/research/providers/seeded-provider";
import { synthesizeResearch } from "@/lib/research/synthesis-agent";
import {
  deferredSpecialistAgentNames,
  scheduledSpecialistAgentNames,
  type AgentResult,
  type ResearchFinding,
  type ResearchRating,
  type ResearchSource,
  type SpecialistAgentName,
} from "@/lib/research/types";

const REPORT_TTL_DAYS = 30;
const AI_USAGE_PERSISTENCE_ERROR = "AI_USAGE_PERSISTENCE_FAILED";

type ChargedAiUsage = ActualAiUsage & { usageId: string };

type BackgroundDependencies = {
  environment?: NodeJS.ProcessEnv;
  provider?: ResearchModelProvider;
  config?: AiResearchConfig;
  buildSnapshot?: typeof buildResearchEvidenceSnapshot;
  publisher?: JobPublisher;
  now?: () => Date;
};

function expiresAtFrom(date: Date) {
  const expiresAt = new Date(date);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + REPORT_TTL_DAYS);
  return expiresAt;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function utcDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function jsonArray<T>(value: Prisma.JsonValue | null): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function storedAgentResult(run: {
  agentName: AgentName;
  status: AgentStatus;
  rating: string | null;
  confidence: { toNumber(): number } | null;
  summary: string;
  findingsJson: Prisma.JsonValue;
  sourcesJson: Prisma.JsonValue;
  warningsJson: Prisma.JsonValue;
  claimsJson?: Prisma.JsonValue | null;
  missingDataJson?: Prisma.JsonValue | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string | null;
  agentVersion?: string | null;
  availability?: AgentResult["availability"];
}): AgentResult {
  return {
    agentName: run.agentName,
    status: run.status === AgentStatus.FAILED ? "FAILED" : "COMPLETED",
    rating: (run.rating ?? "NEUTRAL") as ResearchRating,
    confidence: run.confidence?.toNumber() ?? 0,
    availability: run.availability ?? null,
    summary: run.summary,
    findings: jsonArray<ResearchFinding>(run.findingsJson),
    sources: jsonArray<ResearchSource>(run.sourcesJson),
    warnings: jsonArray<string>(run.warningsJson),
    claims: jsonArray<NonNullable<AgentResult["claims"]>[number]>(
      run.claimsJson ?? null,
    ),
    missingData: jsonArray<string>(run.missingDataJson ?? null),
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    outputSchemaVersion: run.outputSchemaVersion,
    agentVersion: run.agentVersion,
  };
}

function runSpecialist(
  agentName: SpecialistAgentName,
  data: Parameters<typeof runNewsAgent>[0],
) {
  switch (agentName) {
    case "NEWS":
      return runNewsAgent(data);
    case "FINANCIALS":
      return runFinancialsAgent(data);
    case "COMPETITORS":
      return runCompetitorsAgent(data);
    case "POLITICAL_ACTIVITY":
      return runPoliticalActivityAgent(data);
    case "RISK":
      return runRiskAgent(data);
  }
}

function citedEvidence(claims: ModelClaim[], evidence: ResearchEvidence[]) {
  const ids = new Set(
    claims.flatMap((claim) => [
      ...claim.evidenceIds,
      ...claim.counterEvidenceIds,
    ]),
  );
  return evidence.filter((item) => ids.has(item.id));
}

function sourcesFromEvidence(evidence: ResearchEvidence[]): ResearchSource[] {
  return evidence.map((item) => ({
    title: item.title,
    reference: item.sourceReference,
    detail: item.excerpt,
  }));
}

function externalAgentResult(
  agentName: SpecialistAgentName,
  output: SpecialistModelOutput,
  evidence: ResearchEvidence[],
): AgentResult {
  return {
    agentName,
    status: "COMPLETED",
    rating: output.rating,
    confidence: output.confidence,
    availability: output.availability,
    summary: output.summary,
    findings: output.claims.map((claim) => ({
      label: claim.category.toLowerCase().replaceAll("_", " "),
      detail: claim.statement,
    })),
    sources: sourcesFromEvidence(citedEvidence(output.claims, evidence)),
    warnings: output.warnings,
    claims: output.claims,
    missingData: output.missingData,
  };
}

/** An explicit not-available state: no claims, no opinion, the gap preserved. */
function missingExternalSpecialist(
  agentName: SpecialistAgentName,
  reason: string,
): SpecialistModelOutput {
  return {
    rating: "NEUTRAL",
    confidence: 0,
    availability: "NOT_AVAILABLE",
    summary: reason,
    claims: [],
    warnings: [],
    missingData: [reason],
  };
}

function publicDataGap(agentName: SpecialistAgentName) {
  if (agentName === "NEWS") {
    return "No Form 8-K current report from the last twelve months is stored for this company, so recent events are not assessed; third-party news is not used.";
  }
  return "Verified political-activity evidence is not configured for this company.";
}

// Plain-language topic names for report text when a specialist is missing.
const SPECIALIST_TOPIC_LABELS: Record<SpecialistAgentName, string> = {
  FINANCIALS: "The financial performance review",
  COMPETITORS: "The peer comparison",
  RISK: "The risk review",
  NEWS: "The recent events review",
  POLITICAL_ACTIVITY: "The political activity review",
};

// Round-robin order for the fallback merge, so a claim limit can never drop
// an entire topic (the risk review in particular).
const FALLBACK_CLAIM_ORDER: readonly SpecialistAgentName[] = [
  "FINANCIALS",
  "RISK",
  "COMPETITORS",
  "NEWS",
  "POLITICAL_ACTIVITY",
];
const FALLBACK_MAX_CLAIMS = 12;

function modelProvider(
  config: AiResearchConfig,
  dependencies: BackgroundDependencies,
) {
  return (
    dependencies.provider ??
    OpenAIResponsesResearchModelProvider.fromConfig(config)
  );
}

async function assertUsageReconciled(researchJobId: string, operation: string) {
  const unresolved = await db.aiUsage.count({
    where: {
      researchJobId,
      OR: [
        { status: AiUsageStatus.UNCONFIRMED },
        { status: AiUsageStatus.RESERVED, operation },
      ],
    },
  });
  if (unresolved > 0) {
    throw new AiBudgetError(
      "AI_USAGE_RECONCILIATION_REQUIRED",
      "A prior provider attempt requires cost reconciliation.",
    );
  }
}

function isUsageReconciliationError(error: unknown): error is AiBudgetError {
  return (
    error instanceof AiBudgetError &&
    error.code === "AI_USAGE_RECONCILIATION_REQUIRED"
  );
}

function usageReconciliationJobError(error: AiBudgetError) {
  return new JobExecutionError(error.code, false, error.message, true, {
    cause: error,
  });
}

async function failClosedAfterChargedPersistenceFailure(
  usage: ChargedAiUsage,
): Promise<never> {
  try {
    await markAiUsageUnconfirmed(
      usage.usageId,
      AI_USAGE_PERSISTENCE_ERROR,
      usage,
    );
  } catch {
    // A remaining RESERVED row is blocked by the operation-aware pre-call gate.
  }
  throw new AiBudgetError(
    "AI_USAGE_RECONCILIATION_REQUIRED",
    "Provider usage requires cost reconciliation.",
  );
}

async function markSpecialistReconciliationFailure(
  researchJobId: string,
  agentName: SpecialistAgentName,
) {
  const completedAt = new Date();
  await db.$transaction([
    db.agentRun.updateMany({
      where: {
        researchJobId,
        agentName,
        status: { not: AgentStatus.COMPLETED },
      },
      data: { status: AgentStatus.FAILED, completedAt },
    }),
    db.researchJob.updateMany({
      where: {
        id: researchJobId,
        status: {
          notIn: [ResearchStatus.CANCELLED, ResearchStatus.COMPLETED],
        },
      },
      data: { status: ResearchStatus.FAILED, completedAt },
    }),
  ]);
}

async function markSynthesisReconciliationFailure(researchJobId: string) {
  const completedAt = new Date();
  await db.$transaction([
    db.agentRun.upsert({
      where: {
        researchJobId_agentName: {
          researchJobId,
          agentName: AgentName.SYNTHESIS,
        },
      },
      update: { status: AgentStatus.FAILED, completedAt },
      create: {
        researchJobId,
        agentName: AgentName.SYNTHESIS,
        status: AgentStatus.FAILED,
        summary: "",
        findingsJson: [],
        sourcesJson: [],
        warningsJson: [],
        completedAt,
      },
    }),
    db.researchJob.updateMany({
      where: {
        id: researchJobId,
        status: {
          notIn: [ResearchStatus.CANCELLED, ResearchStatus.COMPLETED],
        },
      },
      data: { status: ResearchStatus.FAILED, completedAt },
    }),
  ]);
}

async function throwSpecialistReconciliationError(
  error: AiBudgetError,
  researchJobId: string,
  agentName: SpecialistAgentName,
): Promise<never> {
  try {
    await markSpecialistReconciliationFailure(researchJobId, agentName);
  } catch {
    // The unresolved usage gate remains authoritative if state repair also fails.
  }
  throw usageReconciliationJobError(error);
}

async function throwSynthesisReconciliationError(
  error: AiBudgetError,
  researchJobId: string,
): Promise<never> {
  try {
    await markSynthesisReconciliationFailure(researchJobId);
  } catch {
    // The unresolved usage gate remains authoritative if state repair also fails.
  }
  throw usageReconciliationJobError(error);
}

function boundAiConfig(
  generationConfigJson: Prisma.JsonValue | null,
  environment: NodeJS.ProcessEnv,
  dependencies: BackgroundDependencies,
) {
  const bound = getQueuedAiResearchConfig(generationConfigJson, environment);
  if (!dependencies.config) return bound;
  return {
    ...dependencies.config,
    provider: bound.provider,
    model: bound.model,
    pricing: bound.pricing,
    pricingVersion: bound.pricingVersion,
    maxOutputTokensPerCall: bound.maxOutputTokensPerCall,
    providerTimeoutMs: bound.providerTimeoutMs,
  };
}

async function snapshotForJob(
  researchJobId: string,
  dependencies: BackgroundDependencies,
) {
  return (dependencies.buildSnapshot ?? buildResearchEvidenceSnapshot)(
    researchJobId,
  );
}

async function updateAgentRun(
  researchJobId: string,
  agentName: SpecialistAgentName,
  result: AgentResult,
  metadata: {
    provider?: string | null;
    model?: string | null;
    modelConfigJson?: Prisma.InputJsonValue;
    promptVersion?: string | null;
    outputSchemaVersion?: string | null;
    agentVersion: string;
  },
  usage?: ChargedAiUsage | null,
) {
  const completedAt = new Date();
  let reconciliationRequired = false;
  try {
    await db.$transaction(async (transaction) => {
      if (usage) {
        const settled = await settleAiUsageInTransaction(
          transaction,
          usage.usageId,
          usage,
        );
        if (settled.status === AiUsageStatus.UNCONFIRMED) {
          reconciliationRequired = true;
          return;
        }
      }
      await transaction.agentRun.update({
        where: { researchJobId_agentName: { researchJobId, agentName } },
        data: {
          status: AgentStatus.COMPLETED,
          rating: result.rating,
          confidence: result.confidence,
          availability: result.availability ?? null,
          summary: result.summary,
          findingsJson: result.findings,
          sourcesJson: result.sources,
          warningsJson: result.warnings,
          claimsJson: result.claims ?? [],
          missingDataJson: result.missingData ?? [],
          provider: metadata.provider,
          model: metadata.model,
          modelConfigJson: metadata.modelConfigJson,
          promptVersion: metadata.promptVersion,
          outputSchemaVersion: metadata.outputSchemaVersion,
          agentVersion: metadata.agentVersion,
          completedAt,
        },
      });
    });
  } catch (error) {
    if (usage) await failClosedAfterChargedPersistenceFailure(usage);
    throw error;
  }
  if (reconciliationRequired) {
    throw new AiBudgetError(
      "AI_USAGE_RECONCILIATION_REQUIRED",
      "Provider usage requires cost reconciliation.",
    );
  }
}

async function enqueueSynthesisIfReady(
  input: {
    researchJobId: string;
    userId: string;
    correlationId: string;
  },
  dependencies: BackgroundDependencies = {},
) {
  const parent = await db.researchJob.findUnique({
    where: { id: input.researchJobId },
    select: { status: true, generationMode: true },
  });
  // Readiness counts only the specialists scheduled for this job's mode; an
  // unscheduled historical run neither blocks nor satisfies synthesis.
  const generationMode =
    parent?.generationMode ?? ResearchGenerationMode.EXTERNAL;
  const scheduled = scheduledSpecialistAgentNames(generationMode);
  const deferred = deferredSpecialistAgentNames(generationMode);
  const specialistStates = await db.agentRun.findMany({
    where: {
      researchJobId: input.researchJobId,
      agentName: { in: [...scheduled] },
    },
    select: { agentName: true, status: true },
  });
  const completedSpecialists = specialistStates.filter(
    ({ status }) => status === AgentStatus.COMPLETED,
  ).length;
  const failedSpecialists = specialistStates.filter(
    ({ status }) => status === AgentStatus.FAILED,
  ).length;
  if (parent?.status === ResearchStatus.CANCELLED) {
    return { completedSpecialists, cancelled: true };
  }
  if (parent?.status === ResearchStatus.FAILED) {
    return { completedSpecialists, failed: true };
  }

  if (completedSpecialists !== scheduled.length) {
    // Second stage: a deferred specialist is queued once every first-stage
    // specialist has completed, so its model reservation never overlaps
    // theirs. The key is per job and agent, so concurrent completions queue
    // it once, and a run already running or failed is left to its own job.
    const hasStatus = (agentName: SpecialistAgentName, status: AgentStatus) =>
      specialistStates.some(
        (run) => run.agentName === agentName && run.status === status,
      );
    const firstStageComplete = scheduled
      .filter((agentName) => !deferred.includes(agentName))
      .every((agentName) => hasStatus(agentName, AgentStatus.COMPLETED));
    if (firstStageComplete) {
      for (const agentName of deferred) {
        if (!hasStatus(agentName, AgentStatus.PENDING)) continue;
        await enqueueBackgroundJob(
          {
            type: BackgroundJobType.RESEARCH_AGENT_RUN,
            idempotencyKey: `research:${input.researchJobId}:agent:${agentName}`,
            correlationId: input.correlationId,
            payload: { researchJobId: input.researchJobId, agentName },
            userId: input.userId,
            researchJobId: input.researchJobId,
            agentName,
          },
          {
            publisher: dependencies.publisher,
            environment: dependencies.environment,
          },
        );
      }
    }
    await db.researchJob.updateMany({
      where: {
        id: input.researchJobId,
        status: { not: ResearchStatus.CANCELLED },
      },
      data: {
        status:
          failedSpecialists > 0
            ? ResearchStatus.PARTIALLY_COMPLETED
            : ResearchStatus.RUNNING,
      },
    });
    return { completedSpecialists, cancelled: false };
  }

  const synthesis = await enqueueBackgroundJob(
    {
      type: BackgroundJobType.RESEARCH_SYNTHESIS,
      idempotencyKey: `research:${input.researchJobId}:synthesis`,
      correlationId: input.correlationId,
      payload: { researchJobId: input.researchJobId },
      userId: input.userId,
      researchJobId: input.researchJobId,
    },
    {
      publisher: dependencies.publisher,
      environment: dependencies.environment,
    },
  );
  if (
    synthesis.status === BackgroundJobStatus.FAILED ||
    synthesis.status === BackgroundJobStatus.PARTIALLY_COMPLETED ||
    synthesis.status === BackgroundJobStatus.CANCELLED
  ) {
    throw new JobExecutionError(
      "RESEARCH_SYNTHESIS_DISPATCH_FAILED",
      true,
      "Research synthesis requires an administrator retry.",
      true,
    );
  }
  return { completedSpecialists, cancelled: false };
}

export async function executeResearchAgent(
  input: {
    researchJobId: string;
    agentName: SpecialistAgentName;
    userId: string;
    correlationId: string;
    attemptNumber?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
  },
  dependencies: BackgroundDependencies = {},
) {
  const researchJob = await db.researchJob.findFirst({
    where: { id: input.researchJobId, userId: input.userId },
    include: { stock: true, agentRuns: true },
  });
  if (!researchJob || researchJob.status === ResearchStatus.CANCELLED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_NOT_FOUND",
      false,
      "The owned research job no longer exists.",
    );
  }
  if (researchJob.status === ResearchStatus.FAILED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_FAILED",
      false,
      "The research job is already in a terminal failed state.",
      true,
    );
  }
  const existing = researchJob.agentRuns.find(
    (run) => run.agentName === input.agentName,
  );
  if (existing?.status === AgentStatus.COMPLETED) {
    const state = await enqueueSynthesisIfReady(input, dependencies);
    return {
      researchJobId: researchJob.id,
      agentName: input.agentName,
      ...state,
    };
  }

  await db.$transaction(async (transaction) => {
    const started = await transaction.researchJob.updateMany({
      where: {
        id: researchJob.id,
        status: {
          notIn: [
            ResearchStatus.CANCELLED,
            ResearchStatus.COMPLETED,
            ResearchStatus.FAILED,
          ],
        },
      },
      data: {
        status: ResearchStatus.RUNNING,
        startedAt: researchJob.startedAt ?? new Date(),
      },
    });
    if (started.count === 0) {
      throw new JobExecutionError(
        "RESEARCH_JOB_FAILED",
        false,
        "The research job entered a terminal state before execution.",
        true,
      );
    }
    await transaction.agentRun.upsert({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: input.agentName,
        },
      },
      update: { status: AgentStatus.RUNNING, startedAt: new Date() },
      create: {
        researchJobId: researchJob.id,
        agentName: input.agentName,
        status: AgentStatus.RUNNING,
        summary: "",
        findingsJson: [],
        sourcesJson: [],
        warningsJson: [],
      },
    });
  });

  try {
    if (researchJob.generationMode === ResearchGenerationMode.DETERMINISTIC) {
      const providerData = await seededResearchProvider.getResearchData(
        researchJob.stock.ticker,
        { userId: input.userId },
      );
      if (!providerData) {
        throw new JobExecutionError(
          "RESEARCH_INPUT_UNAVAILABLE",
          false,
          "Deterministic research inputs are unavailable.",
        );
      }
      const result = runSpecialist(input.agentName, providerData);
      await updateAgentRun(researchJob.id, input.agentName, result, {
        provider: "seeded",
        agentVersion: "deterministic-v1",
      });
    } else {
      const snapshot = await snapshotForJob(researchJob.id, dependencies);
      if (!snapshot) {
        throw new GroundedModelCallError(
          "AI_SOURCE_SNAPSHOT_UNAVAILABLE",
          false,
          true,
        );
      }

      // News is a model call only when the snapshot lists at least one Form
      // 8-K current report; otherwise it reports the gap without a call, so
      // it never invents recency (M32).
      if (
        input.agentName === "POLITICAL_ACTIVITY" ||
        (input.agentName === "NEWS" && !hasCurrentReportEvidence(snapshot))
      ) {
        const output = missingExternalSpecialist(
          input.agentName,
          publicDataGap(input.agentName),
        );
        await updateAgentRun(
          researchJob.id,
          input.agentName,
          externalAgentResult(input.agentName, output, []),
          {
            provider: "bounded-missing-data",
            agentVersion: AI_SPECIALIST_AGENT_VERSION,
            promptVersion: AI_PROMPT_VERSION,
            outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
          },
        );
      } else {
        const environment = dependencies.environment ?? process.env;
        if (
          !dependencies.provider &&
          !isFeatureEnabled("AI_RESEARCH_ENABLED", environment)
        ) {
          throw new GroundedModelCallError("AI_RESEARCH_DISABLED", false, true);
        }
        const operation = `SPECIALIST_${input.agentName}`;
        await assertUsageReconciled(researchJob.id, operation);
        const config = boundAiConfig(
          researchJob.generationConfigJson,
          environment,
          dependencies,
        );
        const evidenceSelection = selectSpecialistEvidence(
          snapshot,
          input.agentName,
        );
        const evidence = [...evidenceSelection.evidence];
        const generated = await runGroundedModelCall(
          {
            provider: modelProvider(config, dependencies),
            config,
            schema: specialistModelOutputSchema,
            schemaName: `research_${input.agentName.toLowerCase()}_v1`,
            evidence,
            prompt: (repairFeedback) =>
              specialistPrompt({
                agentName: input.agentName,
                ticker: researchJob.stock.ticker,
                companyName: researchJob.stock.companyName,
                asOfDate: utcDateString(researchJob.createdAt),
                evidence,
                evidenceContext: evidenceSelection.context,
                repairFeedback,
              }),
            userId: input.userId,
            researchJobId: researchJob.id,
            agentRunId: existing?.id,
            operation,
            idempotencyKey: `research:${researchJob.id}:agent:${input.agentName}:delivery:${input.attemptNumber ?? 1}`,
            now: dependencies.now?.(),
            signal: input.signal,
          },
          { environment },
        );
        const result = externalAgentResult(
          input.agentName,
          generated.output,
          evidence,
        );
        await updateAgentRun(
          researchJob.id,
          input.agentName,
          result,
          {
            provider: generated.providerResult.provider,
            model: generated.providerResult.model,
            modelConfigJson: { maxOutputTokens: config.maxOutputTokensPerCall },
            promptVersion: AI_PROMPT_VERSION,
            outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
            agentVersion: AI_SPECIALIST_AGENT_VERSION,
          },
          generated.reservation
            ? {
                usageId: generated.reservation.usageId,
                inputTokens: generated.providerResult.usage.inputTokens,
                cachedInputTokens:
                  generated.providerResult.usage.cachedInputTokens,
                outputTokens: generated.providerResult.usage.outputTokens,
                reasoningTokens: generated.providerResult.usage.reasoningTokens,
                providerTotalTokens: generated.providerResult.usage.totalTokens,
                providerRequestId: generated.providerResult.providerRequestId,
              }
            : null,
        );
      }
    }

    const state = await enqueueSynthesisIfReady(input, dependencies);
    return {
      researchJobId: researchJob.id,
      agentName: input.agentName,
      ...state,
    };
  } catch (error) {
    if (isUsageReconciliationError(error)) {
      await throwSpecialistReconciliationError(
        error,
        researchJob.id,
        input.agentName,
      );
    }
    const completedRun = await db.agentRun.findUnique({
      where: {
        researchJobId_agentName: {
          researchJobId: researchJob.id,
          agentName: input.agentName,
        },
      },
      select: { status: true },
    });
    if (completedRun?.status === AgentStatus.COMPLETED) {
      await db.researchJob.updateMany({
        where: {
          id: researchJob.id,
          status: { not: ResearchStatus.CANCELLED },
        },
        data: { status: ResearchStatus.PARTIALLY_COMPLETED },
      });
      if (error instanceof JobExecutionError) throw error;
      throw new JobExecutionError(
        "RESEARCH_SYNTHESIS_DISPATCH_FAILED",
        true,
        "Research synthesis could not be dispatched.",
        true,
        { cause: error },
      );
    }

    const attemptNumber = input.attemptNumber ?? 1;
    const maxAttempts = input.maxAttempts ?? 3;
    const isModelFailure =
      error instanceof GroundedModelCallError ||
      error instanceof AiBudgetError ||
      error instanceof AiConfigurationError ||
      error instanceof ResearchEvidenceSnapshotError;
    const retryable =
      error instanceof GroundedModelCallError && error.retryable;
    if (
      researchJob.generationMode !== ResearchGenerationMode.DETERMINISTIC &&
      isModelFailure &&
      (!retryable || attemptNumber >= maxAttempts)
    ) {
      const reason = `${SPECIALIST_TOPIC_LABELS[input.agentName]} could not be completed for this report, so its findings are missing.`;
      const output = missingExternalSpecialist(input.agentName, reason);
      await updateAgentRun(
        researchJob.id,
        input.agentName,
        externalAgentResult(input.agentName, output, []),
        {
          provider: "partial-fallback",
          agentVersion: AI_SPECIALIST_AGENT_VERSION,
          promptVersion: AI_PROMPT_VERSION,
          outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
        },
      );
      const state = await enqueueSynthesisIfReady(input, dependencies);
      return {
        researchJobId: researchJob.id,
        agentName: input.agentName,
        partial: true,
        ...state,
      };
    }

    await db.$transaction([
      db.agentRun.update({
        where: {
          researchJobId_agentName: {
            researchJobId: researchJob.id,
            agentName: input.agentName,
          },
        },
        data: { status: AgentStatus.FAILED, completedAt: new Date() },
      }),
      db.researchJob.updateMany({
        where: {
          id: researchJob.id,
          status: { not: ResearchStatus.CANCELLED },
        },
        data: { status: ResearchStatus.PARTIALLY_COMPLETED },
      }),
    ]);
    if (error instanceof JobExecutionError) throw error;
    if (error instanceof GroundedModelCallError) {
      throw new JobExecutionError(
        error.code,
        error.retryable,
        error.message,
        true,
        { cause: error },
      );
    }
    throw new JobExecutionError(
      "RESEARCH_AGENT_FAILED",
      true,
      researchJob.generationMode === ResearchGenerationMode.DETERMINISTIC
        ? "A deterministic research agent failed."
        : "An evidence-grounded research specialist failed.",
      true,
      { cause: error },
    );
  }
}

function specialistOutput(run: {
  rating: string | null;
  confidence: { toNumber(): number } | null;
  availability: string | null;
  summary: string;
  claimsJson: Prisma.JsonValue | null;
  warningsJson: Prisma.JsonValue;
  missingDataJson: Prisma.JsonValue | null;
}): SpecialistModelOutput {
  const parsed = specialistModelOutputSchema.safeParse({
    rating: run.rating ?? "NEUTRAL",
    confidence: run.confidence?.toNumber() ?? 0,
    availability: run.availability ?? "NOT_AVAILABLE",
    summary: run.summary,
    claims: jsonArray<ModelClaim>(run.claimsJson),
    warnings: jsonArray<string>(run.warningsJson),
    missingData: jsonArray<string>(run.missingDataJson),
  });
  if (parsed.success) return parsed.data;
  // A run persisted under an earlier output schema (for example claims
  // without a kind) cannot be forwarded as claims. It becomes an explicit gap
  // so synthesis still completes instead of leaving the job stuck.
  const reason =
    "This specialist result was recorded under an earlier output schema and could not be forwarded.";
  return {
    rating: "NEUTRAL",
    confidence: 0,
    availability: "NOT_AVAILABLE",
    summary: run.summary || reason,
    claims: [],
    warnings: [],
    missingData: [reason],
  };
}

function partialSynthesis(
  companyName: string,
  specialists: Array<{
    agentName: SpecialistAgentName;
    output: SpecialistModelOutput;
  }>,
  evidence: ResearchEvidence[],
): SynthesisModelOutput {
  const allowedEvidenceIds = new Set(evidence.map((item) => item.id));
  const ordered = [...specialists].sort(
    (left, right) =>
      FALLBACK_CLAIM_ORDER.indexOf(left.agentName) -
      FALLBACK_CLAIM_ORDER.indexOf(right.agentName),
  );
  let unavailableClaims = 0;
  const queues = ordered.map((specialist) =>
    specialist.output.claims.filter((claim) => {
      const references = [...claim.evidenceIds, ...claim.counterEvidenceIds];
      const available = references.every((reference) =>
        allowedEvidenceIds.has(reference),
      );
      if (!available) unavailableClaims += 1;
      return available;
    }),
  );
  // Take one claim from each topic in turn so the claim limit keeps every
  // topic represented instead of filling up from the first specialist.
  const uniqueClaims = new Map<string, ModelClaim>();
  for (
    let index = 0;
    uniqueClaims.size < FALLBACK_MAX_CLAIMS &&
    queues.some((queue) => index < queue.length);
    index += 1
  ) {
    for (const queue of queues) {
      const claim = queue[index];
      if (claim && uniqueClaims.size < FALLBACK_MAX_CLAIMS) {
        uniqueClaims.set(claimKey(claim), claim);
      }
    }
  }
  const completed = specialists.filter(
    (specialist) => specialist.output.confidence > 0,
  );
  const confidence = completed.length
    ? completed.reduce((sum, item) => sum + item.output.confidence, 0) /
      completed.length
    : 0;
  const retainedClaims = [...uniqueClaims.values()];
  const output = synthesisModelOutputSchema.parse({
    rating: ratingForClaims(retainedClaims),
    confidence: Number(confidence.toFixed(3)),
    summary: `This ${companyName} report lists the individual topic findings because the combined summary step was unavailable. It is research context, not financial advice.`,
    claims: retainedClaims,
    warnings: [
      "The combined summary step was unavailable, so the topic findings are listed without a combined interpretation.",
      ...(unavailableClaims > 0
        ? [
            "Some findings were left out because their cited sources could not be shown.",
          ]
        : []),
    ],
    missingData: [
      ...new Set(ordered.flatMap((item) => item.output.missingData)),
    ].slice(0, 10),
    disagreements: [],
    whatWouldChange: [],
  });
  return validateGroundedOutput(output, evidence);
}

function latestEvidenceDate(claim: ModelClaim, evidence: ResearchEvidence[]) {
  const cited = new Set([...claim.evidenceIds, ...claim.counterEvidenceIds]);
  return evidence
    .filter((item) => cited.has(item.id) && item.sourceDate)
    .map((item) => item.sourceDate!)
    .sort()
    .at(-1);
}

async function persistExternalReport(input: {
  researchJob: {
    id: string;
    stockId: string;
    createdAt: Date;
    sourceSnapshotSha256: string | null;
    retrievalVersion: string | null;
    calculationVersion: string | null;
    inputDataVersion: string | null;
  };
  output: SynthesisModelOutput;
  evidence: ResearchEvidence[];
  /** The immutable snapshot the coverage measure is computed from; null when it could not be restored. */
  snapshot: ResearchEvidenceSnapshot | null;
  provider: string;
  model: string | null;
  config: AiResearchConfig | null;
  reservation: ChargedAiUsage | null;
  verification?: ClaimVerification | null;
  /** Checkpoint validated synthesis and its usage before reserving verification. */
  complete?: boolean;
}) {
  const completedAt = new Date();
  const asOfDate = startOfUtcDay(input.researchJob.createdAt);
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const evidenceCoverage = input.snapshot
    ? (computeEvidenceCoverage(
        input.snapshot,
        utcDateString(input.researchJob.createdAt),
      ) as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  let reconciliationRequired = false;
  let verification = input.verification ?? null;

  try {
    await db.$transaction(async (transaction) => {
      if (input.reservation) {
        const settled = await settleAiUsageInTransaction(
          transaction,
          input.reservation.usageId,
          input.reservation,
        );
        if (settled.status === AiUsageStatus.UNCONFIRMED) {
          if (input.verification) {
            // Verification accounting uncertainty preserves the validated draft,
            // while the existing UNCONFIRMED ledger blocks future spending.
            verification = null;
          } else {
            reconciliationRequired = true;
            return;
          }
        }
      }
      const originalOutput = input.output;
      const output =
        input.complete === false
          ? originalOutput
          : applyClaimVerification(originalOutput, verification);
      const synthesis = await transaction.agentRun.upsert({
        where: {
          researchJobId_agentName: {
            researchJobId: input.researchJob.id,
            agentName: AgentName.SYNTHESIS,
          },
        },
        update: {
          status: AgentStatus.COMPLETED,
          rating: output.rating,
          confidence: output.confidence,
          summary: output.summary,
          findingsJson: output.claims.map((claim) => ({
            label: claim.category.toLowerCase(),
            detail: claim.statement,
          })),
          sourcesJson: sourcesFromEvidence(
            citedEvidence(output.claims, input.evidence),
          ),
          warningsJson: output.warnings,
          claimsJson: output.claims,
          missingDataJson: output.missingData,
          provider: input.provider,
          model: input.model,
          modelConfigJson: input.config
            ? { maxOutputTokens: input.config.maxOutputTokensPerCall }
            : Prisma.JsonNull,
          promptVersion: AI_PROMPT_VERSION,
          outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
          agentVersion: AI_SYNTHESIS_AGENT_VERSION,
          completedAt,
        },
        create: {
          researchJobId: input.researchJob.id,
          agentName: AgentName.SYNTHESIS,
          status: AgentStatus.COMPLETED,
          rating: output.rating,
          confidence: output.confidence,
          summary: output.summary,
          findingsJson: output.claims.map((claim) => ({
            label: claim.category.toLowerCase(),
            detail: claim.statement,
          })),
          sourcesJson: sourcesFromEvidence(
            citedEvidence(output.claims, input.evidence),
          ),
          warningsJson: output.warnings,
          claimsJson: output.claims,
          missingDataJson: output.missingData,
          provider: input.provider,
          model: input.model,
          modelConfigJson: input.config
            ? { maxOutputTokens: input.config.maxOutputTokensPerCall }
            : Prisma.JsonNull,
          promptVersion: AI_PROMPT_VERSION,
          outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
          agentVersion: AI_SYNTHESIS_AGENT_VERSION,
          completedAt,
        },
      });

      const usage = await transaction.aiUsage.aggregate({
        where: { researchJobId: input.researchJob.id, status: "SETTLED" },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          estimatedCostUsd: true,
        },
      });
      const report = await transaction.researchReport.upsert({
        where: { researchJobId: input.researchJob.id },
        update: {
          overview: output.summary,
          rating: output.rating,
          bullCaseJson: output.claims
            .filter((claim) => claim.category === "SUPPORTIVE")
            .map((claim) => claim.statement),
          bearCaseJson: output.claims
            .filter((claim) => claim.category === "COUNTERPOINT")
            .map((claim) => claim.statement),
          risksJson: [
            ...output.claims
              .filter((claim) => claim.category === "RISK")
              .map((claim) => claim.statement),
          ],
          missingDataJson: output.missingData,
          disagreementsJson: output.disagreements,
          confidence: output.confidence,
          provider: input.provider,
          model: input.model,
          modelConfigJson: input.config
            ? { maxOutputTokens: input.config.maxOutputTokensPerCall }
            : Prisma.JsonNull,
          promptVersion: AI_PROMPT_VERSION,
          retrievalVersion: input.researchJob.retrievalVersion,
          calculationVersion: input.researchJob.calculationVersion,
          inputDataVersion: input.researchJob.inputDataVersion,
          outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
          sourceSnapshotSha256: input.researchJob.sourceSnapshotSha256,
          inputTokens: usage._sum.inputTokens ?? 0,
          outputTokens: usage._sum.outputTokens ?? 0,
          estimatedCostUsd: usage._sum.estimatedCostUsd ?? 0,
          reportVersion: AI_REPORT_VERSION,
          evidenceCoverageJson: evidenceCoverage,
          whatWouldChangeJson: output.whatWouldChange,
          verificationCompleted: verification !== null,
          generatedAt: completedAt,
          expiresAt: expiresAtFrom(completedAt),
        },
        create: {
          researchJobId: input.researchJob.id,
          stockId: input.researchJob.stockId,
          overview: output.summary,
          rating: output.rating,
          bullCaseJson: output.claims
            .filter((claim) => claim.category === "SUPPORTIVE")
            .map((claim) => claim.statement),
          bearCaseJson: output.claims
            .filter((claim) => claim.category === "COUNTERPOINT")
            .map((claim) => claim.statement),
          risksJson: [
            ...output.claims
              .filter((claim) => claim.category === "RISK")
              .map((claim) => claim.statement),
          ],
          missingDataJson: output.missingData,
          disagreementsJson: output.disagreements,
          confidence: output.confidence,
          provider: input.provider,
          model: input.model,
          modelConfigJson: input.config
            ? { maxOutputTokens: input.config.maxOutputTokensPerCall }
            : Prisma.JsonNull,
          promptVersion: AI_PROMPT_VERSION,
          retrievalVersion: input.researchJob.retrievalVersion,
          calculationVersion: input.researchJob.calculationVersion,
          inputDataVersion: input.researchJob.inputDataVersion,
          outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
          sourceSnapshotSha256: input.researchJob.sourceSnapshotSha256,
          inputTokens: usage._sum.inputTokens ?? 0,
          outputTokens: usage._sum.outputTokens ?? 0,
          estimatedCostUsd: usage._sum.estimatedCostUsd ?? 0,
          reportVersion: AI_REPORT_VERSION,
          evidenceCoverageJson: evidenceCoverage,
          whatWouldChangeJson: output.whatWouldChange,
          verificationCompleted: verification !== null,
          generatedAt: completedAt,
          expiresAt: expiresAtFrom(completedAt),
        },
      });
      await transaction.researchClaim.deleteMany({
        where: { reportId: report.id },
      });

      for (const [ordinal, claim] of originalOutput.claims.entries()) {
        const result = verification?.results[ordinal];
        if (result?.status === "UNSUPPORTED") continue;
        const cited = [...claim.evidenceIds, ...claim.counterEvidenceIds]
          .map((id) => evidenceById.get(id))
          .filter((item): item is ResearchEvidence => Boolean(item));
        await transaction.researchClaim.create({
          data: {
            reportId: report.id,
            agentRunId: synthesis.id,
            claimKey: claimKey(claim),
            category: claim.category,
            kind: claim.kind,
            verificationStatus: result?.status ?? "UNVERIFIED",
            verificationEvidenceIdsJson: result?.contradictingEvidenceIds ?? [],
            statement: claim.statement,
            confidence: claim.confidence,
            assumptionsJson: claim.assumptions,
            sourceDate: latestEvidenceDate(claim, input.evidence)
              ? new Date(
                  `${latestEvidenceDate(claim, input.evidence)}T00:00:00.000Z`,
                )
              : null,
            asOfDate,
            ordinal,
            evidence: {
              create: cited.map((evidence, evidenceOrdinal) => ({
                role: claim.evidenceIds.includes(evidence.id)
                  ? ("SUPPORTING" as const)
                  : ("COUNTER" as const),
                referenceKey: evidence.id,
                ordinal: evidenceOrdinal,
                sourceKind: evidence.sourceKind,
                title: evidence.title,
                sourceReference: evidence.sourceReference,
                secFilingId: evidence.secFilingId,
                secRawSourceId: evidence.secRawSourceId,
                secFinancialFactId: evidence.secFinancialFactId,
                accessionNumber: evidence.accessionNumber,
                section: evidence.section,
                sourceUrl: evidence.sourceUrl,
                objectKey: evidence.objectKey,
                sha256: evidence.sha256,
                retrievedAt: evidence.retrievedAt
                  ? new Date(evidence.retrievedAt)
                  : null,
                sourceDate: evidence.sourceDate
                  ? new Date(`${evidence.sourceDate}T00:00:00.000Z`)
                  : null,
                passageStart: evidence.passageStart,
                passageEnd: evidence.passageEnd,
                excerpt: evidence.excerpt,
                metadataJson: evidence.metadata as Prisma.InputJsonValue,
              })),
            },
          },
        });
      }
      await transaction.researchJob.update({
        where: { id: input.researchJob.id },
        data:
          input.complete === false
            ? { status: ResearchStatus.RUNNING }
            : { status: ResearchStatus.COMPLETED, completedAt },
      });
    });
  } catch (error) {
    if (input.reservation) {
      await failClosedAfterChargedPersistenceFailure(input.reservation);
    }
    throw error;
  }
  if (reconciliationRequired) {
    throw new AiBudgetError(
      "AI_USAGE_RECONCILIATION_REQUIRED",
      "Provider usage requires cost reconciliation.",
    );
  }
  return completedAt;
}

export async function executeResearchSynthesis(
  input: {
    researchJobId: string;
    userId: string;
    attemptNumber?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  },
  dependencies: BackgroundDependencies = {},
) {
  const deadlineAt = input.deadlineAt ?? Date.now() + 60_000;
  const researchJob = await db.researchJob.findFirst({
    where: { id: input.researchJobId, userId: input.userId },
    include: { stock: true, agentRuns: true, report: true },
  });
  if (!researchJob || researchJob.status === ResearchStatus.CANCELLED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_NOT_FOUND",
      false,
      "The owned research job no longer exists.",
    );
  }
  if (researchJob.status === ResearchStatus.FAILED) {
    throw new JobExecutionError(
      "RESEARCH_JOB_FAILED",
      false,
      "The research job is already in a terminal failed state.",
      true,
    );
  }
  if (researchJob.report && researchJob.status === ResearchStatus.COMPLETED) {
    return {
      researchJobId: researchJob.id,
      completedAt: researchJob.completedAt?.toISOString() ?? null,
      reused: true,
    };
  }

  const scheduled = scheduledSpecialistAgentNames(researchJob.generationMode);
  const specialists = researchJob.agentRuns.filter(
    (run) =>
      scheduled.some((agentName) => agentName === run.agentName) &&
      run.status === AgentStatus.COMPLETED,
  );
  if (specialists.length !== scheduled.length) {
    throw new JobExecutionError(
      "RESEARCH_INPUTS_PENDING",
      true,
      "Research synthesis is waiting for specialist results.",
      true,
    );
  }

  if (researchJob.generationMode === ResearchGenerationMode.DETERMINISTIC) {
    const agentResults = specialists.map(storedAgentResult);
    const report = synthesizeResearch(
      researchJob.stock.companyName,
      agentResults,
    );
    const synthesis: AgentResult = {
      agentName: "SYNTHESIS",
      status: "COMPLETED",
      rating: "MIXED",
      confidence: report.confidence,
      summary: report.overview,
      findings: [
        ...report.bullCase.map((detail) => ({
          label: "Supportive context",
          detail,
        })),
        ...report.bearCase.map((detail) => ({ label: "Counterpoint", detail })),
      ],
      sources: agentResults.flatMap((agent) => agent.sources),
      warnings: report.risks,
    };
    const completedAt = new Date();
    await db.$transaction([
      db.agentRun.upsert({
        where: {
          researchJobId_agentName: {
            researchJobId: researchJob.id,
            agentName: AgentName.SYNTHESIS,
          },
        },
        update: {
          status: AgentStatus.COMPLETED,
          rating: synthesis.rating,
          confidence: synthesis.confidence,
          summary: synthesis.summary,
          findingsJson: synthesis.findings,
          sourcesJson: synthesis.sources,
          warningsJson: synthesis.warnings,
          provider: "deterministic",
          agentVersion: "deterministic-v1",
          completedAt,
        },
        create: {
          researchJobId: researchJob.id,
          agentName: AgentName.SYNTHESIS,
          status: AgentStatus.COMPLETED,
          rating: synthesis.rating,
          confidence: synthesis.confidence,
          summary: synthesis.summary,
          findingsJson: synthesis.findings,
          sourcesJson: synthesis.sources,
          warningsJson: synthesis.warnings,
          provider: "deterministic",
          agentVersion: "deterministic-v1",
          completedAt,
        },
      }),
      db.researchReport.upsert({
        where: { researchJobId: researchJob.id },
        update: {
          overview: report.overview,
          bullCaseJson: report.bullCase,
          bearCaseJson: report.bearCase,
          risksJson: report.risks,
          missingDataJson: report.missingData,
          confidence: report.confidence,
          generatedAt: completedAt,
          expiresAt: expiresAtFrom(completedAt),
        },
        create: {
          researchJobId: researchJob.id,
          stockId: researchJob.stockId,
          overview: report.overview,
          bullCaseJson: report.bullCase,
          bearCaseJson: report.bearCase,
          risksJson: report.risks,
          missingDataJson: report.missingData,
          confidence: report.confidence,
          generatedAt: completedAt,
          expiresAt: expiresAtFrom(completedAt),
        },
      }),
      db.researchJob.update({
        where: { id: researchJob.id },
        data: { status: ResearchStatus.COMPLETED, completedAt },
      }),
    ]);
    return {
      researchJobId: researchJob.id,
      completedAt: completedAt.toISOString(),
    };
  }

  const typedSpecialists = specialists.map((run) => ({
    agentName: run.agentName as SpecialistAgentName,
    output: specialistOutput(run),
  }));
  const snapshot = await snapshotForJob(researchJob.id, dependencies).catch(
    () => null,
  );
  if (!snapshot) {
    const output = partialSynthesis(
      researchJob.stock.companyName,
      typedSpecialists,
      [],
    );
    output.claims = [];
    output.missingData = [
      "The immutable source snapshot was unavailable, so no claim-level evidence could be persisted.",
      ...output.missingData,
    ].slice(0, 10);
    const completedAt = await persistExternalReport({
      researchJob,
      output,
      evidence: [],
      snapshot: null,
      provider: "partial-fallback",
      model: null,
      config: null,
      reservation: null,
    });
    return {
      researchJobId: researchJob.id,
      completedAt: completedAt.toISOString(),
      partial: true,
    };
  }
  // Synthesis receives the evidence behind the specialists' claims (filing
  // passages included) after its owned structured evidence, so a claim can
  // be carried forward with the citation that grounded it.
  const evidenceSelection = selectSynthesisEvidence(snapshot, {
    specialistClaims: typedSpecialists.flatMap(
      (specialist) => specialist.output.claims,
    ),
  });
  const evidence = [...evidenceSelection.evidence];

  let output: SynthesisModelOutput;
  let providerName = "partial-fallback";
  let providerModel: string | null = null;
  let config: AiResearchConfig | null = null;
  let reservation: Parameters<typeof persistExternalReport>[0]["reservation"] =
    null;
  let reportEvidence = evidence;
  if (researchJob.report) {
    // A prior delivery checkpointed synthesis before verification. Reuse it
    // rather than paying for synthesis again after a worker interruption.
    const storedSynthesis = researchJob.agentRuns.find(
      (run) => run.agentName === "SYNTHESIS",
    );
    output = synthesisModelOutputSchema.parse({
      rating: researchJob.report.rating,
      confidence: researchJob.report.confidence.toNumber(),
      summary: researchJob.report.overview,
      claims: jsonArray<ModelClaim>(storedSynthesis?.claimsJson ?? null),
      warnings: jsonArray<string>(storedSynthesis?.warningsJson ?? null),
      missingData: jsonArray<string>(researchJob.report.missingDataJson),
      disagreements: jsonArray<string>(researchJob.report.disagreementsJson),
      whatWouldChange: jsonArray<string>(
        researchJob.report.whatWouldChangeJson,
      ),
    });
    providerName = researchJob.report.provider ?? "partial-fallback";
    providerModel = researchJob.report.model;
    reportEvidence = [...snapshot.evidence];
    validateGroundedOutput(output, reportEvidence);
  } else {
    try {
      const environment = dependencies.environment ?? process.env;
      if (
        !dependencies.provider &&
        !isFeatureEnabled("AI_RESEARCH_ENABLED", environment)
      ) {
        throw new GroundedModelCallError("AI_RESEARCH_DISABLED", false, true);
      }
      const operation = "SYNTHESIS";
      await assertUsageReconciled(researchJob.id, operation);
      config = boundAiConfig(
        researchJob.generationConfigJson,
        environment,
        dependencies,
      );
      const generated = await runGroundedModelCall(
        {
          provider: modelProvider(config, dependencies),
          config,
          schema: synthesisModelOutputSchema,
          schemaName: "research_synthesis_v1",
          evidence,
          prompt: (repairFeedback) =>
            synthesisPrompt({
              ticker: researchJob.stock.ticker,
              companyName: researchJob.stock.companyName,
              asOfDate: utcDateString(researchJob.createdAt),
              evidence,
              evidenceContext: evidenceSelection.context,
              specialists: typedSpecialists,
              repairFeedback,
            }),
          userId: input.userId,
          researchJobId: researchJob.id,
          operation,
          idempotencyKey: `research:${researchJob.id}:synthesis:delivery:${input.attemptNumber ?? 1}`,
          now: dependencies.now?.(),
          signal: input.signal,
        },
        { environment },
      );
      output = generated.output;
      providerName = generated.providerResult.provider;
      providerModel = generated.providerResult.model;
      if (generated.reservation) {
        reservation = {
          usageId: generated.reservation.usageId,
          inputTokens: generated.providerResult.usage.inputTokens,
          cachedInputTokens: generated.providerResult.usage.cachedInputTokens,
          outputTokens: generated.providerResult.usage.outputTokens,
          reasoningTokens: generated.providerResult.usage.reasoningTokens,
          providerTotalTokens: generated.providerResult.usage.totalTokens,
          providerRequestId: generated.providerResult.providerRequestId,
        };
      }
    } catch (error) {
      if (isUsageReconciliationError(error)) {
        await throwSynthesisReconciliationError(error, researchJob.id);
      }
      const attemptNumber = input.attemptNumber ?? 1;
      const maxAttempts = input.maxAttempts ?? 3;
      if (
        error instanceof GroundedModelCallError &&
        error.retryable &&
        attemptNumber < maxAttempts
      ) {
        throw new JobExecutionError(error.code, true, error.message, true, {
          cause: error,
        });
      }
      if (
        !(error instanceof GroundedModelCallError) &&
        !(error instanceof AiBudgetError) &&
        !(error instanceof AiConfigurationError)
      ) {
        throw error;
      }
      const snapshotEvidence = [...snapshot.evidence];
      output = partialSynthesis(
        researchJob.stock.companyName,
        typedSpecialists,
        snapshotEvidence,
      );
      reportEvidence = citedEvidence(output.claims, snapshotEvidence);
    }
    try {
      await persistExternalReport({
        researchJob,
        output,
        evidence: reportEvidence,
        snapshot,
        provider: providerName,
        model: providerModel,
        config,
        reservation,
        complete: false,
      });
    } catch (error) {
      if (isUsageReconciliationError(error)) {
        await throwSynthesisReconciliationError(error, researchJob.id);
      }
      throw error;
    }
    reservation = null;
  }

  let verification: ClaimVerification | null = null;
  try {
    const environment = dependencies.environment ?? process.env;
    config ??= boundAiConfig(
      researchJob.generationConfigJson,
      environment,
      dependencies,
    );
    // Keep time for settlement and final persistence inside the existing worker
    // deadline even after a slow synthesis and its one repair.
    const verifierTimeoutMs = Math.min(
      config.providerTimeoutMs,
      deadlineAt - Date.now() - 5_000,
    );
    if (verifierTimeoutMs < 1_000)
      throw new Error("Insufficient verification time.");
    const verifierConfig = { ...config, providerTimeoutMs: verifierTimeoutMs };
    const verifierSignal = AbortSignal.any([
      ...(input.signal ? [input.signal] : []),
      AbortSignal.timeout(verifierTimeoutMs),
    ]);
    const generated = await runValidatedModelCall(
      {
        provider: modelProvider(verifierConfig, dependencies),
        config: verifierConfig,
        schema: claimVerificationSchema,
        schemaName: "research_claim_verification_v1",
        validate: (result) => validateClaimVerification(result, output),
        maxAttempts: 1,
        maxOutputTokens: AI_VERIFIER_MAX_OUTPUT_TOKENS,
        prompt: () => verificationPrompt(output, reportEvidence),
        userId: input.userId,
        researchJobId: researchJob.id,
        operation: "CLAIM_VERIFICATION",
        // Stable across deliveries: a report never buys a second verifier call.
        idempotencyKey: `research:${researchJob.id}:verification`,
        now: dependencies.now?.(),
        signal: verifierSignal,
      },
      { environment },
    );
    verification = generated.output;
    if (generated.reservation) {
      reservation = {
        usageId: generated.reservation.usageId,
        inputTokens: generated.providerResult.usage.inputTokens,
        cachedInputTokens: generated.providerResult.usage.cachedInputTokens,
        outputTokens: generated.providerResult.usage.outputTokens,
        reasoningTokens: generated.providerResult.usage.reasoningTokens,
        providerTotalTokens: generated.providerResult.usage.totalTokens,
        providerRequestId: generated.providerResult.providerRequestId,
      };
    }
  } catch {
    // Provider refusal, invalid output, kill switch, budget exhaustion, or a
    // previous uncertain attempt must not discard the M30-validated draft.
    verification = null;
  }

  let completedAt: Date;
  try {
    completedAt = await persistExternalReport({
      researchJob,
      output,
      evidence: reportEvidence,
      snapshot,
      provider: providerName,
      model: providerModel,
      config,
      reservation,
      verification,
    });
  } catch (error) {
    if (isUsageReconciliationError(error)) {
      await throwSynthesisReconciliationError(error, researchJob.id);
    }
    throw error;
  }
  return {
    researchJobId: researchJob.id,
    completedAt: completedAt.toISOString(),
    partial: providerName === "partial-fallback",
  };
}
