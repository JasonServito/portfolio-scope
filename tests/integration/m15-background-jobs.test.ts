import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentStatus,
  BackgroundJobStatus,
  BackgroundJobType,
  ResearchStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
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
const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  RESEARCH_GENERATION_ENABLED: "true",
  SEC_INGESTION_ENABLED: "true",
} as NodeJS.ProcessEnv;

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
      ],
    },
  });
  await db.user.deleteMany({ where: { id: userId } });
  await db.stock.deleteMany({ where: { id: stockId } });
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
});

afterAll(cleanup);

describe("M15 durable background jobs", () => {
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
