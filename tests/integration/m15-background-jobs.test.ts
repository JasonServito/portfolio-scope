import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentStatus,
  BackgroundJobStatus,
  BackgroundJobType,
  ResearchStatus,
  SecIngestionStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const secJobMocks = vi.hoisted(() => ({
  queueSecIngestion: vi.fn(),
}));

vi.mock("@/lib/sec/jobs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sec/jobs")>();
  return { ...original, queueSecIngestion: secJobMocks.queueSecIngestion };
});

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";
import { executeBackgroundJobHandler } from "@/lib/jobs/handlers";
import type { JobPublisher } from "@/lib/jobs/qstash";
import type { ClaimedBackgroundJob } from "@/lib/jobs/repository";
import {
  cancelBackgroundJob,
  enqueueBackgroundJob,
  executeBackgroundJob,
} from "@/lib/jobs/service";
import { runResearch } from "@/lib/research/orchestrator";

const runId = randomUUID().replaceAll("-", "");
const prefix = `m15-${runId}`;
const userId = `${prefix}-user`;
const stockId = `${prefix}-stock`;
const fixtureTicker = `Z${runId.slice(0, 4).toUpperCase()}`;
const secBatchTickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"] as const;
const secBatchCikSeed = Number.parseInt(runId.slice(0, 8), 16);
let secBatchCompanies: Array<{ id: string; secEntityId: string }> = [];
const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  RESEARCH_GENERATION_ENABLED: "true",
  SEC_INGESTION_ENABLED: "true",
} as NodeJS.ProcessEnv;

function secBatchCik(index: number) {
  return ((secBatchCikSeed + index) % 10_000_000_000)
    .toString()
    .padStart(10, "0");
}

function publisher() {
  return {
    publishJSON: vi.fn().mockImplementation(async () => ({
      messageId: `${prefix}-${randomUUID()}`,
    })),
  } satisfies JobPublisher;
}

function maintenanceInput(label: string) {
  return {
    type: BackgroundJobType.MAINTENANCE_CLEANUP,
    idempotencyKey: `${prefix}:${label}`,
    correlationId: `${prefix}:${label}:correlation`,
    payload: { operation: "RECOVER_STALE_JOBS" as const },
  };
}

async function cleanup() {
  await db.backgroundJob.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: prefix } },
        { userId },
        { researchJob: { userId } },
        { company: { slug: { startsWith: `${prefix}-sec-batch-` } } },
      ],
    },
  });
  await db.user.deleteMany({ where: { id: userId } });
  await db.stock.deleteMany({ where: { id: stockId } });
  await db.company.deleteMany({
    where: { slug: { startsWith: `${prefix}-sec-batch-` } },
  });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M15 integration tests must not run against production.");
  }

  await cleanup();
  await db.user.create({
    data: {
      id: userId,
      email: `${prefix}@portfolioscope.invalid`,
      role: "ADMIN",
    },
  });
  await db.stock.create({
    data: {
      id: stockId,
      ticker: fixtureTicker,
      companyName: "M15 background-job fixture",
      sector: "Test",
      industry: "Integration",
      exchange: "TEST",
    },
  });
  secBatchCompanies = [];
  for (const [index, ticker] of secBatchTickers.entries()) {
    const company = await db.company.create({
      data: {
        slug: `${prefix}-sec-batch-${ticker.toLowerCase()}`,
        name: `M15 SEC batch fixture ${ticker}`,
        isActive: true,
        isSupported: true,
        secEntity: {
          create: {
            cik: secBatchCik(index),
            legalName: `M15 SEC batch fixture ${ticker}`,
          },
        },
      },
      select: { id: true, secEntity: { select: { id: true } } },
    });
    if (!company.secEntity) {
      throw new Error("The M15 SEC batch fixture is missing its SEC entity.");
    }
    secBatchCompanies.push({
      id: company.id,
      secEntityId: company.secEntity.id,
    });
  }
});

afterAll(cleanup);

describe("M15 durable background jobs", () => {
  it("queues and completes five scheduled SEC children without correlation collisions", async () => {
    const transport = publisher();
    const parentCorrelationId = `${prefix}:scheduled-sec-refresh`;
    const maintenanceJob = {
      id: `${prefix}-maintenance-job`,
      type: BackgroundJobType.MAINTENANCE_CLEANUP,
      status: BackgroundJobStatus.RUNNING,
      payloadJson: { operation: "REFRESH_STALE_SEC" },
      correlationId: parentCorrelationId,
      attemptCount: 1,
      maxAttempts: 2,
      timeoutMs: 60_000,
      companyId: null,
      portfolioId: null,
      researchJobId: null,
      userId: null,
      agentName: null,
    } satisfies ClaimedBackgroundJob;
    const companySelection = secBatchTickers.map((ticker) => ({
      securities: [{ ticker }],
    }));
    const companyFindMany = vi
      .spyOn(db.company, "findMany")
      .mockResolvedValue(companySelection as never);
    const earningsDeleteMany = vi
      .spyOn(db.upcomingEarningsState, "deleteMany")
      .mockResolvedValue({ count: 0 });
    const originalSecIngestionFlag = process.env.SEC_INGESTION_ENABLED;
    process.env.SEC_INGESTION_ENABLED = "true";
    secJobMocks.queueSecIngestion.mockImplementation(
      async (ticker: string, input: { correlationId?: string } = {}) => {
        const index = secBatchTickers.indexOf(
          ticker as (typeof secBatchTickers)[number],
        );
        const correlationId = input.correlationId;
        if (index < 0 || !correlationId) {
          throw new Error("The scheduled SEC queue input is invalid.");
        }
        return enqueueBackgroundJob(
          {
            type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
            idempotencyKey: `sec:${secBatchCompanies[index].id}:2026-09-12T18:00:00.000Z`,
            correlationId,
            payload: { ticker },
            companyId: secBatchCompanies[index].id,
          },
          { publisher: transport, environment },
        );
      },
    );

    try {
      await expect(
        executeBackgroundJobHandler(
          maintenanceJob,
          new AbortController().signal,
        ),
      ).resolves.toEqual({ earningsDeleted: 0, queued: 5 });
      await expect(
        executeBackgroundJobHandler(
          maintenanceJob,
          new AbortController().signal,
        ),
      ).resolves.toEqual({ earningsDeleted: 0, queued: 5 });

      expect(secJobMocks.queueSecIngestion).toHaveBeenCalledTimes(10);
      expect(transport.publishJSON).toHaveBeenCalledTimes(5);

      const jobs = await db.backgroundJob.findMany({
        where: {
          companyId: { in: secBatchCompanies.map(({ id }) => id) },
          type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
        },
        orderBy: { queuedAt: "asc" },
      });
      expect(jobs).toHaveLength(5);
      expect(new Set(jobs.map(({ correlationId }) => correlationId)).size).toBe(
        5,
      );
      expect(
        jobs.every(({ correlationId }) =>
          correlationId.startsWith(`${parentCorrelationId}:sec:`),
        ),
      ).toBe(true);

      for (const job of jobs) {
        const fixture = secBatchCompanies.find(
          ({ id }) => id === job.companyId,
        );
        if (!fixture) throw new Error("The queued SEC fixture is missing.");
        await expect(
          executeBackgroundJob(job.id, {
            handler: async (claimedJob) => {
              await db.secIngestionRun.create({
                data: {
                  secEntityId: fixture.secEntityId,
                  status: SecIngestionStatus.COMPLETED,
                  trigger: "TEST",
                  correlationId: claimedJob.correlationId,
                  completedAt: new Date(),
                },
              });
              return { stored: true };
            },
          }),
        ).resolves.toMatchObject({
          status: BackgroundJobStatus.COMPLETED,
          duplicate: false,
        });
      }

      const runs = await db.secIngestionRun.findMany({
        where: {
          secEntityId: {
            in: secBatchCompanies.map(({ secEntityId }) => secEntityId),
          },
        },
        select: { correlationId: true },
      });
      expect(runs).toHaveLength(5);
      expect(new Set(runs.map(({ correlationId }) => correlationId)).size).toBe(
        5,
      );
      expect(runs.map(({ correlationId }) => correlationId).sort()).toEqual(
        jobs.map(({ correlationId }) => correlationId).sort(),
      );
    } finally {
      companyFindMany.mockRestore();
      earningsDeleteMany.mockRestore();
      secJobMocks.queueSecIngestion.mockReset();
      if (originalSecIngestionFlag === undefined) {
        delete process.env.SEC_INGESTION_ENABLED;
      } else {
        process.env.SEC_INGESTION_ENABLED = originalSecIngestionFlag;
      }
    }
  });

  it("persists before delivery, deduplicates, records attempts, and acknowledges replay", async () => {
    const transport = publisher();
    const input = maintenanceInput("completed");
    const first = await enqueueBackgroundJob(input, {
      publisher: transport,
      environment,
    });
    const duplicate = await enqueueBackgroundJob(input, {
      publisher: transport,
      environment,
    });

    expect(first.reused).toBe(false);
    expect(duplicate).toMatchObject({ jobId: first.jobId, reused: true });
    expect(transport.publishJSON).toHaveBeenCalledOnce();

    const handler = vi.fn().mockResolvedValue({ recovered: 0 });
    await expect(
      executeBackgroundJob(first.jobId, { handler }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.COMPLETED,
      duplicate: false,
    });
    await expect(
      executeBackgroundJob(first.jobId, { handler }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.COMPLETED,
      duplicate: true,
    });
    expect(handler).toHaveBeenCalledOnce();

    const stored = await db.backgroundJob.findUnique({
      where: { id: first.jobId },
      include: { attempts: true },
    });
    expect(stored).toMatchObject({
      status: BackgroundJobStatus.COMPLETED,
      attemptCount: 1,
      qstashMessageId: expect.any(String),
    });
    expect(stored?.attempts).toHaveLength(1);
    expect(stored?.attempts[0].status).toBe("COMPLETED");
  });

  it("waits for retry backoff, then recovers within the attempt budget", async () => {
    const queued = await enqueueBackgroundJob(maintenanceInput("retry"), {
      publisher: publisher(),
      environment,
    });
    const firstAttemptAt = new Date("2026-07-21T18:00:00.000Z");
    const retryableHandler = vi.fn().mockRejectedValue(
      new JobExecutionError(
        "SEC_PROVIDER_UNAVAILABLE",
        true,
        "SEC is temporarily unavailable.",
      ),
    );

    await expect(
      executeBackgroundJob(queued.jobId, {
        handler: retryableHandler,
        now: () => firstAttemptAt,
      }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.RETRYING,
      retrying: true,
    });

    const earlyHandler = vi.fn();
    await expect(
      executeBackgroundJob(queued.jobId, {
        handler: earlyHandler,
        now: () => new Date("2026-07-21T18:00:14.000Z"),
      }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.RETRYING,
      duplicate: true,
    });
    expect(earlyHandler).not.toHaveBeenCalled();

    await expect(
      executeBackgroundJob(queued.jobId, {
        handler: vi.fn().mockResolvedValue({ recovered: true }),
        now: () => new Date("2026-07-21T18:00:15.000Z"),
      }),
    ).resolves.toMatchObject({ status: BackgroundJobStatus.COMPLETED });

    const stored = await db.backgroundJob.findUnique({
      where: { id: queued.jobId },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    expect(stored?.attemptCount).toBe(2);
    expect(stored?.attempts.map((attempt) => attempt.status)).toEqual([
      "FAILED",
      "COMPLETED",
    ]);
  });

  it("retains permanent and publish failures with actionable state", async () => {
    const permanent = await enqueueBackgroundJob(
      maintenanceInput("permanent"),
      { publisher: publisher(), environment },
    );
    await executeBackgroundJob(permanent.jobId, {
      handler: vi.fn().mockRejectedValue(
        new JobExecutionError(
          "NORMALIZATION_AMBIGUOUS",
          false,
          "A financial fact could not be normalized unambiguously.",
        ),
      ),
    });
    await expect(
      db.backgroundJob.findUnique({ where: { id: permanent.jobId } }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.FAILED,
      errorCode: "NORMALIZATION_AMBIGUOUS",
      attemptCount: 1,
    });

    const failedPublisher = {
      publishJSON: vi.fn().mockRejectedValue(new Error("QStash unavailable")),
    } satisfies JobPublisher;
    await expect(
      enqueueBackgroundJob(maintenanceInput("publish-failure"), {
        publisher: failedPublisher,
        environment,
      }),
    ).rejects.toMatchObject({ code: "JOB_PUBLISH_FAILED", status: 503 });
    await expect(
      db.backgroundJob.findUnique({
        where: { idempotencyKey: `${prefix}:publish-failure` },
      }),
    ).resolves.toMatchObject({
      status: BackgroundJobStatus.FAILED,
      errorCode: "JOB_PUBLISH_FAILED",
      attemptCount: 0,
    });
  });

  it("rolls back failed database creation and records an administrator cancellation", async () => {
    const transport = publisher();
    await expect(
      enqueueBackgroundJob(
        {
          ...maintenanceInput("invalid-owner"),
          userId: `${prefix}-missing-user`,
        },
        { publisher: transport, environment },
      ),
    ).rejects.toBeDefined();
    expect(transport.publishJSON).not.toHaveBeenCalled();
    expect(
      await db.backgroundJob.count({
        where: { idempotencyKey: `${prefix}:invalid-owner` },
      }),
    ).toBe(0);

    const cancellable = await enqueueBackgroundJob(
      { ...maintenanceInput("cancel"), userId },
      { publisher: publisher(), environment },
    );
    await expect(
      cancelBackgroundJob(cancellable.jobId, userId),
    ).resolves.toMatchObject({ status: BackgroundJobStatus.CANCELLED });
    const stored = await db.backgroundJob.findUnique({
      where: { id: cancellable.jobId },
      include: { controlEvents: true },
    });
    expect(stored?.controlEvents).toEqual([
      expect.objectContaining({ actorUserId: userId, action: "CANCEL" }),
    ]);
  });

  it("cancels a queued research workflow as one coherent request", async () => {
    const queuedResearch = await runResearch(userId, fixtureTicker, {
      publisher: publisher(),
      environment,
    });
    if (!queuedResearch) throw new Error("Research was not queued.");
    const child = await db.backgroundJob.findFirstOrThrow({
      where: {
        researchJobId: queuedResearch.jobId,
        type: BackgroundJobType.RESEARCH_AGENT_RUN,
      },
    });

    await cancelBackgroundJob(child.id, userId);

    await expect(
      db.researchJob.findUnique({ where: { id: queuedResearch.jobId } }),
    ).resolves.toMatchObject({ status: ResearchStatus.CANCELLED });
    expect(
      await db.backgroundJob.count({
        where: {
          researchJobId: queuedResearch.jobId,
          status: { not: BackgroundJobStatus.CANCELLED },
        },
      }),
    ).toBe(0);
  });

  it("keeps completed specialist output when another research agent fails", async () => {
    const queuedResearch = await runResearch(userId, fixtureTicker, {
      publisher: publisher(),
      environment,
    });
    expect(queuedResearch).toMatchObject({
      status: ResearchStatus.PENDING,
      reused: false,
    });
    if (!queuedResearch) throw new Error("Research was not queued.");
    const researchJobId = queuedResearch.jobId;

    const newsJob = await db.backgroundJob.findFirstOrThrow({
      where: {
        researchJobId,
        type: BackgroundJobType.RESEARCH_AGENT_RUN,
        agentName: AgentName.NEWS,
      },
    });
    await executeBackgroundJob(newsJob.id, {
      handler: async () => {
        await db.agentRun.update({
          where: {
            researchJobId_agentName: {
              researchJobId,
              agentName: AgentName.NEWS,
            },
          },
          data: {
            status: AgentStatus.COMPLETED,
            summary: "Completed specialist result retained by the fixture.",
            completedAt: new Date(),
          },
        });
        return { stored: true };
      },
    });

    const financialsJob = await db.backgroundJob.findFirstOrThrow({
      where: {
        researchJobId,
        type: BackgroundJobType.RESEARCH_AGENT_RUN,
        agentName: AgentName.FINANCIALS,
      },
    });
    await executeBackgroundJob(financialsJob.id);

    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: researchJobId },
      include: { agentRuns: true },
    });
    expect(stored.status).toBe(ResearchStatus.PARTIALLY_COMPLETED);
    expect(
      stored.agentRuns.find((run) => run.agentName === AgentName.NEWS),
    ).toMatchObject({
      status: AgentStatus.COMPLETED,
      summary: "Completed specialist result retained by the fixture.",
    });
    expect(
      stored.agentRuns.find((run) => run.agentName === AgentName.FINANCIALS),
    ).toMatchObject({ status: AgentStatus.FAILED });
  });
});
