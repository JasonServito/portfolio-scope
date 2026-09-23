import { describe, expect, it, vi } from "vitest";

import companyFactsFixture from "@/tests/fixtures/sec/aapl-companyfacts.json";
import submissionsFixture from "@/tests/fixtures/sec/aapl-submissions.json";
import { SecClientError, SecClientErrorCode } from "@/lib/sec/client";
import {
  SecIngestionErrorCode,
  ingestSupportedCompany,
} from "@/lib/sec/ingestion";
import type { SecRepository } from "@/lib/sec/repository";
import {
  InMemoryObjectStorage,
  type ObjectStorage,
} from "@/lib/storage/object-storage";

function createRepository(): SecRepository {
  let rawSource = 0;
  const saveFilings: SecRepository["saveFilings"] = async (
    _secEntityId,
    filings,
  ) =>
    new Map(
      filings.map((filing) => [filing.accessionNumber, filing.accessionNumber]),
    );
  const saveFacts: SecRepository["saveFacts"] = async ({ facts }) => ({
    processed: facts.length,
    selected: facts.filter(({ selection }) => selection === "SELECTED").length,
    ambiguous: facts.filter(({ selection }) => selection === "AMBIGUOUS")
      .length,
  });
  return {
    ensureIdentity: vi.fn(async () => ({
      companyId: "company-aapl",
      secEntityId: "entity-aapl",
    })),
    updateEntityMetadata: vi.fn(async () => undefined),
    startRun: vi.fn(async ({ correlationId }) => ({
      id: `run-${correlationId}`,
    })),
    saveRawSource: vi.fn(async ({ objectKey }) => ({
      id: `raw-${++rawSource}`,
      objectKey,
    })),
    saveFilings: vi.fn(saveFilings),
    saveFacts: vi.fn(saveFacts),
    completeRun: vi.fn(async () => undefined),
    failRun: vi.fn(async () => undefined),
  };
}

const fixtureClient = {
  getSubmissions: vi.fn(async () => submissionsFixture),
  getCompanyFacts: vi.fn(async () => companyFactsFixture),
};

describe("controlled SEC ingestion", () => {
  it("retains twelve months of 8-K metadata only where current reports are enabled, leaving facts unchanged", async () => {
    const now = () => new Date("2026-07-15T18:00:00.000Z");
    const run = async (environment: NodeJS.ProcessEnv) => {
      const repository = createRepository();
      const result = await ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: `correlation-${Math.random()}` },
        {
          repository,
          storage: new InMemoryObjectStorage(),
          client: fixtureClient,
          now,
          environment,
        },
      );
      const saveFilings = vi.mocked(repository.saveFilings);
      const saveFacts = vi.mocked(repository.saveFacts);
      return {
        result,
        filings: saveFilings.mock.calls[0][1],
        facts: saveFacts.mock.calls[0][0].facts,
      };
    };

    const disabled = await run({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(disabled.result.filingsProcessed).toBe(2);
    expect(disabled.filings.map((filing) => filing.formType)).toEqual([
      "10-K",
      "10-Q",
    ]);

    const enabled = await run({
      NODE_ENV: "test",
      SEC_CURRENT_REPORTS_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(enabled.result.filingsProcessed).toBe(4);
    expect(
      enabled.filings.map((filing) => [filing.formType, filing.itemCodes]),
    ).toEqual([
      ["10-K", []],
      ["10-Q", []],
      ["8-K", ["2.02", "9.01"]],
      ["8-K", ["2.02", "9.01"]],
    ]);
    // The relaxed form filter changes no fact: facts come from Company Facts
    // and keep their own 10-K/10-Q filter.
    expect(enabled.facts).toEqual(disabled.facts);
    expect(enabled.result.factsProcessed).toBe(disabled.result.factsProcessed);
    expect(enabled.result.factsSelected).toBe(disabled.result.factsSelected);
  });

  it("stores raw payloads before persisting normalized facts and completes idempotently", async () => {
    const repository = createRepository();
    const storage = new InMemoryObjectStorage();
    const now = () => new Date("2026-07-15T18:00:00.000Z");

    const first = await ingestSupportedCompany(
      "aapl",
      {
        trigger: "TEST",
        requestedByUserId: "admin-a",
        correlationId: "correlation-a",
      },
      { repository, storage, client: fixtureClient, now },
    );
    const second = await ingestSupportedCompany(
      "AAPL",
      {
        trigger: "TEST",
        requestedByUserId: "admin-a",
        correlationId: "correlation-b",
      },
      { repository, storage, client: fixtureClient, now },
    );

    expect(first).toMatchObject({
      ticker: "AAPL",
      status: "COMPLETED",
      filingsProcessed: 2,
      factsSelected: expect.any(Number),
    });
    expect(second.status).toBe("COMPLETED");
    expect(storage.objects.size).toBe(2);
    expect(repository.saveRawSource).toHaveBeenCalledTimes(4);
    expect(repository.saveRawSource).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "COMPANY_FACTS",
        sourceUrl:
          "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      }),
    );
    expect(repository.saveFacts).toHaveBeenCalledTimes(2);
    expect(repository.completeRun).toHaveBeenCalledTimes(2);
    expect(repository.failRun).not.toHaveBeenCalled();
    expect(repository.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ requestedByUserId: "admin-a" }),
    );
  });

  it("preserves filing progress and emits safe diagnostics for Company Facts schema failures", async () => {
    const repository = createRepository();
    const logger = vi.fn();
    const client = {
      getSubmissions: vi.fn(async () => submissionsFixture),
      getCompanyFacts: vi.fn(async () => {
        throw new SecClientError(
          SecClientErrorCode.SCHEMA_VALIDATION_FAILED,
          false,
          "SEC response did not match the expected contract.",
          {
            details: {
              operation: "get-company-facts",
              endpointUrl:
                "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json?ignored=1",
              attemptNumber: 1,
              httpStatus: 200,
              failureCategory: "schema-validation",
            },
          },
        );
      }),
    };

    await expect(
      ingestSupportedCompany(
        "AAPL",
        { trigger: "LOCAL", correlationId: "schema-failure" },
        {
          repository,
          storage: new InMemoryObjectStorage(),
          client,
          logger,
          now: () => new Date("2026-07-22T05:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
      retryable: false,
      partiallyCompleted: true,
    });
    expect(repository.saveFilings).toHaveBeenCalledOnce();
    expect(repository.saveRawSource).toHaveBeenCalledOnce();
    expect(repository.saveFacts).not.toHaveBeenCalled();
    expect(repository.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        partiallyCompleted: true,
        filingsProcessed: 2,
        errorCode: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
      }),
    );
    expect(logger).toHaveBeenCalledWith({
      timestamp: "2026-07-22T05:00:00.000Z",
      level: "error",
      event: "sec.ingestion.failed",
      correlationId: "schema-failure",
      ticker: "AAPL",
      cik: "0000320193",
      trigger: "LOCAL",
      executionPath: "LOCAL_SYNCHRONOUS",
      stage: "company-facts-retrieval",
      operation: "get-company-facts",
      endpointUrl:
        "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      attemptNumber: 1,
      httpStatus: 200,
      failureCategory: "schema-validation",
      upstreamErrorCode: SecClientErrorCode.SCHEMA_VALIDATION_FAILED,
      errorCode: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
      retryable: false,
      partiallyCompleted: true,
    });
  });

  it("preserves filing progress and records a partial failure when the second raw write fails", async () => {
    const repository = createRepository();
    const logger = vi.fn();
    const memory = new InMemoryObjectStorage();
    let writes = 0;
    const storage: ObjectStorage = {
      async put(input) {
        writes += 1;
        if (writes === 2) throw new Error("R2 unavailable");
        return memory.put(input);
      },
      get: (key) => memory.get(key),
    };

    await expect(
      ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: "partial-run" },
        {
          repository,
          storage,
          client: fixtureClient,
          logger,
          now: () => new Date("2026-07-15T18:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.STORAGE_ERROR,
      status: 503,
    });
    expect(repository.saveFilings).toHaveBeenCalledOnce();
    expect(repository.saveFacts).not.toHaveBeenCalled();
    expect(repository.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        partiallyCompleted: true,
        filingsProcessed: 2,
        errorCode: SecIngestionErrorCode.STORAGE_ERROR,
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "partial-run",
        stage: "company-facts-raw-persistence",
        operation: "r2-put-company-facts",
        failureCategory: "object-storage",
        errorCode: SecIngestionErrorCode.STORAGE_ERROR,
        retryable: true,
        partiallyCompleted: true,
      }),
    );
  });

  it("classifies raw metadata persistence failures as database errors", async () => {
    const repository = createRepository();
    vi.mocked(repository.saveRawSource).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: "raw-metadata-failure" },
        {
          repository,
          storage: new InMemoryObjectStorage(),
          client: fixtureClient,
        },
      ),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.DATABASE_ERROR,
      status: 503,
    });
    expect(repository.failRun).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: SecIngestionErrorCode.DATABASE_ERROR,
      }),
    );
  });

  it("returns controlled database errors when an ingestion run cannot start", async () => {
    const repository = createRepository();
    vi.mocked(repository.startRun).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: "start-failure" },
        { repository },
      ),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.DATABASE_ERROR,
      status: 503,
    });
    expect(repository.failRun).not.toHaveBeenCalled();
  });

  it("reports missing raw storage configuration without exposing validation details", async () => {
    const repository = createRepository();

    await expect(
      ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: "storage-config-failure" },
        { repository, client: fixtureClient, storageEnvironment: {} },
      ),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.CONFIGURATION_ERROR,
      status: 503,
      message: "SEC raw storage is not configured.",
    });
  });

  it("rejects unsupported tickers before creating records or external clients", async () => {
    const repository = createRepository();

    await expect(
      ingestSupportedCompany("SHOP", { trigger: "TEST" }, { repository }),
    ).rejects.toMatchObject({
      code: SecIngestionErrorCode.UNSUPPORTED_TICKER,
      status: 400,
    });
    expect(repository.ensureIdentity).not.toHaveBeenCalled();
  });
});
