import {
  AgentName,
  BackgroundJobStatus,
  BackgroundJobType,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";

export const ACTIVE_JOB_STATUSES = [
  BackgroundJobStatus.QUEUED,
  BackgroundJobStatus.RUNNING,
  BackgroundJobStatus.RETRYING,
] as const;

export const TERMINAL_JOB_STATUSES = [
  BackgroundJobStatus.PARTIALLY_COMPLETED,
  BackgroundJobStatus.COMPLETED,
  BackgroundJobStatus.FAILED,
  BackgroundJobStatus.CANCELLED,
] as const;

export const jobDeliverySchema = z
  .object({
    jobId: z.string().trim().min(1).max(191),
  })
  .strict();

const tickerSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{1,5}$/);

export const jobPayloadSchemas = {
  [BackgroundJobType.SEC_SUBMISSIONS_SYNC]: z
    .object({ ticker: tickerSchema })
    .strict(),
  [BackgroundJobType.SEC_COMPANY_FACTS_SYNC]: z
    .object({ ticker: tickerSchema })
    .strict(),
  [BackgroundJobType.SEC_FILING_FETCH]: z
    .object({
      ticker: tickerSchema,
      accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
      primaryDocument: z.string().regex(/^[A-Za-z0-9._-]+$/),
    })
    .strict(),
  [BackgroundJobType.SEC_FACT_NORMALIZATION]: z
    .object({ ticker: tickerSchema, rawSourceId: z.string().min(1) })
    .strict(),
  [BackgroundJobType.PORTFOLIO_SNAPSHOT_REFRESH]: z
    .object({
      portfolioId: z.string().min(1),
      asOf: z.string().datetime({ offset: true }),
    })
    .strict(),
  [BackgroundJobType.RESEARCH_AGENT_RUN]: z
    .object({
      researchJobId: z.string().min(1),
      agentName: z.enum(AgentName).exclude([AgentName.SYNTHESIS]),
    })
    .strict(),
  [BackgroundJobType.RESEARCH_SYNTHESIS]: z
    .object({ researchJobId: z.string().min(1) })
    .strict(),
  [BackgroundJobType.MAINTENANCE_CLEANUP]: z
    .object({ operation: z.enum(["RECOVER_STALE_JOBS", "REFRESH_STALE_SEC"]) })
    .strict(),
} satisfies Record<BackgroundJobType, z.ZodType>;

export type JobPayload<T extends BackgroundJobType> = z.infer<
  (typeof jobPayloadSchemas)[T]
>;

export const jobPolicies = {
  [BackgroundJobType.SEC_SUBMISSIONS_SYNC]: {
    maxAttempts: 4,
    timeoutMs: 120_000,
  },
  [BackgroundJobType.SEC_COMPANY_FACTS_SYNC]: {
    maxAttempts: 4,
    timeoutMs: 120_000,
  },
  [BackgroundJobType.SEC_FILING_FETCH]: {
    maxAttempts: 4,
    timeoutMs: 90_000,
  },
  [BackgroundJobType.SEC_FACT_NORMALIZATION]: {
    maxAttempts: 2,
    timeoutMs: 120_000,
  },
  [BackgroundJobType.PORTFOLIO_SNAPSHOT_REFRESH]: {
    maxAttempts: 3,
    timeoutMs: 60_000,
  },
  [BackgroundJobType.RESEARCH_AGENT_RUN]: {
    maxAttempts: 3,
    timeoutMs: 60_000,
  },
  [BackgroundJobType.RESEARCH_SYNTHESIS]: {
    maxAttempts: 3,
    timeoutMs: 60_000,
  },
  [BackgroundJobType.MAINTENANCE_CLEANUP]: {
    maxAttempts: 2,
    timeoutMs: 60_000,
  },
} satisfies Record<
  BackgroundJobType,
  { maxAttempts: number; timeoutMs: number }
>;

export type CreateBackgroundJobInput<T extends BackgroundJobType> = {
  type: T;
  idempotencyKey: string;
  correlationId: string;
  payload: JobPayload<T>;
  userId?: string | null;
  companyId?: string | null;
  portfolioId?: string | null;
  researchJobId?: string | null;
  agentName?: AgentName | null;
};

export function parseJobPayload<T extends BackgroundJobType>(
  type: T,
  payload: Prisma.JsonValue,
): JobPayload<T> {
  return jobPayloadSchemas[type].parse(payload) as JobPayload<T>;
}

export function calculateRetryDelaySeconds(attemptNumber: number) {
  const normalizedAttempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(15 * 2 ** (normalizedAttempt - 1), 300);
}

export function canClaimJob(status: BackgroundJobStatus) {
  return (
    status === BackgroundJobStatus.QUEUED ||
    status === BackgroundJobStatus.RETRYING
  );
}

export function canCancelJob(status: BackgroundJobStatus) {
  return (
    status === BackgroundJobStatus.QUEUED ||
    status === BackgroundJobStatus.RETRYING
  );
}

export function canRetryJob(status: BackgroundJobStatus) {
  return (
    status === BackgroundJobStatus.FAILED ||
    status === BackgroundJobStatus.PARTIALLY_COMPLETED
  );
}
