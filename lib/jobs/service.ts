import { randomUUID } from "node:crypto";

import {
  BackgroundJobStatus,
  BackgroundJobType,
  type Prisma,
} from "@prisma/client";

import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import {
  JobErrorCode,
  JobExecutionError,
  JobRequestError,
  classifyJobError,
} from "@/lib/jobs/errors";
import {
  formatQstashPublishFailureDiagnostic,
  getPreviewQstashPublishFailureDiagnostic,
  publishJobMessage,
  type JobPublisher,
} from "@/lib/jobs/qstash";
import {
  PrismaBackgroundJobRepository,
  backgroundJobRepository,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/repository";
import {
  calculateRetryDelaySeconds,
  type CreateBackgroundJobInput,
} from "@/lib/jobs/types";
import { logger } from "@/lib/observability/logger";
import { reportOperationalError } from "@/lib/observability/sentry";
import { sendOperationalHeartbeat } from "@/lib/operations/heartbeat";

export type JobHandler = (
  job: ClaimedBackgroundJob,
  signal: AbortSignal,
) => Promise<Prisma.InputJsonValue>;

type ServiceDependencies = {
  repository?: PrismaBackgroundJobRepository;
  publisher?: JobPublisher;
  handler?: JobHandler;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
};

async function defaultHandler(job: ClaimedBackgroundJob, signal: AbortSignal) {
  const { executeBackgroundJobHandler } = await import("@/lib/jobs/handlers");
  return executeBackgroundJobHandler(job, signal);
}

function describePublishFailure(
  error: unknown,
  environment: NodeJS.ProcessEnv,
  productionMessage: string,
) {
  const diagnostic = getPreviewQstashPublishFailureDiagnostic(
    error,
    environment,
  );
  if (!diagnostic) {
    return {
      persistedMessage: productionMessage,
      observableError: error,
      diagnostic: undefined,
    };
  }

  const persistedMessage = formatQstashPublishFailureDiagnostic(diagnostic);
  const observableError = new Error(persistedMessage);
  observableError.name = "QstashPublishDiagnosticError";
  return { persistedMessage, observableError, diagnostic };
}

async function withJobTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new JobExecutionError(
          JobErrorCode.TIMEOUT,
          true,
          "The job exceeded its execution timeout.",
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function enqueueBackgroundJob<T extends BackgroundJobType>(
  input: CreateBackgroundJobInput<T>,
  dependencies: ServiceDependencies = {},
) {
  const environment = dependencies.environment ?? process.env;
  if (!isBackgroundFeatureEnabled("BACKGROUND_JOBS_ENABLED", environment)) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background jobs are disabled.",
    );
  }

  const repository = dependencies.repository ?? backgroundJobRepository;
  const { job, reused } = await repository.createOrReuse(input);
  logger.info(reused ? "job.enqueue.reused" : "job.enqueue.created", {
    correlationId: job.correlationId,
    jobId: job.id,
    userId: job.userId ?? undefined,
    details: { type: job.type, status: job.status },
  });
  if (!reused) {
    let messageId: string;
    try {
      const published = await publishJobMessage({
        jobId: job.id,
        type: job.type,
        maxAttempts: job.maxAttempts,
        timeoutMs: job.timeoutMs,
        correlationId: job.correlationId,
        deduplicationId: job.idempotencyKey,
        publisher: dependencies.publisher,
        environment,
      });
      messageId = published.messageId;
    } catch (error) {
      const failure = describePublishFailure(
        error,
        environment,
        "QStash did not accept the background job.",
      );
      const context = {
        correlationId: job.correlationId,
        jobId: job.id,
        userId: job.userId ?? undefined,
        errorCode: JobErrorCode.PUBLISH_FAILED,
        details: {
          type: job.type,
          ...(failure.diagnostic ? { qstash: failure.diagnostic } : {}),
        },
      };
      logger.error("job.publish.failed", context, failure.observableError);
      reportOperationalError(failure.observableError, context);
      try {
        await repository.recordPublishFailure(
          job.id,
          JobErrorCode.PUBLISH_FAILED,
          failure.persistedMessage,
        );
      } catch {
        // The queued row is reconciled by maintenance after the database
        // recovers if the publish-failure update cannot be written now.
      }
      throw new JobRequestError(
        JobErrorCode.PUBLISH_FAILED,
        503,
        "The job was recorded but could not be dispatched.",
        { cause: failure.observableError },
      );
    }

    // QStash already owns delivery at this point. A transient metadata update
    // failure must not mark an accepted message as failed or block its signed
    // callback from claiming the still-queued durable job.
    try {
      await repository.recordPublished(job.id, messageId);
    } catch {
      // Accepted delivery remains safe to execute from the durable queued row.
    }
  }

  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    correlationId: job.correlationId,
    reused,
  };
}

export async function executeBackgroundJob(
  jobId: string,
  dependencies: ServiceDependencies = {},
) {
  const environment = dependencies.environment ?? process.env;
  const repository = dependencies.repository ?? backgroundJobRepository;
  const now = dependencies.now ?? (() => new Date());
  const job = await repository.claim(jobId, now());

  if (!job) {
    const existing = await repository.get(jobId);
    if (!existing) {
      throw new JobRequestError(
        JobErrorCode.NOT_FOUND,
        404,
        "The background job was not found.",
      );
    }
    return {
      jobId: existing.id,
      status: existing.status,
      duplicate: true,
      retrying: false,
    };
  }

  logger.info("job.execution.started", {
    correlationId: job.correlationId,
    jobId: job.id,
    userId: job.userId ?? undefined,
    details: {
      type: job.type,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
    },
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  try {
    const handler = dependencies.handler ?? defaultHandler;
    const heartbeatIntervalMs = Math.max(
      1_000,
      Math.min(30_000, Math.floor(job.timeoutMs / 3)),
    );
    heartbeatTimer = setInterval(() => {
      void repository.heartbeat?.(job, now()).catch(() => undefined);
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    const result = await withJobTimeout(job.timeoutMs, (signal) =>
      handler(job, signal),
    );
    await repository.complete(job, result, now());
    if (job.type === BackgroundJobType.MAINTENANCE_CLEANUP) {
      await sendOperationalHeartbeat("worker", {
        correlationId: job.correlationId,
        jobId: job.id,
        environment,
      });
    }
    logger.info("job.execution.completed", {
      correlationId: job.correlationId,
      jobId: job.id,
      userId: job.userId ?? undefined,
      details: { type: job.type, attempt: job.attemptCount },
    });
    return {
      jobId: job.id,
      status: BackgroundJobStatus.COMPLETED,
      duplicate: false,
      retrying: false,
    };
  } catch (error) {
    const classified = classifyJobError(error);
    const retryAt = new Date(
      now().getTime() + calculateRetryDelaySeconds(job.attemptCount) * 1000,
    );
    const failed = await repository.fail(
      job,
      {
        code: classified.code,
        message: classified.message,
        retryable: classified.retryable,
        partiallyCompleted: classified.partiallyCompleted,
        nextRetryAt: retryAt,
      },
      now(),
    );
    const context = {
      correlationId: job.correlationId,
      jobId: job.id,
      userId: job.userId ?? undefined,
      errorCode: classified.code,
      details: {
        type: job.type,
        attempt: job.attemptCount,
        retrying: failed.retrying,
      },
    };
    if (failed.retrying) {
      logger.warn("job.execution.retrying", context, error);
    } else {
      logger.error("job.execution.failed", context, error);
      reportOperationalError(error, context);
    }
    return {
      jobId: job.id,
      status: failed.status,
      duplicate: false,
      retrying: failed.retrying,
      retryAfterSeconds: failed.retrying
        ? calculateRetryDelaySeconds(job.attemptCount)
        : undefined,
    };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

export async function retryBackgroundJob(
  jobId: string,
  actorUserId: string,
  dependencies: ServiceDependencies = {},
) {
  const environment = dependencies.environment ?? process.env;
  if (!isBackgroundFeatureEnabled("BACKGROUND_JOBS_ENABLED", environment)) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background jobs are disabled.",
    );
  }

  const repository = dependencies.repository ?? backgroundJobRepository;
  const job = await repository.prepareManualRetry(
    jobId,
    actorUserId,
    (dependencies.now ?? (() => new Date()))(),
  );
  if (!job) {
    throw new JobRequestError(
      JobErrorCode.NOT_RETRYABLE,
      409,
      "This job is not eligible for retry.",
    );
  }

  try {
    const published = await publishJobMessage({
      jobId: job.id,
      type: job.type,
      maxAttempts: Math.max(1, job.maxAttempts - job.attemptCount),
      timeoutMs: job.timeoutMs,
      correlationId: job.correlationId,
      deduplicationId: `${job.idempotencyKey}:manual:${randomUUID()}`,
      publisher: dependencies.publisher,
      environment,
    });
    try {
      await repository.recordPublished(job.id, published.messageId);
    } catch {
      // Accepted delivery remains safe to execute from the durable queued row.
    }
  } catch (error) {
    const failure = describePublishFailure(
      error,
      environment,
      "QStash did not accept the retried job.",
    );
    const context = {
      correlationId: job.correlationId,
      jobId: job.id,
      userId: job.userId ?? undefined,
      errorCode: JobErrorCode.PUBLISH_FAILED,
      details: {
        type: job.type,
        action: "manual-retry",
        ...(failure.diagnostic ? { qstash: failure.diagnostic } : {}),
      },
    };
    logger.error("job.retry.publish_failed", context, failure.observableError);
    reportOperationalError(failure.observableError, context);
    try {
      await repository.recordPublishFailure(
        job.id,
        JobErrorCode.PUBLISH_FAILED,
        failure.persistedMessage,
      );
    } catch {
      // The maintenance reconciliation covers a stranded queued retry.
    }
    throw new JobRequestError(
      JobErrorCode.PUBLISH_FAILED,
      503,
      "The retry was recorded but could not be dispatched.",
      { cause: failure.observableError },
    );
  }

  return {
    jobId: job.id,
    status: BackgroundJobStatus.QUEUED,
    correlationId: job.correlationId,
  };
}

export async function cancelBackgroundJob(
  jobId: string,
  actorUserId: string,
  dependencies: ServiceDependencies = {},
) {
  const repository = dependencies.repository ?? backgroundJobRepository;
  const job = await repository.cancel(
    jobId,
    actorUserId,
    (dependencies.now ?? (() => new Date()))(),
  );
  if (!job) {
    throw new JobRequestError(
      JobErrorCode.NOT_RETRYABLE,
      409,
      "Only queued or retrying jobs can be cancelled safely.",
    );
  }
  return job;
}

export async function listBackgroundJobsForAdmin(input: {
  status?: BackgroundJobStatus;
  take?: number;
}) {
  return backgroundJobRepository.listForAdmin(input);
}

export async function getBackgroundJobForAdmin(jobId: string) {
  return backgroundJobRepository.getForAdmin(jobId);
}
