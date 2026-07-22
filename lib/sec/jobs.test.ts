import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestSupportedCompany: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  invalidate: vi.fn(),
  setJson: vi.fn(),
}));

vi.mock("@/lib/cache/redis", () => ({
  cachePolicies: { dataFreshness: { ttlSeconds: 86_400 } },
  ephemeralStore: {
    acquireLock: mocks.acquireLock,
    releaseLock: mocks.releaseLock,
    invalidate: mocks.invalidate,
    setJson: mocks.setJson,
  },
}));

vi.mock("@/lib/sec/ingestion", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sec/ingestion")>();
  return {
    ...original,
    ingestSupportedCompany: mocks.ingestSupportedCompany,
  };
});

import { JobExecutionError } from "@/lib/jobs/errors";
import {
  SecIngestionError,
  SecIngestionErrorCode,
} from "@/lib/sec/ingestion";
import { executeSecIngestionJob } from "@/lib/sec/jobs";

describe("M15 SEC background integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireLock.mockResolvedValue({
      acquired: true,
      unavailable: false,
      token: "lock-token",
    });
    mocks.releaseLock.mockResolvedValue(true);
    mocks.invalidate.mockResolvedValue(true);
    mocks.setJson.mockResolvedValue(true);
    mocks.ingestSupportedCompany.mockResolvedValue({
      runId: "run-a",
      ticker: "AAPL",
      correlationId: "correlation-a",
      status: "COMPLETED",
      filingsProcessed: 44,
      factsProcessed: 10,
      factsSelected: 4,
      ambiguousFacts: 0,
    });
  });

  it("calls the same core ingestion service used by local synchronous execution", async () => {
    await expect(
      executeSecIngestionJob({
        ticker: "AAPL",
        requestedByUserId: "admin-a",
        companyId: "company-a",
        correlationId: "correlation-a",
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });

    expect(mocks.ingestSupportedCompany).toHaveBeenCalledWith("AAPL", {
      trigger: "JOB",
      requestedByUserId: "admin-a",
      correlationId: "correlation-a",
    });
    expect(mocks.releaseLock).toHaveBeenCalledWith(
      "sec-company",
      "company-a",
      "lock-token",
    );
  });

  it("preserves categorized partial failures for the M15 retry worker", async () => {
    mocks.ingestSupportedCompany.mockRejectedValue(
      new SecIngestionError(
        SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
        503,
        "SEC returned data that failed contract validation.",
        { retryable: false, partiallyCompleted: true },
      ),
    );

    const error = await executeSecIngestionJob({
      ticker: "AAPL",
      requestedByUserId: "admin-a",
      companyId: "company-a",
      correlationId: "correlation-a",
      timeoutMs: 30_000,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(JobExecutionError);
    expect(error).toMatchObject({
      code: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
      retryable: false,
      partiallyCompleted: true,
    });
    expect(mocks.releaseLock).toHaveBeenCalledOnce();
  });
});
