import { BackgroundJobStatus, BackgroundJobType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { JobExecutionError } from "@/lib/jobs/errors";
import {
  createQstashDeduplicationId,
  type JobPublisher,
} from "@/lib/jobs/qstash";
import { PrismaBackgroundJobRepository } from "@/lib/jobs/repository";
import {
  enqueueBackgroundJob,
  executeBackgroundJob,
  retryBackgroundJob,
} from "@/lib/jobs/service";

const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.dev",
  BACKGROUND_JOBS_ENABLED: "true",
} as NodeJS.ProcessEnv;

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
    status: BackgroundJobStatus.QUEUED,
    idempotencyKey: "sec:aapl:2026-07-21",
    correlationId: "correlation-a",
    payloadJson: { ticker: "AAPL" },
    resultJson: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    maxAttempts: 3,
    timeoutMs: 30_000,
    companyId: "company-a",
    portfolioId: null,
    researchJobId: null,
    userId: "admin-a",
    agentName: null,
    queuedAt: new Date(),
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    nextRetryAt: null,
    qstashMessageId: null,
    cancelRequestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("background job service", () => {
  it("persists before publishing and reuses an existing idempotency key", async () => {
    const repository = {
      createOrReuse: vi
        .fn()
        .mockResolvedValueOnce({ job: job(), reused: false })
        .mockResolvedValueOnce({ job: job(), reused: true }),
      recordPublished: vi.fn(),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publisher = {
      publishJSON: vi.fn().mockResolvedValue({ messageId: "message-a" }),
    } as JobPublisher;
    const input = {
      type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
      idempotencyKey: "sec:aapl:2026-07-21",
      correlationId: "correlation-a",
      payload: { ticker: "AAPL" },
      companyId: "company-a",
    } as const;

    await expect(
      enqueueBackgroundJob(input, { repository, publisher, environment }),
    ).resolves.toMatchObject({ jobId: "job-a", reused: false });
    await expect(
      enqueueBackgroundJob(input, { repository, publisher, environment }),
    ).resolves.toMatchObject({ jobId: "job-a", reused: true });
    expect(repository.createOrReuse).toHaveBeenCalledTimes(2);
    expect(repository.createOrReuse).toHaveBeenNthCalledWith(1, input);
    expect(publisher.publishJSON).toHaveBeenCalledOnce();
    expect(publisher.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationId: createQstashDeduplicationId(input.idempotencyKey),
      }),
    );
    expect(repository.recordPublished).toHaveBeenCalledWith(
      "job-a",
      "message-a",
    );
  });

  it("retains publish failure in PostgreSQL", async () => {
    const repository = {
      createOrReuse: vi.fn().mockResolvedValue({ job: job(), reused: false }),
      recordPublished: vi.fn(),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publisher = {
      publishJSON: vi.fn().mockRejectedValue(new Error("upstream")),
    } as JobPublisher;

    await expect(
      enqueueBackgroundJob(
        {
          type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
          idempotencyKey: "sec:aapl:2026-07-21",
          correlationId: "correlation-a",
          payload: { ticker: "AAPL" },
        },
        { repository, publisher, environment },
      ),
    ).rejects.toMatchObject({ code: "JOB_PUBLISH_FAILED", status: 503 });
    expect(repository.recordPublishFailure).toHaveBeenCalledWith(
      "job-a",
      "JOB_PUBLISH_FAILED",
      "QStash did not accept the background job.",
    );
  });

  it("persists a redacted provider diagnostic for Preview manual retries", async () => {
    const repository = {
      prepareManualRetry: vi.fn().mockResolvedValue(job()),
      recordPublished: vi.fn(),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publisherError = Object.assign(
      new Error("invalid token preview-token"),
      { name: "QstashError", status: 401 },
    );
    const publisher = {
      publishJSON: vi.fn().mockRejectedValue(publisherError),
    } as JobPublisher;

    const failure = await retryBackgroundJob("job-a", "admin-a", {
      repository,
      publisher,
      environment: {
        ...environment,
        VERCEL_ENV: "preview",
        QSTASH_URL: "https://qstash-us-east-1.upstash.io",
        QSTASH_TOKEN: "preview-token",
        VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass-secret",
      } as NodeJS.ProcessEnv,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "JOB_PUBLISH_FAILED",
      status: 503,
      cause: {
        name: "QstashPublishDiagnosticError",
        message:
          "QStash publish failed: host=qstash-us-east-1.upstash.io; error=QstashError; status=401; message=invalid token [REDACTED]",
      },
    });
    expect(JSON.stringify(failure)).not.toContain("preview-token");
    expect(repository.recordPublishFailure).toHaveBeenCalledWith(
      "job-a",
      "JOB_PUBLISH_FAILED",
      "QStash publish failed: host=qstash-us-east-1.upstash.io; error=QstashError; status=401; message=invalid token [REDACTED]",
    );
  });

  it("publishes a QStash-safe deduplication ID for a NEWS manual retry", async () => {
    const applicationIdempotencyKey =
      "research:cmtjd3d8d0001ju04sxjp4plb:agent:NEWS";
    const repository = {
      prepareManualRetry: vi.fn().mockResolvedValue(
        job({
          id: "cmtjd3da10008ju04e2v34ev2",
          type: BackgroundJobType.RESEARCH_AGENT_RUN,
          idempotencyKey: applicationIdempotencyKey,
          researchJobId: "cmtjd3d8d0001ju04sxjp4plb",
          agentName: "NEWS",
        }),
      ),
      recordPublished: vi.fn(),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publishJSON = vi
      .fn()
      .mockResolvedValue({ messageId: "message-news" });
    const publisher = { publishJSON } satisfies JobPublisher;

    const retry = () =>
      retryBackgroundJob("cmtjd3da10008ju04e2v34ev2", "admin-a", {
        repository,
        publisher,
        environment,
      });

    await expect(retry()).resolves.toMatchObject({
      jobId: "cmtjd3da10008ju04e2v34ev2",
      status: BackgroundJobStatus.QUEUED,
    });
    await expect(retry()).resolves.toMatchObject({
      jobId: "cmtjd3da10008ju04e2v34ev2",
      status: BackgroundJobStatus.QUEUED,
    });
    expect(publishJSON).toHaveBeenCalledTimes(2);
    const providerIds = publishJSON.mock.calls.map(
      ([request]) => request.deduplicationId,
    );
    expect(providerIds).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(providerIds[0]).not.toBe(providerIds[1]);
    expect(providerIds.join("")).not.toContain(":");
    expect(providerIds.join("")).not.toContain(applicationIdempotencyKey);
    expect(repository.recordPublished).toHaveBeenCalledTimes(2);
    expect(repository.recordPublished).toHaveBeenLastCalledWith(
      "cmtjd3da10008ju04e2v34ev2",
      "message-news",
    );
  });

  it("preserves the original publish error as the Production cause", async () => {
    const repository = {
      prepareManualRetry: vi.fn().mockResolvedValue(job()),
      recordPublished: vi.fn(),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publisherError = new Error("production provider detail");
    const publisher = {
      publishJSON: vi.fn().mockRejectedValue(publisherError),
    } as JobPublisher;

    const failure = await retryBackgroundJob("job-a", "admin-a", {
      repository,
      publisher,
      environment: {
        ...environment,
        VERCEL_ENV: "production",
      } as NodeJS.ProcessEnv,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "JOB_PUBLISH_FAILED",
      status: 503,
      cause: publisherError,
    });
  });

  it("keeps an accepted delivery queued when message metadata cannot be recorded", async () => {
    const repository = {
      createOrReuse: vi.fn().mockResolvedValue({ job: job(), reused: false }),
      recordPublished: vi.fn().mockRejectedValue(new Error("database outage")),
      recordPublishFailure: vi.fn(),
    } as unknown as PrismaBackgroundJobRepository;
    const publisher = {
      publishJSON: vi.fn().mockResolvedValue({ messageId: "message-a" }),
    } as JobPublisher;

    await expect(
      enqueueBackgroundJob(
        {
          type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
          idempotencyKey: "sec:aapl:2026-07-21",
          correlationId: "correlation-a",
          payload: { ticker: "AAPL" },
        },
        { repository, publisher, environment },
      ),
    ).resolves.toMatchObject({ jobId: "job-a", status: "QUEUED" });
    expect(repository.recordPublishFailure).not.toHaveBeenCalled();
  });

  it("records retryable attempts and lets QStash redeliver", async () => {
    const claimed = job({
      status: BackgroundJobStatus.RUNNING,
      attemptCount: 1,
    });
    const repository = {
      claim: vi.fn().mockResolvedValue(claimed),
      fail: vi.fn().mockResolvedValue({
        status: BackgroundJobStatus.RETRYING,
        retrying: true,
      }),
    } as unknown as PrismaBackgroundJobRepository;

    await expect(
      executeBackgroundJob("job-a", {
        repository,
        handler: vi
          .fn()
          .mockRejectedValue(
            new JobExecutionError(
              "SEC_PROVIDER_UNAVAILABLE",
              true,
              "SEC is temporarily unavailable.",
            ),
          ),
      }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.RETRYING,
      retrying: true,
      retryAfterSeconds: 15,
    });
    expect(repository.fail).toHaveBeenCalledWith(
      claimed,
      expect.objectContaining({
        code: "SEC_PROVIDER_UNAVAILABLE",
        retryable: true,
      }),
      expect.any(Date),
    );
  });

  it("acknowledges duplicate completed deliveries without rerunning work", async () => {
    const repository = {
      claim: vi.fn().mockResolvedValue(null),
      get: vi
        .fn()
        .mockResolvedValue(job({ status: BackgroundJobStatus.COMPLETED })),
    } as unknown as PrismaBackgroundJobRepository;
    const handler = vi.fn();

    await expect(
      executeBackgroundJob("job-a", { repository, handler }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.COMPLETED,
      duplicate: true,
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
