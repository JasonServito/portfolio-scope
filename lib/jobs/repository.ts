import {
  BackgroundJobAttemptStatus,
  BackgroundJobStatus,
  BackgroundJobType,
  Prisma,
} from "@prisma/client";

import { db } from "@/lib/db";
import { JobErrorCode } from "@/lib/jobs/errors";
import type { CreateBackgroundJobInput } from "@/lib/jobs/types";
import {
  ACTIVE_JOB_STATUSES,
  canCancelJob,
  canClaimJob,
  canRetryJob,
  jobPolicies,
  parseJobPayload,
} from "@/lib/jobs/types";

export type ClaimedBackgroundJob = {
  id: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  payloadJson: Prisma.JsonValue;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
  companyId: string | null;
  portfolioId: string | null;
  researchJobId: string | null;
  userId: string | null;
  agentName: string | null;
};

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function terminalStatus(partial: boolean) {
  return partial
    ? BackgroundJobStatus.PARTIALLY_COMPLETED
    : BackgroundJobStatus.FAILED;
}

export class PrismaBackgroundJobRepository {
  async createOrReuse<T extends BackgroundJobType>(
    input: CreateBackgroundJobInput<T>,
  ) {
    const payload = parseJobPayload(
      input.type,
      input.payload as unknown as Prisma.JsonValue,
    );
    const existing = await db.backgroundJob.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { job: existing, reused: true };

    const activeScope = await this.findActiveScope(input);
    if (activeScope) return { job: activeScope, reused: true };

    const policy = jobPolicies[input.type];
    try {
      const job = await db.backgroundJob.create({
        data: {
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          payloadJson: payload as Prisma.InputJsonValue,
          userId: input.userId ?? null,
          companyId: input.companyId ?? null,
          portfolioId: input.portfolioId ?? null,
          researchJobId: input.researchJobId ?? null,
          agentName: input.agentName ?? null,
          maxAttempts: policy.maxAttempts,
          timeoutMs: policy.timeoutMs,
        },
      });
      return { job, reused: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const winner =
        (await db.backgroundJob.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })) ?? (await this.findActiveScope(input));
      if (!winner) throw error;
      return { job: winner, reused: true };
    }
  }

  private async findActiveScope<T extends BackgroundJobType>(
    input: CreateBackgroundJobInput<T>,
  ) {
    if (input.companyId) {
      return db.backgroundJob.findFirst({
        where: {
          type: input.type,
          companyId: input.companyId,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
        orderBy: { queuedAt: "asc" },
      });
    }
    if (input.researchJobId) {
      return db.backgroundJob.findFirst({
        where: {
          type: input.type,
          researchJobId: input.researchJobId,
          agentName: input.agentName ?? null,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
        orderBy: { queuedAt: "asc" },
      });
    }
    if (input.portfolioId) {
      return db.backgroundJob.findFirst({
        where: {
          type: input.type,
          portfolioId: input.portfolioId,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
        orderBy: { queuedAt: "asc" },
      });
    }
    return null;
  }

  async recordPublished(jobId: string, messageId: string) {
    return db.backgroundJob.update({
      where: { id: jobId },
      data: { qstashMessageId: messageId },
    });
  }

  async recordPublishFailure(jobId: string, code: string, message: string) {
    return db.backgroundJob.updateMany({
      where: {
        id: jobId,
        status: { in: [BackgroundJobStatus.QUEUED, BackgroundJobStatus.RETRYING] },
      },
      data: {
        status: BackgroundJobStatus.FAILED,
        completedAt: new Date(),
        nextRetryAt: null,
        errorCode: code,
        errorMessage: message.slice(0, 500),
      },
    });
  }

  async claim(jobId: string, now = new Date()) {
    return db.$transaction(async (transaction) => {
      const current = await transaction.backgroundJob.findUnique({
        where: { id: jobId },
      });
      if (
        !current ||
        !canClaimJob(current.status) ||
        current.cancelRequestedAt ||
        current.attemptCount >= current.maxAttempts ||
        (current.nextRetryAt !== null && current.nextRetryAt > now)
      ) {
        return null;
      }

      const attemptNumber = current.attemptCount + 1;
      const claimed = await transaction.backgroundJob.updateMany({
        where: {
          id: current.id,
          status: current.status,
          attemptCount: current.attemptCount,
          cancelRequestedAt: null,
        },
        data: {
          status: BackgroundJobStatus.RUNNING,
          attemptCount: attemptNumber,
          startedAt: current.startedAt ?? now,
          heartbeatAt: now,
          nextRetryAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claimed.count !== 1) return null;

      await transaction.backgroundJobAttempt.create({
        data: {
          backgroundJobId: current.id,
          attemptNumber,
          status: BackgroundJobAttemptStatus.RUNNING,
          startedAt: now,
          heartbeatAt: now,
        },
      });

      return transaction.backgroundJob.findUnique({
        where: { id: current.id },
        select: {
          id: true,
          type: true,
          status: true,
          payloadJson: true,
          correlationId: true,
          attemptCount: true,
          maxAttempts: true,
          timeoutMs: true,
          companyId: true,
          portfolioId: true,
          researchJobId: true,
          userId: true,
          agentName: true,
        },
      }) as Promise<ClaimedBackgroundJob>;
    });
  }

  async heartbeat(job: ClaimedBackgroundJob, now = new Date()) {
    const [backgroundJob] = await db.$transaction([
      db.backgroundJob.updateMany({
        where: {
          id: job.id,
          status: BackgroundJobStatus.RUNNING,
          attemptCount: job.attemptCount,
        },
        data: { heartbeatAt: now },
      }),
      db.backgroundJobAttempt.updateMany({
        where: {
          backgroundJobId: job.id,
          attemptNumber: job.attemptCount,
          status: BackgroundJobAttemptStatus.RUNNING,
        },
        data: { heartbeatAt: now },
      }),
    ]);
    return backgroundJob.count === 1;
  }

  async complete(
    job: ClaimedBackgroundJob,
    result: Prisma.InputJsonValue,
    now = new Date(),
  ) {
    await db.$transaction([
      db.backgroundJobAttempt.update({
        where: {
          backgroundJobId_attemptNumber: {
            backgroundJobId: job.id,
            attemptNumber: job.attemptCount,
          },
        },
        data: {
          status: BackgroundJobAttemptStatus.COMPLETED,
          heartbeatAt: now,
          completedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      }),
      db.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: BackgroundJobStatus.COMPLETED,
          resultJson: result,
          heartbeatAt: now,
          completedAt: now,
          nextRetryAt: null,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);
  }

  async fail(
    job: ClaimedBackgroundJob,
    input: {
      code: string;
      message: string;
      retryable: boolean;
      partiallyCompleted: boolean;
      nextRetryAt: Date | null;
    },
    now = new Date(),
  ) {
    const retrying = input.retryable && job.attemptCount < job.maxAttempts;
    const status = retrying
      ? BackgroundJobStatus.RETRYING
      : terminalStatus(input.partiallyCompleted);

    await db.$transaction([
      db.backgroundJobAttempt.update({
        where: {
          backgroundJobId_attemptNumber: {
            backgroundJobId: job.id,
            attemptNumber: job.attemptCount,
          },
        },
        data: {
          status: BackgroundJobAttemptStatus.FAILED,
          heartbeatAt: now,
          completedAt: now,
          errorCode: input.code,
          errorMessage: input.message.slice(0, 500),
        },
      }),
      db.backgroundJob.update({
        where: { id: job.id },
        data: {
          status,
          heartbeatAt: now,
          completedAt: retrying ? null : now,
          nextRetryAt: retrying ? input.nextRetryAt : null,
          errorCode: input.code,
          errorMessage: input.message.slice(0, 500),
        },
      }),
    ]);

    return { status, retrying };
  }

  async get(jobId: string) {
    return db.backgroundJob.findUnique({ where: { id: jobId } });
  }

  async listForAdmin(input: { status?: BackgroundJobStatus; take?: number }) {
    return db.backgroundJob.findMany({
      where: input.status ? { status: input.status } : undefined,
      select: {
        id: true,
        type: true,
        status: true,
        correlationId: true,
        attemptCount: true,
        maxAttempts: true,
        errorCode: true,
        errorMessage: true,
        queuedAt: true,
        startedAt: true,
        completedAt: true,
        nextRetryAt: true,
        company: { select: { name: true, securities: { select: { ticker: true }, take: 1 } } },
        portfolio: { select: { name: true } },
        researchJob: { select: { stock: { select: { ticker: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(input.take ?? 50, 1), 100),
    });
  }

  async getForAdmin(jobId: string) {
    return db.backgroundJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        type: true,
        status: true,
        correlationId: true,
        attemptCount: true,
        maxAttempts: true,
        timeoutMs: true,
        errorCode: true,
        errorMessage: true,
        queuedAt: true,
        startedAt: true,
        heartbeatAt: true,
        completedAt: true,
        nextRetryAt: true,
        cancelRequestedAt: true,
        attempts: {
          select: {
            attemptNumber: true,
            status: true,
            errorCode: true,
            errorMessage: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: { attemptNumber: "asc" },
        },
        controlEvents: {
          select: { action: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async cancel(jobId: string, actorUserId: string, now = new Date()) {
    const job = await db.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job || !canCancelJob(job.status)) return null;

    const updated = await db.$transaction(async (transaction) => {
      const result = await transaction.backgroundJob.updateMany({
        where: { id: job.id, status: job.status },
        data: {
          status: BackgroundJobStatus.CANCELLED,
          cancelRequestedAt: now,
          completedAt: now,
          nextRetryAt: null,
        },
      });
      if (result.count === 1) {
        if (
          job.researchJobId &&
          (job.type === BackgroundJobType.RESEARCH_AGENT_RUN ||
            job.type === BackgroundJobType.RESEARCH_SYNTHESIS)
        ) {
          await transaction.backgroundJob.updateMany({
            where: {
              researchJobId: job.researchJobId,
              status: {
                in: [
                  BackgroundJobStatus.QUEUED,
                  BackgroundJobStatus.RETRYING,
                ],
              },
            },
            data: {
              status: BackgroundJobStatus.CANCELLED,
              cancelRequestedAt: now,
              completedAt: now,
              nextRetryAt: null,
            },
          });
          await transaction.researchJob.updateMany({
            where: {
              id: job.researchJobId,
              status: {
                in: ["PENDING", "RUNNING", "PARTIALLY_COMPLETED"],
              },
            },
            data: { status: "CANCELLED", completedAt: now },
          });
        }
        await transaction.backgroundJobControlEvent.create({
          data: {
            backgroundJobId: job.id,
            actorUserId,
            action: "CANCEL",
          },
        });
      }
      return result;
    });
    return updated.count === 1 ? this.getForAdmin(jobId) : null;
  }

  async prepareManualRetry(
    jobId: string,
    actorUserId: string,
    now = new Date(),
  ) {
    const job = await db.backgroundJob.findUnique({
      where: { id: jobId },
      include: { researchJob: { select: { status: true } } },
    });
    if (
      !job ||
      !canRetryJob(job.status) ||
      job.researchJob?.status === "CANCELLED"
    ) {
      return null;
    }
    const policy = jobPolicies[job.type];
    const updated = await db.$transaction(async (transaction) => {
      const result = await transaction.backgroundJob.updateMany({
        where: { id: job.id, status: job.status },
        data: {
          status: BackgroundJobStatus.QUEUED,
          queuedAt: now,
          completedAt: null,
          nextRetryAt: null,
          cancelRequestedAt: null,
          qstashMessageId: null,
          errorCode: null,
          errorMessage: null,
          maxAttempts: Math.min(10, job.attemptCount + policy.maxAttempts),
        },
      });
      if (result.count === 1) {
        await transaction.backgroundJobControlEvent.create({
          data: {
            backgroundJobId: job.id,
            actorUserId,
            action: "RETRY",
          },
        });
      }
      return result;
    });
    return updated.count === 1 ? this.get(jobId) : null;
  }

  async recoverStaleRunningJobs(cutoff: Date, now = new Date()) {
    const staleJobs = await db.backgroundJob.findMany({
      where: {
        status: BackgroundJobStatus.RUNNING,
        OR: [
          { heartbeatAt: { lt: cutoff } },
          { heartbeatAt: null, startedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, attemptCount: true, maxAttempts: true },
      take: 100,
    });

    let retrying = 0;
    let failed = 0;
    for (const job of staleJobs) {
      const mayRetry = job.attemptCount < job.maxAttempts;
      const status = mayRetry
        ? BackgroundJobStatus.RETRYING
        : BackgroundJobStatus.FAILED;
      const recovered = await db.$transaction(async (transaction) => {
        const backgroundJob = await transaction.backgroundJob.updateMany({
          where: {
            id: job.id,
            status: BackgroundJobStatus.RUNNING,
            attemptCount: job.attemptCount,
            OR: [
              { heartbeatAt: { lt: cutoff } },
              { heartbeatAt: null, startedAt: { lt: cutoff } },
            ],
          },
          data: {
            status,
            completedAt: mayRetry ? null : now,
            nextRetryAt: mayRetry ? now : null,
            errorCode: "JOB_HEARTBEAT_EXPIRED",
            errorMessage: "The worker stopped reporting progress.",
          },
        });
        if (backgroundJob.count !== 1) return false;

        await transaction.backgroundJobAttempt.updateMany({
          where: {
            backgroundJobId: job.id,
            attemptNumber: job.attemptCount,
            status: BackgroundJobAttemptStatus.RUNNING,
          },
          data: {
            status: BackgroundJobAttemptStatus.FAILED,
            completedAt: now,
            errorCode: "JOB_HEARTBEAT_EXPIRED",
            errorMessage: "The worker stopped reporting progress.",
          },
        });
        return true;
      });
      if (!recovered) continue;
      if (mayRetry) retrying += 1;
      else failed += 1;
    }

    return { recovered: retrying + failed, retrying, failed };
  }

  async failUndeliveredQueuedJobs(cutoff: Date, now = new Date()) {
    return db.backgroundJob.updateMany({
      where: {
        status: BackgroundJobStatus.QUEUED,
        qstashMessageId: null,
        queuedAt: { lt: cutoff },
      },
      data: {
        status: BackgroundJobStatus.FAILED,
        completedAt: now,
        errorCode: JobErrorCode.PUBLISH_FAILED,
        errorMessage:
          "No QStash delivery metadata was recorded before the dispatch deadline.",
      },
    });
  }
}

export const backgroundJobRepository = new PrismaBackgroundJobRepository();
