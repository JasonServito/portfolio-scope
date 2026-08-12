import { BackgroundJobType, type Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import { JobErrorCode, JobExecutionError } from "@/lib/jobs/errors";
import {
  backgroundJobRepository,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/repository";
import { parseJobPayload } from "@/lib/jobs/types";
import { refreshPortfolioSnapshot } from "@/lib/portfolio/snapshot-service";
import {
  executeResearchAgent,
  executeResearchSynthesis,
} from "@/lib/research/background";
import {
  executeSecIngestionJob,
  fetchSecFilingDocument,
  queueSecIngestion,
  renormalizeStoredCompanyFacts,
} from "@/lib/sec/jobs";

function requireLink(value: string | null, expected: string, label: string) {
  if (!value || value !== expected) {
    throw new JobExecutionError(
      JobErrorCode.INVALID_PAYLOAD,
      false,
      `The job ${label} binding is invalid.`,
    );
  }
  return value;
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new JobExecutionError(
      JobErrorCode.TIMEOUT,
      true,
      "The job execution was cancelled by its timeout.",
    );
  }
}

export async function executeBackgroundJobHandler(
  job: ClaimedBackgroundJob,
  signal: AbortSignal,
): Promise<Prisma.InputJsonValue> {
  assertNotAborted(signal);

  switch (job.type) {
    case BackgroundJobType.SEC_SUBMISSIONS_SYNC:
    case BackgroundJobType.SEC_COMPANY_FACTS_SYNC: {
      const payload = parseJobPayload(job.type, job.payloadJson);
      if (!job.companyId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The SEC job is missing its company binding.",
        );
      }
      return executeSecIngestionJob({
        ticker: payload.ticker,
        requestedByUserId: job.userId,
        companyId: job.companyId,
        correlationId: job.correlationId,
        timeoutMs: job.timeoutMs,
      });
    }

    case BackgroundJobType.SEC_FILING_FETCH: {
      const payload = parseJobPayload(
        BackgroundJobType.SEC_FILING_FETCH,
        job.payloadJson,
      );
      if (!job.companyId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The filing job is missing its company binding.",
        );
      }
      return fetchSecFilingDocument(payload);
    }

    case BackgroundJobType.SEC_FACT_NORMALIZATION: {
      const payload = parseJobPayload(
        BackgroundJobType.SEC_FACT_NORMALIZATION,
        job.payloadJson,
      );
      if (!job.companyId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The normalization job is missing its company binding.",
        );
      }
      return renormalizeStoredCompanyFacts(payload);
    }

    case BackgroundJobType.PORTFOLIO_SNAPSHOT_REFRESH: {
      const payload = parseJobPayload(
        BackgroundJobType.PORTFOLIO_SNAPSHOT_REFRESH,
        job.payloadJson,
      );
      requireLink(job.portfolioId, payload.portfolioId, "portfolio");
      if (!job.userId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The portfolio job is missing its owner binding.",
        );
      }
      return refreshPortfolioSnapshot({
        portfolioId: payload.portfolioId,
        userId: job.userId,
        asOf: new Date(payload.asOf),
      });
    }

    case BackgroundJobType.RESEARCH_AGENT_RUN: {
      const payload = parseJobPayload(
        BackgroundJobType.RESEARCH_AGENT_RUN,
        job.payloadJson,
      );
      requireLink(job.researchJobId, payload.researchJobId, "research");
      if (!job.userId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The research job is missing its owner binding.",
        );
      }
      return executeResearchAgent({
        researchJobId: payload.researchJobId,
        agentName: payload.agentName,
        userId: job.userId,
        correlationId: job.correlationId,
        attemptNumber: job.attemptCount,
        maxAttempts: job.maxAttempts,
        signal,
      });
    }

    case BackgroundJobType.RESEARCH_SYNTHESIS: {
      const payload = parseJobPayload(
        BackgroundJobType.RESEARCH_SYNTHESIS,
        job.payloadJson,
      );
      requireLink(job.researchJobId, payload.researchJobId, "research");
      if (!job.userId) {
        throw new JobExecutionError(
          JobErrorCode.INVALID_PAYLOAD,
          false,
          "The research job is missing its owner binding.",
        );
      }
      return executeResearchSynthesis({
        researchJobId: payload.researchJobId,
        userId: job.userId,
        attemptNumber: job.attemptCount,
        maxAttempts: job.maxAttempts,
        signal,
      });
    }

    case BackgroundJobType.MAINTENANCE_CLEANUP: {
      const payload = parseJobPayload(
        BackgroundJobType.MAINTENANCE_CLEANUP,
        job.payloadJson,
      );
      if (payload.operation === "RECOVER_STALE_JOBS") {
        const now = new Date();
        const staleRunningCutoff = new Date(now.getTime() - 10 * 60 * 1000);
        const undeliveredCutoff = new Date(now.getTime() - 15 * 60 * 1000);
        const staleRunning =
          await backgroundJobRepository.recoverStaleRunningJobs(
            staleRunningCutoff,
            now,
          );
        const undelivered =
          await backgroundJobRepository.failUndeliveredQueuedJobs(
            undeliveredCutoff,
            now,
          );
        return { ...staleRunning, undeliveredFailed: undelivered.count };
      }

      if (!isBackgroundFeatureEnabled("SEC_INGESTION_ENABLED")) {
        return { queued: 0, skipped: "SEC ingestion is disabled." };
      }

      const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const companies = await db.company.findMany({
        where: {
          isActive: true,
          isSupported: true,
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
        },
        select: { securities: { select: { ticker: true }, take: 1 } },
        orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
        take: 5,
      });
      const queued = [];
      for (const company of companies) {
        const ticker = company.securities[0]?.ticker;
        if (!ticker) continue;
        queued.push(
          await queueSecIngestion(ticker, {
            correlationId: job.correlationId,
          }),
        );
      }
      return { queued: queued.length };
    }
  }

  throw new JobExecutionError(
    JobErrorCode.UNSUPPORTED_TYPE,
    false,
    "The background job type is not supported.",
  );
}
