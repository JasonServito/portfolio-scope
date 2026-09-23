import { BackgroundJobType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestSupportedCompany: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  invalidate: vi.fn(),
  setJson: vi.fn(),
  ensureIdentity: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
  findFilings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { secFiling: { findMany: mocks.findFilings } },
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

vi.mock("@/lib/jobs/service", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

vi.mock("@/lib/sec/repository", () => ({
  prismaSecRepository: { ensureIdentity: mocks.ensureIdentity },
}));

import { JobExecutionError } from "@/lib/jobs/errors";
import { SecIngestionError, SecIngestionErrorCode } from "@/lib/sec/ingestion";
import { SEC_FILING_SECTION_PARSER_VERSION } from "@/lib/sec/filing-sections";
import {
  executeSecIngestionJob,
  queueSecFilingDocumentFetches,
  queueSecIngestion,
} from "@/lib/sec/jobs";

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
  mocks.ensureIdentity.mockResolvedValue({
    companyId: "company-a",
    secEntityId: "sec-entity-a",
  });
  mocks.enqueueBackgroundJob.mockResolvedValue({
    jobId: "job-a",
    reused: false,
  });
  mocks.findFilings.mockResolvedValue([]);
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

describe("M15 SEC background integration", () => {
  it("preserves a scheduled child correlation and the company idempotency bucket", async () => {
    const publisher = { publishJSON: vi.fn() };
    const environment = {
      NODE_ENV: "test",
      BACKGROUND_JOBS_ENABLED: "true",
      SEC_INGESTION_ENABLED: "true",
    } as NodeJS.ProcessEnv;

    await expect(
      queueSecIngestion("AAPL", {
        correlationId: "parent-correlation:sec:aapl:child-correlation",
        publisher,
        environment,
        now: () => new Date("2026-09-12T20:15:00.000Z"),
      }),
    ).resolves.toEqual({ jobId: "job-a", reused: false });

    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      {
        type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
        idempotencyKey: "sec:company-a:2026-09-12T18:00:00.000Z",
        correlationId: "parent-correlation:sec:aapl:child-correlation",
        payload: { ticker: "AAPL" },
        userId: null,
        companyId: "company-a",
      },
      { publisher, environment },
    );
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

describe("M31 filing document fetch queueing", () => {
  const enabled = {
    NODE_ENV: "test",
    BACKGROUND_JOBS_ENABLED: "true",
    SEC_INGESTION_ENABLED: "true",
    SEC_FILING_TEXT_ENABLED: "true",
  } as NodeJS.ProcessEnv;
  const filings = [
    {
      id: "filing-10q-new",
      accessionNumber: "0000320193-26-000060",
      formType: "10-Q",
      primaryDocument: "aapl-20260627.htm",
      extraction: null,
    },
    {
      id: "filing-10k-current",
      accessionNumber: "0000320193-25-000079",
      formType: "10-K",
      primaryDocument: "aapl-20250927.htm",
      extraction: {
        status: "COMPLETED",
        parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      },
    },
    {
      id: "filing-10q-older",
      accessionNumber: "0000320193-26-000042",
      formType: "10-Q",
      primaryDocument: "aapl-20260328.htm",
      extraction: null,
    },
  ];
  const now = () => new Date("2026-09-12T20:15:00.000Z");
  const bucket = "2026-09-12T18:00:00.000Z";

  it("queues nothing and touches no filing state while the feature flag is off", async () => {
    await expect(
      queueSecFilingDocumentFetches({
        ticker: "AAPL",
        correlationId: "correlation-a",
        environment: {
          NODE_ENV: "test",
          BACKGROUND_JOBS_ENABLED: "true",
        } as NodeJS.ProcessEnv,
      }),
    ).resolves.toEqual({
      queued: [],
      current: [],
      skipped: "SEC filing text evidence is disabled.",
    });
    expect(mocks.findFilings).not.toHaveBeenCalled();
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();

    const ingestion = await executeSecIngestionJob({
      ticker: "AAPL",
      requestedByUserId: null,
      companyId: "company-a",
      correlationId: "correlation-a",
      timeoutMs: 30_000,
    });
    expect(ingestion.filingDocuments).toEqual({
      queued: [],
      current: [],
      skipped: "SEC filing text evidence is disabled.",
    });
  });

  it("queues one per-filing, parser-versioned fetch for the latest unextracted 10-K or 10-Q only", async () => {
    mocks.findFilings.mockResolvedValue(filings);
    const publisher = { publishJSON: vi.fn() };

    const result = await queueSecFilingDocumentFetches({
      ticker: "AAPL",
      correlationId: "correlation-a",
      publisher,
      environment: enabled,
      now,
    });

    expect(result).toEqual({
      queued: [
        {
          jobId: "job-a",
          formType: "10-Q",
          accessionNumber: "0000320193-26-000060",
          reused: false,
        },
      ],
      current: [
        {
          formType: "10-K",
          accessionNumber: "0000320193-25-000079",
          status: "COMPLETED",
        },
      ],
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      {
        type: BackgroundJobType.SEC_FILING_FETCH,
        idempotencyKey: `sec-filing:filing-10q-new:${SEC_FILING_SECTION_PARSER_VERSION}:${bucket}`,
        correlationId: "correlation-a",
        payload: {
          ticker: "AAPL",
          accessionNumber: "0000320193-26-000060",
          primaryDocument: "aapl-20260627.htm",
        },
      },
      { publisher, environment: enabled },
    );
    expect(mocks.findFilings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          secEntity: { cik: "0000320193" },
          formType: { in: ["10-K", "10-Q"] },
        }),
      }),
    );
  });

  it("re-queues a filing whose last attempt failed transiently but not one the parser cannot read", async () => {
    mocks.findFilings.mockResolvedValue([
      {
        id: "filing-10k-transient",
        accessionNumber: "0000320193-25-000079",
        formType: "10-K",
        primaryDocument: "aapl-20250927.htm",
        extraction: {
          status: "FAILED",
          parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
          errorCode: "SEC_PROVIDER_UNAVAILABLE",
        },
      },
      {
        id: "filing-10q-unreadable",
        accessionNumber: "0000320193-26-000060",
        formType: "10-Q",
        primaryDocument: "aapl-20260627.htm",
        extraction: {
          status: "FAILED",
          parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
          errorCode: "SEC_FILING_SECTIONS_NOT_FOUND",
        },
      },
    ]);

    const result = await queueSecFilingDocumentFetches({
      ticker: "AAPL",
      correlationId: "correlation-a",
      environment: enabled,
      now,
    });

    expect(result.queued.map((job) => job.accessionNumber)).toEqual([
      "0000320193-25-000079",
    ]);
    expect(result.current).toEqual([
      {
        formType: "10-Q",
        accessionNumber: "0000320193-26-000060",
        status: "FAILED",
      },
    ]);
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `sec-filing:filing-10k-transient:${SEC_FILING_SECTION_PARSER_VERSION}:${bucket}`,
      }),
      expect.anything(),
    );
  });

  it("records a queueing failure on the completed ingestion result instead of failing the fact refresh", async () => {
    mocks.findFilings.mockRejectedValue(new Error("database unavailable"));

    const ingestion = await executeSecIngestionJob(
      {
        ticker: "AAPL",
        requestedByUserId: null,
        companyId: "company-a",
        correlationId: "correlation-a",
        timeoutMs: 30_000,
      },
      { environment: enabled },
    );

    expect(ingestion).toMatchObject({
      status: "COMPLETED",
      filingDocuments: {
        queued: [],
        current: [],
        error: "SEC filing document fetches could not be queued.",
      },
    });
    expect(mocks.releaseLock).toHaveBeenCalledOnce();
  });
});
