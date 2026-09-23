import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { JobPublisher } from "@/lib/jobs/qstash";
import {
  createPrismaResearchEvidenceRepository,
  prepareResearchEvidenceSnapshot,
} from "@/lib/research/ai/retrieval";
import {
  SecClientError,
  SecClientErrorCode,
  buildSecFilingIndexUrl,
  buildSecFilingUrl,
} from "@/lib/sec/client";
import { getSupportedCompany } from "@/lib/sec/company-registry";
import { SEC_FILING_SECTION_PARSER_VERSION } from "@/lib/sec/filing-sections";
import {
  fetchSecFilingDocument,
  queueSecFilingDocumentFetches,
} from "@/lib/sec/jobs";
import { prismaSecRepository } from "@/lib/sec/repository";
import { InMemoryObjectStorage } from "@/lib/storage/object-storage";

/**
 * Exercises the M31 ingestion and retrieval boundary against PostgreSQL with
 * a fixture SEC client and in-memory object storage: no network, R2, or
 * provider is involved. The fixture filings carry far-future filing dates so
 * they are the latest 10-K and 10-Q for the real AAPL identity regardless of
 * what a local backfill holds, and every row they create is removed again.
 */

const runId = randomUUID().replaceAll("-", "");
const prefix = `m31-${runId}`;
const apple = getSupportedCompany("AAPL")!;
const suffix = String(Number.parseInt(runId.slice(0, 6), 16) % 1_000_000).padStart(
  6,
  "0",
);
const fixtureDirectory = join(process.cwd(), "tests", "fixtures", "sec");
const tenK = readFileSync(
  join(fixtureDirectory, "aapl-10k-primary-document-clipped.htm"),
);
const tenQ = readFileSync(
  join(fixtureDirectory, "aapl-10q-primary-document-clipped.htm"),
);
const headless = Buffer.from(
  "<html><body><p>This document has no Item headings at all.</p></body></html>",
  "utf8",
);

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

const filings = {
  tenK: {
    id: `${prefix}-filing-10k`,
    accessionNumber: `0000320193-93-${suffix}`,
    formType: "10-K",
    filingDate: "2099-01-31",
    reportDate: "2098-12-27",
    primaryDocument: "aapl-20981227.htm",
    body: tenK as Uint8Array | null,
  },
  tenQ: {
    id: `${prefix}-filing-10q`,
    accessionNumber: `0000320193-92-${suffix}`,
    formType: "10-Q",
    filingDate: "2099-05-01",
    reportDate: "2099-03-28",
    primaryDocument: "aapl-20990328.htm",
    body: tenQ as Uint8Array | null,
  },
  unavailable: {
    id: `${prefix}-filing-unavailable`,
    accessionNumber: `0000320193-91-${suffix}`,
    formType: "10-Q",
    filingDate: "2099-01-30",
    reportDate: "2098-12-27",
    primaryDocument: "aapl-20981227q.htm",
    body: null as Uint8Array | null,
  },
  headless: {
    id: `${prefix}-filing-headless`,
    accessionNumber: `0000320193-90-${suffix}`,
    formType: "10-K",
    filingDate: "2098-10-31",
    reportDate: "2098-09-26",
    primaryDocument: "aapl-20980926.htm",
    body: headless as Uint8Array | null,
  },
};

// Accession numbers whose next fetch fails transiently, then recover.
const failNext = new Set<string>();
const client = {
  getFilingDocument: vi.fn(
    async (_cik: string, accessionNumber: string, primaryDocument: string) => {
      const filing = Object.values(filings).find(
        (candidate) => candidate.accessionNumber === accessionNumber,
      );
      if (!filing?.body || failNext.delete(accessionNumber)) {
        throw new SecClientError(
          SecClientErrorCode.PROVIDER_UNAVAILABLE,
          true,
          "SEC filing retrieval is temporarily unavailable.",
          {
            details: {
              operation: "get-filing-document",
              failureCategory: "provider-unavailable",
            },
          },
        );
      }
      return {
        url: buildSecFilingUrl(apple.cik, accessionNumber, primaryDocument),
        body: new Uint8Array(filing.body),
        contentType: "text/html",
      };
    },
  ),
};
const storage = new InMemoryObjectStorage();
const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  SEC_INGESTION_ENABLED: "true",
  SEC_FILING_TEXT_ENABLED: "true",
} as NodeJS.ProcessEnv;
const publisher: JobPublisher = {
  publishJSON: vi.fn().mockImplementation(async () => ({
    messageId: `${prefix}-${randomUUID()}`,
  })),
};

let secEntityId = "";
let stockId = "";

async function cleanup() {
  await db.backgroundJob.deleteMany({
    where: { idempotencyKey: { startsWith: `sec-filing:${prefix}` } },
  });
  // Deleting the filings cascades their extraction state and passages.
  await db.secFiling.deleteMany({ where: { id: { startsWith: prefix } } });
  if (secEntityId) {
    await db.secRawSource.deleteMany({
      where: {
        secEntityId,
        kind: "FILING_DOCUMENT",
        sha256: { in: [sha256(tenK), sha256(tenQ), sha256(headless)] },
      },
    });
  }
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M31 integration tests must not run against production.");
  }
  const identity = await prismaSecRepository.ensureIdentity(apple);
  secEntityId = identity.secEntityId;
  stockId = (
    await db.stock.findUniqueOrThrow({
      where: { ticker: apple.ticker },
      select: { id: true },
    })
  ).id;
  await cleanup();
  await db.secFiling.createMany({
    data: Object.values(filings).map((filing) => ({
      id: filing.id,
      secEntityId,
      accessionNumber: filing.accessionNumber,
      formType: filing.formType,
      filingDate: new Date(`${filing.filingDate}T00:00:00.000Z`),
      reportDate: new Date(`${filing.reportDate}T00:00:00.000Z`),
      primaryDocument: filing.primaryDocument,
      primaryDocumentDescription: filing.formType,
      sourceUrl: buildSecFilingIndexUrl(apple.cik, filing.accessionNumber),
    })),
  });
});

afterAll(cleanup);

function fetchFixture(filing: (typeof filings)[keyof typeof filings]) {
  return fetchSecFilingDocument(
    {
      ticker: apple.ticker,
      accessionNumber: filing.accessionNumber,
      primaryDocument: filing.primaryDocument,
    },
    { client, storage },
  );
}

describe("M31 filing text ingestion", () => {
  it("fetches, stores the document content-addressed, extracts sections, persists passages, and reruns idempotently", async () => {
    const first = await fetchFixture(filings.tenK);

    expect(first).toMatchObject({
      filingId: filings.tenK.id,
      extractionStatus: "COMPLETED",
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      extractedSections: ["BUSINESS", "RISK_FACTORS", "MDA"],
      missingSections: [],
      truncatedSections: [],
      sha256: sha256(tenK),
      objectKey: `sec/${apple.cik}/filings/${sha256(tenK)}.htm`,
    });
    expect(first.chunkCount).toBeGreaterThan(6);
    expect(storage.objects.get(first.objectKey)).toEqual(new Uint8Array(tenK));

    const rawSource = await db.secRawSource.findUniqueOrThrow({
      where: { id: first.rawSourceId },
    });
    expect(rawSource).toMatchObject({
      secEntityId,
      kind: "FILING_DOCUMENT",
      objectKey: first.objectKey,
      sha256: sha256(tenK),
      contentType: "text/html",
      sourceUrl: buildSecFilingUrl(
        apple.cik,
        filings.tenK.accessionNumber,
        filings.tenK.primaryDocument,
      ),
    });
    expect(Number(rawSource.byteLength)).toBe(tenK.byteLength);

    const extraction = await db.secFilingExtraction.findUniqueOrThrow({
      where: { filingId: filings.tenK.id },
      include: { chunks: { orderBy: [{ sectionKind: "asc" }, { ordinal: "asc" }] } },
    });
    expect(extraction).toMatchObject({
      status: "COMPLETED",
      rawSourceId: first.rawSourceId,
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      expectedSections: ["BUSINESS", "RISK_FACTORS", "MDA"],
      extractedSections: ["BUSINESS", "RISK_FACTORS", "MDA"],
      truncatedSections: [],
      chunkCount: first.chunkCount,
      errorCode: null,
    });
    expect(extraction.chunks).toHaveLength(first.chunkCount);
    for (const chunk of extraction.chunks) {
      expect(chunk.rawSourceId).toBe(first.rawSourceId);
      expect(chunk.passageEnd).toBeGreaterThan(chunk.passageStart);
      expect(chunk.text.length).toBeLessThanOrEqual(1_600);
      expect(sha256(chunk.text)).toBe(chunk.sha256);
      expect(chunk.sectionLabel).toMatch(/^Item \d+A?\. /);
    }
    expect(
      new Set(extraction.chunks.map((chunk) => `${chunk.sectionKind}:${chunk.ordinal}`))
        .size,
    ).toBe(extraction.chunks.length);

    const second = await fetchFixture(filings.tenK);
    expect(second.rawSourceId).toBe(first.rawSourceId);
    expect(second.chunkCount).toBe(first.chunkCount);
    await expect(
      db.secRawSource.count({
        where: { secEntityId, kind: "FILING_DOCUMENT", sha256: sha256(tenK) },
      }),
    ).resolves.toBe(1);
    await expect(
      db.secFilingChunk.count({ where: { filingId: filings.tenK.id } }),
    ).resolves.toBe(first.chunkCount);
    await expect(
      db.secFilingExtraction.count({ where: { filingId: filings.tenK.id } }),
    ).resolves.toBe(1);
  });

  it("extracts the 10-Q management's discussion", async () => {
    const result = await fetchFixture(filings.tenQ);

    expect(result).toMatchObject({
      extractionStatus: "COMPLETED",
      extractedSections: ["MDA"],
      missingSections: [],
    });
    const chunks = await db.secFilingChunk.findMany({
      where: { filingId: filings.tenQ.id },
      orderBy: { ordinal: "asc" },
    });
    expect(chunks.length).toBe(result.chunkCount);
    expect(chunks.every((chunk) => chunk.sectionKind === "MDA")).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain(
      "Quarterly Highlights",
    );
  });

  it("records a retryable fetch failure on the filing without storing a document or blocking anything else", async () => {
    const rawSourcesBefore = await db.secRawSource.count({
      where: { secEntityId, kind: "FILING_DOCUMENT" },
    });

    await expect(fetchFixture(filings.unavailable)).rejects.toMatchObject({
      name: "JobExecutionError",
      code: SecClientErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true,
    });

    await expect(
      db.secFilingExtraction.findUniqueOrThrow({
        where: { filingId: filings.unavailable.id },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      rawSourceId: null,
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      expectedSections: ["MDA"],
      extractedSections: [],
      chunkCount: 0,
      errorCode: SecClientErrorCode.PROVIDER_UNAVAILABLE,
    });
    await expect(
      db.secFilingChunk.count({ where: { filingId: filings.unavailable.id } }),
    ).resolves.toBe(0);
    await expect(
      db.secRawSource.count({ where: { secEntityId, kind: "FILING_DOCUMENT" } }),
    ).resolves.toBe(rawSourcesBefore);
    // The other filings' state is untouched.
    await expect(
      db.secFilingChunk.count({ where: { filingId: filings.tenK.id } }),
    ).resolves.toBeGreaterThan(0);
  });

  it("keeps a document whose expected headings are missing and records the failed extraction", async () => {
    await expect(fetchFixture(filings.headless)).rejects.toMatchObject({
      name: "JobExecutionError",
      code: "SEC_FILING_SECTIONS_NOT_FOUND",
      retryable: false,
      partiallyCompleted: true,
    });

    const extraction = await db.secFilingExtraction.findUniqueOrThrow({
      where: { filingId: filings.headless.id },
    });
    expect(extraction).toMatchObject({
      status: "FAILED",
      chunkCount: 0,
      errorCode: "SEC_FILING_SECTIONS_NOT_FOUND",
    });
    expect(extraction.rawSourceId).not.toBeNull();
    await expect(
      db.secRawSource.findUniqueOrThrow({
        where: { id: extraction.rawSourceId! },
      }),
    ).resolves.toMatchObject({
      kind: "FILING_DOCUMENT",
      sha256: sha256(headless),
    });
  });

  it("keeps earlier passages when a re-fetch fails transiently and queues the filing again later", async () => {
    // A prior extraction from an older parser version is still serving
    // passages when the fetch of the same filing fails.
    await db.secFilingExtraction.update({
      where: { filingId: filings.tenK.id },
      data: { parserVersion: "sec-filing-sections-v0" },
    });
    const chunksBefore = await db.secFilingChunk.count({
      where: { filingId: filings.tenK.id },
    });
    expect(chunksBefore).toBeGreaterThan(0);
    failNext.add(filings.tenK.accessionNumber);

    await expect(fetchFixture(filings.tenK)).rejects.toMatchObject({
      code: SecClientErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true,
    });

    await expect(
      db.secFilingExtraction.findUniqueOrThrow({
        where: { filingId: filings.tenK.id },
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      parserVersion: "sec-filing-sections-v0",
      chunkCount: chunksBefore,
    });
    await expect(
      db.secFilingChunk.count({ where: { filingId: filings.tenK.id } }),
    ).resolves.toBe(chunksBefore);

    // The stale extraction is not current, so the next refresh queues it.
    const requeued = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId: `${prefix}-requeue`,
      publisher,
      environment,
      now: () => new Date("2099-06-01T03:00:00.000Z"),
    });
    expect(requeued.queued.map((job) => job.accessionNumber)).toEqual([
      filings.tenK.accessionNumber,
    ]);

    // A successful re-fetch replaces the passages under the current parser.
    await expect(fetchFixture(filings.tenK)).resolves.toMatchObject({
      extractionStatus: "COMPLETED",
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    });
  });

  it("queues one parser-versioned fetch per unextracted latest filing and reuses it within a six-hour bucket", async () => {
    // Simulate a latest 10-Q whose sections have not been extracted yet.
    await db.secFilingExtraction.delete({
      where: { filingId: filings.tenQ.id },
    });
    const correlationId = `${prefix}-correlation`;
    const now = () => new Date("2099-06-01T09:30:00.000Z");

    const queued = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId,
      publisher,
      environment,
      now,
    });

    expect(queued).toMatchObject({
      queued: [
        {
          formType: "10-Q",
          accessionNumber: filings.tenQ.accessionNumber,
          reused: false,
        },
      ],
      current: [
        {
          formType: "10-K",
          accessionNumber: filings.tenK.accessionNumber,
          status: "COMPLETED",
        },
      ],
    });
    const job = await db.backgroundJob.findUniqueOrThrow({
      where: {
        idempotencyKey: `sec-filing:${filings.tenQ.id}:${SEC_FILING_SECTION_PARSER_VERSION}:2099-06-01T06:00:00.000Z`,
      },
    });
    expect(job).toMatchObject({
      type: "SEC_FILING_FETCH",
      correlationId,
      companyId: null,
      payloadJson: {
        ticker: apple.ticker,
        accessionNumber: filings.tenQ.accessionNumber,
        primaryDocument: filings.tenQ.primaryDocument,
      },
    });

    const repeated = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId,
      publisher,
      environment,
      now,
    });
    expect(repeated.queued).toEqual([
      expect.objectContaining({ jobId: job.id, reused: true }),
    ]);
    await expect(
      db.backgroundJob.count({
        where: {
          idempotencyKey: { startsWith: `sec-filing:${filings.tenQ.id}:` },
        },
      }),
    ).resolves.toBe(1);

    // Extract it again so the snapshot below sees both latest filings.
    await expect(fetchFixture(filings.tenQ)).resolves.toMatchObject({
      extractionStatus: "COMPLETED",
    });
    await expect(
      queueSecFilingDocumentFetches({
        ticker: apple.ticker,
        correlationId,
        publisher,
        environment,
      }),
    ).resolves.toMatchObject({ queued: [] });
  });

  it("threads the latest 10-K and 10-Q passages into the research snapshot with verifiable provenance", async () => {
    const repository = createPrismaResearchEvidenceRepository(db);
    const records = await repository.listFilingPassages({ secEntityId });

    expect(records.length).toBeGreaterThan(6);
    expect(new Set(records.map((record) => record.filing.id))).toEqual(
      new Set([filings.tenK.id, filings.tenQ.id]),
    );
    for (const record of records) {
      expect(record.rawSource.kind).toBe("FILING_DOCUMENT");
      expect(record.parserVersion).toBe(SEC_FILING_SECTION_PARSER_VERSION);
    }

    const snapshot = await prepareResearchEvidenceSnapshot(
      { stockId, ticker: apple.ticker, companyName: apple.companyName },
      { repository },
    );
    const passages = snapshot.evidence.filter(
      (item) => item.sourceKind === "SEC_FILING",
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.length).toBeLessThanOrEqual(24);
    const chunksById = new Map(
      (
        await db.secFilingChunk.findMany({
          where: { filingId: { in: [filings.tenK.id, filings.tenQ.id] } },
        })
      ).map((chunk) => [`${chunk.filingId}:${chunk.sectionKind}:${chunk.ordinal}`, chunk]),
    );
    for (const passage of passages) {
      const filing = Object.values(filings).find(
        (candidate) => candidate.id === passage.secFilingId,
      )!;
      expect([filings.tenK.id, filings.tenQ.id]).toContain(filing.id);
      expect(passage.sourceUrl).toBe(
        buildSecFilingUrl(apple.cik, filing.accessionNumber, filing.primaryDocument),
      );
      expect(passage.accessionNumber).toBe(filing.accessionNumber);
      const chunk = chunksById.get(
        `${filing.id}:${passage.metadata.sectionKind}:${passage.metadata.chunkOrdinal}`,
      )!;
      expect(chunk).toBeDefined();
      expect(passage.excerpt).toBe(chunk.text);
      expect(passage.sha256).toBe(chunk.sha256);
      expect(sha256(passage.excerpt)).toBe(chunk.sha256);
      expect(passage.passageStart).toBe(chunk.passageStart);
      expect(passage.passageEnd).toBe(chunk.passageEnd);
      expect(passage.secRawSourceId).toBe(chunk.rawSourceId);
    }
    expect(
      passages.some((item) => item.secFilingId === filings.headless.id),
    ).toBe(false);
    expect(
      passages.some((item) => item.secFilingId === filings.unavailable.id),
    ).toBe(false);
  });
});
