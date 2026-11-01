import {
  AgentName,
  BackgroundJobStatus,
  BackgroundJobType,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  executeSecIngestionJob: vi.fn(),
  findMany: vi.fn(),
  isBackgroundFeatureEnabled: vi.fn(),
  queueSecIngestion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    company: { findMany: mocks.findMany },
    upcomingEarningsState: { deleteMany: mocks.deleteMany },
  },
}));

vi.mock("@/lib/jobs/config", () => ({
  isBackgroundFeatureEnabled: mocks.isBackgroundFeatureEnabled,
}));

vi.mock("@/lib/sec/jobs", () => ({
  executeSecIngestionJob: mocks.executeSecIngestionJob,
  fetchSecFilingDocument: vi.fn(),
  queueSecIngestion: mocks.queueSecIngestion,
  renormalizeStoredCompanyFacts: vi.fn(),
}));

import { executeBackgroundJobHandler } from "@/lib/jobs/handlers";
import type { ClaimedBackgroundJob } from "@/lib/jobs/repository";

function claimedJob(
  overrides: Partial<ClaimedBackgroundJob>,
): ClaimedBackgroundJob {
  return {
    id: "job-a",
    type: BackgroundJobType.RESEARCH_AGENT_RUN,
    status: BackgroundJobStatus.RUNNING,
    payloadJson: {
      researchJobId: "research-foreign",
      agentName: AgentName.NEWS,
    },
    correlationId: "correlation-a",
    attemptCount: 1,
    maxAttempts: 3,
    timeoutMs: 30_000,
    companyId: null,
    portfolioId: null,
    researchJobId: "research-owned",
    userId: "user-a",
    agentName: AgentName.NEWS,
    ...overrides,
  };
}

function staleSecRefreshJob(
  overrides: Partial<ClaimedBackgroundJob> = {},
): ClaimedBackgroundJob {
  return claimedJob({
    type: BackgroundJobType.MAINTENANCE_CLEANUP,
    payloadJson: { operation: "REFRESH_STALE_SEC" },
    correlationId: "maintenance-parent-correlation",
    researchJobId: null,
    userId: null,
    agentName: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.findMany.mockResolvedValue([]);
  mocks.isBackgroundFeatureEnabled.mockReturnValue(true);
  mocks.queueSecIngestion.mockImplementation(async (ticker: string) => ({
    jobId: `job-${ticker.toLowerCase()}`,
    reused: false,
  }));
});

describe("background job handler bindings", () => {
  it("rejects a forged research identifier before data access", async () => {
    await expect(
      executeBackgroundJobHandler(
        claimedJob({}),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "JOB_INVALID_PAYLOAD",
      retryable: false,
    });
  });

  it("rejects work after its timeout signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeBackgroundJobHandler(claimedJob({}), controller.signal),
    ).rejects.toMatchObject({ code: "JOB_TIMEOUT", retryable: true });
  });
});

describe("scheduled SEC refresh fan-out", () => {
  it("queues five companies with distinct, parent-traceable correlation IDs", async () => {
    const tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];
    mocks.findMany.mockResolvedValue(
      tickers.map((ticker) => ({ securities: [{ ticker }] })),
    );

    await expect(
      executeBackgroundJobHandler(
        staleSecRefreshJob({ id: "maintenance-job-a" }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ earningsDeleted: 0, queued: 5 });

    const calls = mocks.queueSecIngestion.mock.calls;
    expect(calls).toHaveLength(5);
    const correlationIds = calls.map(
      ([, input]) => (input as { correlationId: string }).correlationId,
    );
    expect(new Set(correlationIds).size).toBe(5);
    correlationIds.forEach((correlationId, index) => {
      expect(correlationId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
      expect(correlationId).toMatch(
        new RegExp(
          `^maintenance-parent-correlation:sec:${tickers[index].toLowerCase()}:`,
        ),
      );
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("queues every eligible company when fewer than five are returned", async () => {
    mocks.findMany.mockResolvedValue([
      { securities: [{ ticker: "AAPL" }] },
      { securities: [{ ticker: "MSFT" }] },
    ]);

    await expect(
      executeBackgroundJobHandler(
        staleSecRefreshJob(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ earningsDeleted: 0, queued: 2 });
    expect(mocks.queueSecIngestion).toHaveBeenCalledTimes(2);
  });

  it("returns a zero count when no eligible companies are returned", async () => {
    await expect(
      executeBackgroundJobHandler(
        staleSecRefreshJob(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ earningsDeleted: 0, queued: 0 });
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("keeps child correlation IDs within the observable header limit", async () => {
    mocks.findMany.mockResolvedValue([{ securities: [{ ticker: "AAPL" }] }]);

    await executeBackgroundJobHandler(
      staleSecRefreshJob({ correlationId: "p".repeat(128) }),
      new AbortController().signal,
    );

    const correlationId = (
      mocks.queueSecIngestion.mock.calls[0][1] as { correlationId: string }
    ).correlationId;
    expect(correlationId).toHaveLength(128);
    expect(correlationId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(correlationId).toMatch(/:sec:aapl:[0-9a-f-]{36}$/);
  });
});

describe("SEC ingestion job retries", () => {
  function secSyncJob(overrides: Partial<ClaimedBackgroundJob> = {}) {
    return claimedJob({
      type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
      payloadJson: { ticker: "AAPL" },
      companyId: "company-a",
      researchJobId: null,
      agentName: null,
      maxAttempts: 4,
      ...overrides,
    });
  }

  function runCorrelationId() {
    return (
      mocks.executeSecIngestionJob.mock.calls[0][0] as { correlationId: string }
    ).correlationId;
  }

  beforeEach(() => {
    mocks.executeSecIngestionJob.mockResolvedValue({ runId: "run-a" });
  });

  it("records the first attempt under the job correlation ID", async () => {
    await executeBackgroundJobHandler(
      secSyncJob({ attemptCount: 1 }),
      new AbortController().signal,
    );

    expect(runCorrelationId()).toBe("correlation-a");
  });

  it("gives a retried attempt its own job-traceable run correlation ID", async () => {
    await executeBackgroundJobHandler(
      secSyncJob({ attemptCount: 3 }),
      new AbortController().signal,
    );

    expect(runCorrelationId()).toBe("correlation-a:attempt:3");
  });

  it("keeps a retried run correlation ID within the observable header limit", async () => {
    await executeBackgroundJobHandler(
      secSyncJob({ attemptCount: 2, correlationId: "p".repeat(128) }),
      new AbortController().signal,
    );

    const correlationId = runCorrelationId();
    expect(correlationId).toHaveLength(128);
    expect(correlationId).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(correlationId).toMatch(/:attempt:2$/);
  });
});
