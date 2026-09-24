import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentName,
  AgentStatus,
  BackgroundJobType,
  ResearchStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { getAiResearchConfig } from "@/lib/research/ai/config";
import {
  AAPL_FIXTURE_CURRENT_REPORTS,
  AAPL_FIXTURE_FILING_DOCUMENTS,
  AAPL_FIXTURE_PEERS,
  AAPL_FIXTURE_STOCK,
  AAPL_FIXTURE_UPCOMING_EARNINGS,
  aaplFixtureCurrentReports,
  aaplFixtureFactCandidates,
  aaplFixtureFilingPassages,
  aaplFixturePeerFactCandidates,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  AAPL_GROUNDED_SYNTHESIS,
  recordedSupportedVerification,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_AAPL_SNAPSHOT,
} from "@/lib/research/ai/fixtures/curated-evaluation";
import { RecordedResearchModelProvider } from "@/lib/research/ai/providers";
import {
  assembleResearchEvidenceSnapshot,
  createPrismaResearchEvidenceRepository,
  prepareResearchEvidenceSnapshot,
  type CurrentReportRecord,
} from "@/lib/research/ai/retrieval";
import type { GroundedModelOutput } from "@/lib/research/ai/schemas";
import {
  executeResearchAgent,
  executeResearchSynthesis,
} from "@/lib/research/background";
import { getOwnedResearchJob, runResearch } from "@/lib/research/orchestrator";
import {
  buildSecFilingIndexUrl,
  buildSecFilingUrl,
  SecClientError,
  SecClientErrorCode,
} from "@/lib/sec/client";
import { getSupportedCompany } from "@/lib/sec/company-registry";
import { SEC_FILING_SECTION_PARSER_VERSION } from "@/lib/sec/filing-sections";
import {
  fetchSecFilingDocument,
  queueSecFilingDocumentFetches,
} from "@/lib/sec/jobs";
import { prismaSecRepository } from "@/lib/sec/repository";
import { InMemoryObjectStorage } from "@/lib/storage/object-storage";

const runId = randomUUID().replaceAll("-", "");
const prefix = `m32-${runId}`;
const apple = getSupportedCompany("AAPL")!;
const suffix = String(Number.parseInt(runId.slice(0, 6), 16) % 1_000_000).padStart(
  6,
  "0",
);
const fixtureDirectory = join(process.cwd(), "tests", "fixtures", "sec");
const indexPage = readFileSync(
  join(fixtureDirectory, "aapl-8k-filing-index-clipped.htm"),
  "utf8",
);
const pressRelease = readFileSync(
  join(fixtureDirectory, "aapl-8k-ex991-press-release-clipped.htm"),
  "utf8",
);
const exhibitName = "a8-kex991q3202506282025.htm";
const indexWithoutExhibit = indexPage.replace(
  /<tr>\s*<td scope="row">2<\/td>[\s\S]*?<\/tr>/,
  "",
);

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

// Far-future dates keep these rows out of every other test's "latest 10-K
// and 10-Q" logic; the window in this file is anchored at 2099-06-01.
const now = () => new Date("2099-06-01T12:00:00.000Z");
const reports = {
  results: {
    id: `${prefix}-8k-results`,
    accessionNumber: `0000320193-89-${suffix}`,
    formType: "8-K",
    filingDate: "2099-04-30",
    itemCodes: ["2.02", "9.01"],
    isAmendment: false,
    primaryDocument: "aapl-20990430.htm",
    index: indexPage,
  },
  withoutExhibit: {
    id: `${prefix}-8k-no-exhibit`,
    accessionNumber: `0000320193-88-${suffix}`,
    formType: "8-K",
    filingDate: "2099-01-29",
    itemCodes: ["2.02", "9.01"],
    isAmendment: false,
    primaryDocument: "aapl-20990129.htm",
    index: indexWithoutExhibit,
  },
  pending: {
    id: `${prefix}-8k-pending`,
    accessionNumber: `0000320193-87-${suffix}`,
    formType: "8-K",
    filingDate: "2099-05-15",
    itemCodes: ["2.02", "9.01"],
    isAmendment: false,
    primaryDocument: "aapl-20990515.htm",
    index: indexPage,
  },
  vote: {
    id: `${prefix}-8k-vote`,
    accessionNumber: `0000320193-86-${suffix}`,
    formType: "8-K",
    filingDate: "2099-02-26",
    itemCodes: ["5.07"],
    isAmendment: false,
    primaryDocument: "aapl-20990224.htm",
    index: indexPage,
  },
  amendment: {
    id: `${prefix}-8k-amendment`,
    accessionNumber: `0000320193-85-${suffix}`,
    formType: "8-K/A",
    filingDate: "2099-03-10",
    itemCodes: ["2.02", "9.01"],
    isAmendment: true,
    primaryDocument: "aapl-20990310.htm",
    index: indexPage,
  },
  old: {
    id: `${prefix}-8k-old`,
    accessionNumber: `0000320193-84-${suffix}`,
    formType: "8-K",
    filingDate: "2097-11-01",
    itemCodes: ["2.02", "9.01"],
    isAmendment: false,
    primaryDocument: "aapl-20971101.htm",
    index: indexPage,
  },
};

const client = {
  getFilingDocument: vi.fn(
    async (_cik: string, accessionNumber: string, document: string) => {
      const report = Object.values(reports).find(
        (candidate) => candidate.accessionNumber === accessionNumber,
      );
      if (!report) {
        throw new SecClientError(
          SecClientErrorCode.REQUEST_REJECTED,
          false,
          "SEC rejected the filing request with status 404.",
          { details: { operation: "get-filing-document", failureCategory: "provider-rejection" } },
        );
      }
      const body =
        document === `${accessionNumber}-index.html`
          ? report.index
          : document === exhibitName
            ? pressRelease
            : null;
      if (body === null) {
        throw new SecClientError(
          SecClientErrorCode.REQUEST_REJECTED,
          false,
          "SEC rejected the filing request with status 404.",
          { details: { operation: "get-filing-document", failureCategory: "provider-rejection" } },
        );
      }
      return {
        url: buildSecFilingUrl(apple.cik, accessionNumber, document),
        body: new TextEncoder().encode(body),
        contentType: "text/html",
      };
    },
  ),
};
const storage = new InMemoryObjectStorage();
const secEnvironment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  SEC_INGESTION_ENABLED: "true",
  SEC_CURRENT_REPORTS_ENABLED: "true",
} as NodeJS.ProcessEnv;
const publisher: JobPublisher = {
  publishJSON: vi.fn().mockImplementation(async () => ({
    messageId: `${prefix}-${randomUUID()}`,
  })),
};

let secEntityId = "";
let appleStockId = "";

// Research fixtures: an owned catalog stock with its own company, the 10-K,
// 10-Q, and 8-K filing rows behind the fixture passages and current reports,
// so persisted citations can hold their filing and raw-document foreign keys.
const ticker = `Z${runId.slice(0, 8).toUpperCase()}`;
const ids = {
  user: `${prefix}-user`,
  quietUser: `${prefix}-quiet-user`,
  stock: `${prefix}-stock`,
  company: `${prefix}-company`,
  entity: `${prefix}-entity`,
  filing10k: `${prefix}-filing-10k`,
  filing10q: `${prefix}-filing-10q`,
  raw10k: `${prefix}-raw-10k`,
  raw10q: `${prefix}-raw-10q`,
};
const fixtureUserIds = [ids.user, ids.quietUser];
const subjectCik = String(
  (Number.parseInt(runId.slice(8, 16), 16) % 1_000_000_000) + 3,
).padStart(10, "0");
const accessions = {
  "10-K": `0000320193-83-${suffix}`,
  "10-Q": `0000320193-82-${suffix}`,
  results: `0000320193-81-${suffix}`,
  resultsWithoutExhibit: `0000320193-80-${suffix}`,
  shareholderVote: `0000320193-79-${suffix}`,
} as const;
const filingPassages = aaplFixtureFilingPassages({
  "10-K": {
    filingId: ids.filing10k,
    rawSourceId: ids.raw10k,
    accessionNumber: accessions["10-K"],
  },
  "10-Q": {
    filingId: ids.filing10q,
    rawSourceId: ids.raw10q,
    accessionNumber: accessions["10-Q"],
  },
});
const currentReports: CurrentReportRecord[] = aaplFixtureCurrentReports().map(
  (report) => {
    const key = (
      Object.keys(AAPL_FIXTURE_CURRENT_REPORTS) as Array<
        keyof typeof AAPL_FIXTURE_CURRENT_REPORTS
      >
    ).find(
      (candidate) =>
        AAPL_FIXTURE_CURRENT_REPORTS[candidate].accessionNumber ===
        report.accessionNumber,
    )!;
    const id = `${prefix}-filing-${key}`;
    const rawSourceId = `${prefix}-raw-${key}`;
    return {
      ...report,
      id,
      accessionNumber: accessions[key],
      sourceUrl: buildSecFilingIndexUrl(subjectCik, accessions[key]),
      extraction: report.extraction
        ? {
            ...report.extraction,
            rawSource: report.extraction.rawSource
              ? { ...report.extraction.rawSource, id: rawSourceId }
              : null,
            chunks: report.extraction.chunks.map((chunk) => ({
              ...chunk,
              id: `${id}-${chunk.ordinal}`,
              filingId: id,
              rawSourceId,
            })),
          }
        : null,
    };
  },
);

const environment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
  RESEARCH_GENERATION_ENABLED: "true",
  AI_RESEARCH_ENABLED: "true",
  OPENAI_API_KEY: "recorded-provider-only-no-network",
  OPENAI_RESEARCH_MODEL: "gpt-5.4-mini-2026-03-17",
  AI_MONTHLY_BUDGET_USD: "5",
  AI_USER_MONTHLY_BUDGET_USD: "1",
  AI_MAX_COST_PER_JOB_USD: "0.25",
  AI_MAX_TOKENS_PER_JOB: "50000",
  AI_MAX_OUTPUT_TOKENS_PER_CALL: "2000",
  AI_PROVIDER_TIMEOUT_MS: "20000",
  AI_USER_MONTHLY_REPORT_LIMIT: "5",
} as NodeJS.ProcessEnv;

const snapshotWithEvents = assembleResearchEvidenceSnapshot({
  record: { ...AAPL_FIXTURE_STOCK, id: ids.stock, ticker },
  factCandidates: aaplFixtureFactCandidates(),
  peerRecords: AAPL_FIXTURE_PEERS,
  peerFactCandidates: aaplFixturePeerFactCandidates(),
  upcomingEarnings: AAPL_FIXTURE_UPCOMING_EARNINGS,
  filingPassages,
  currentReports,
});
const snapshotWithoutEvents = assembleResearchEvidenceSnapshot({
  record: { ...AAPL_FIXTURE_STOCK, id: ids.stock, ticker },
  factCandidates: aaplFixtureFactCandidates(),
  peerRecords: AAPL_FIXTURE_PEERS,
  peerFactCandidates: aaplFixturePeerFactCandidates(),
  upcomingEarnings: AAPL_FIXTURE_UPCOMING_EARNINGS,
  filingPassages,
  currentReports: [],
});

const evidenceIdByReference = new Map(
  snapshotWithEvents.evidence.map((item) => [item.sourceReference, item.id]),
);
const fixtureReferenceById = new Map(
  CURATED_AAPL_SNAPSHOT.evidence.map((item) => [item.id, item.sourceReference]),
);
function rekey(id: string) {
  let reference = fixtureReferenceById.get(id)!.replaceAll("AAPL", ticker);
  for (const [key, accession] of Object.entries(accessions)) {
    const fixtureAccession =
      key === "10-K" || key === "10-Q"
        ? AAPL_FIXTURE_FILING_DOCUMENTS[key].accessionNumber
        : AAPL_FIXTURE_CURRENT_REPORTS[key as keyof typeof AAPL_FIXTURE_CURRENT_REPORTS]
            .accessionNumber;
    reference = reference.replaceAll(fixtureAccession, accession);
  }
  const mapped = evidenceIdByReference.get(reference);
  if (!mapped) throw new Error(`No run evidence for ${reference}`);
  return mapped;
}
function rekeyOutput<T extends GroundedModelOutput>(output: T): T {
  return {
    ...output,
    claims: output.claims.map((claim) => ({
      ...claim,
      evidenceIds: claim.evidenceIds.map(rekey),
      counterEvidenceIds: claim.counterEvidenceIds.map(rekey),
    })),
  };
}
const recordedOutputs = {
  FINANCIALS: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.FINANCIALS),
  COMPETITORS: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.COMPETITORS),
  RISK: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.RISK),
  NEWS: rekeyOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS.NEWS),
  SYNTHESIS: rekeyOutput(AAPL_GROUNDED_SYNTHESIS),
};

function recordedProvider(outputs: readonly GroundedModelOutput[]) {
  return new RecordedResearchModelProvider({
    model: "recorded-m32-integration-v1",
    fixtures: outputs
      .flatMap((output): unknown[] =>
        "whatWouldChange" in output
          ? [output, recordedSupportedVerification(output)]
          : [output],
      )
      .map((output, index) => ({
        result: {
          output,
          providerRequestId: `${prefix}-recording-${index + 1}`,
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      })),
  });
}

async function cleanup() {
  await db.backgroundJob.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: `sec-filing:${prefix}` } },
        { userId: { in: fixtureUserIds } },
        { researchJob: { userId: { in: fixtureUserIds } } },
      ],
    },
  });
  await db.secFiling.deleteMany({ where: { id: { startsWith: prefix } } });
  if (secEntityId) {
    await db.secRawSource.deleteMany({
      where: {
        secEntityId,
        kind: "FILING_DOCUMENT",
        sha256: sha256(new TextEncoder().encode(pressRelease)),
      },
    });
  }
  await db.aiUsage.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: prefix } },
        { userId: { in: fixtureUserIds } },
      ],
    },
  });
  await db.aiBudgetPeriod.deleteMany({ where: { userId: { in: fixtureUserIds } } });
  await db.researchJob.deleteMany({ where: { userId: { in: fixtureUserIds } } });
  await db.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  await db.stock.deleteMany({ where: { id: ids.stock } });
  await db.company.deleteMany({ where: { id: ids.company } });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M32 integration tests must not run against production.");
  }
  const identity = await prismaSecRepository.ensureIdentity(apple);
  secEntityId = identity.secEntityId;
  appleStockId = (
    await db.stock.findUniqueOrThrow({
      where: { ticker: apple.ticker },
      select: { id: true },
    })
  ).id;
  await cleanup();
  await db.secFiling.createMany({
    data: Object.values(reports).map((report) => ({
      id: report.id,
      secEntityId,
      accessionNumber: report.accessionNumber,
      formType: report.formType,
      filingDate: new Date(`${report.filingDate}T00:00:00.000Z`),
      reportDate: new Date(`${report.filingDate}T00:00:00.000Z`),
      primaryDocument: report.primaryDocument,
      primaryDocumentDescription: report.formType,
      sourceUrl: buildSecFilingIndexUrl(apple.cik, report.accessionNumber),
      isAmendment: report.isAmendment,
      itemCodes: report.itemCodes,
    })),
  });

  await db.user.createMany({
    data: fixtureUserIds.map((id) => ({
      id,
      email: `${id}@portfolioscope.invalid`,
    })),
  });
  await db.stock.create({
    data: {
      id: ids.stock,
      ticker,
      companyName: snapshotWithEvents.stock.companyName,
      sector: snapshotWithEvents.stock.sector,
      industry: snapshotWithEvents.stock.industry,
      exchange: snapshotWithEvents.stock.exchange,
    },
  });
  const passageFilings = (["10-K", "10-Q"] as const).map(
    (formType) =>
      filingPassages.find((passage) => passage.filing.formType === formType)!,
  );
  const exhibitReport = currentReports.find((report) => report.extraction?.rawSource)!;
  await db.company.create({
    data: {
      id: ids.company,
      slug: `${prefix}-subject`,
      name: "Subject Event Fixture",
      isSupported: true,
      secEntity: {
        create: {
          id: ids.entity,
          cik: subjectCik,
          legalName: "Subject Event Fixture Inc.",
          filings: {
            create: [
              ...passageFilings.map((record) => ({
                id: record.filing.id,
                accessionNumber: record.filing.accessionNumber,
                formType: record.filing.formType,
                filingDate: record.filing.filingDate as Date,
                reportDate: record.filing.reportDate as Date,
                primaryDocument: record.filing.primaryDocument,
                sourceUrl: record.filing.sourceUrl,
              })),
              ...currentReports.map((report) => ({
                id: report.id,
                accessionNumber: report.accessionNumber,
                formType: report.formType,
                filingDate: report.filingDate as Date,
                reportDate: report.reportDate as Date,
                primaryDocument: report.primaryDocument,
                sourceUrl: report.sourceUrl,
                itemCodes: [...report.itemCodes],
              })),
            ],
          },
          rawSources: {
            create: [
              ...passageFilings.map((record) => record.rawSource),
              exhibitReport.extraction!.rawSource!,
            ].map((rawSource) => ({
              id: rawSource.id,
              kind: "FILING_DOCUMENT" as const,
              sourceUrl: rawSource.sourceUrl,
              objectKey: `sec/${subjectCik}/filings/${rawSource.sha256}.htm`,
              sha256: rawSource.sha256,
              contentType: "text/html",
              byteLength: Number(String(rawSource.byteLength)),
              firstRetrievedAt: rawSource.firstRetrievedAt as Date,
              lastRetrievedAt: rawSource.lastRetrievedAt as Date,
            })),
          },
        },
      },
    },
  });
});

afterAll(cleanup);

function fetchReport(report: (typeof reports)[keyof typeof reports]) {
  return fetchSecFilingDocument(
    {
      ticker: apple.ticker,
      accessionNumber: report.accessionNumber,
      primaryDocument: report.primaryDocument,
    },
    { client, storage, now },
  );
}

describe("M32 current-report ingestion", () => {
  it("persists Form 8-K item codes through the repository as an additive column", async () => {
    const accessionNumber = `0000320193-78-${suffix}`;
    const filingIds = await prismaSecRepository.saveFilings(secEntityId, [
      {
        accessionNumber,
        formType: "8-K",
        filingDate: new Date("2099-05-20T00:00:00.000Z"),
        reportDate: new Date("2099-05-20T00:00:00.000Z"),
        acceptanceDateTime: null,
        primaryDocument: "aapl-20990520.htm",
        primaryDocumentDescription: "8-K",
        sourceUrl: buildSecFilingIndexUrl(apple.cik, accessionNumber),
        isAmendment: false,
        amendsAccessionNumber: null,
        itemCodes: ["5.02", "9.01"],
      },
    ]);
    const stored = await db.secFiling.findUniqueOrThrow({
      where: { accessionNumber },
    });
    expect(filingIds.get(accessionNumber)).toBe(stored.id);
    expect(stored.itemCodes).toEqual(["5.02", "9.01"]);
    expect(stored.formType).toBe("8-K");
    // Rows created before M32 carry an empty list, never null.
    const earlier = await db.secFiling.findUniqueOrThrow({
      where: { id: reports.vote.id },
    });
    expect(earlier.itemCodes).toEqual(["5.07"]);
    await db.secFiling.delete({ where: { id: stored.id } });
  });

  it("reads the filing index, fetches the Exhibit 99.1 press release, stores it, and persists hash-verifiable passages idempotently", async () => {
    const result = await fetchReport(reports.results);

    expect(result).toMatchObject({
      filingId: reports.results.id,
      formType: "8-K",
      document: exhibitName,
      extractionStatus: "COMPLETED",
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      extractedSections: ["PRESS_RELEASE"],
      missingSections: [],
    });
    expect(result.chunkCount).toBeGreaterThan(3);
    expect(client.getFilingDocument.mock.calls.map((call) => call[2])).toEqual([
      `${reports.results.accessionNumber}-index.html`,
      exhibitName,
    ]);
    const rawSource = await db.secRawSource.findUniqueOrThrow({
      where: { id: result.rawSourceId },
    });
    expect(rawSource).toMatchObject({
      secEntityId,
      kind: "FILING_DOCUMENT",
      sourceUrl: buildSecFilingUrl(apple.cik, reports.results.accessionNumber, exhibitName),
      sha256: sha256(new TextEncoder().encode(pressRelease)),
      contentType: "text/html",
    });
    expect(storage.objects.has(rawSource.objectKey)).toBe(true);
    const chunks = await db.secFilingChunk.findMany({
      where: { filingId: reports.results.id },
      orderBy: { ordinal: "asc" },
    });
    expect(chunks).toHaveLength(result.chunkCount);
    for (const chunk of chunks) {
      expect(chunk.sectionKind).toBe("PRESS_RELEASE");
      expect(chunk.sectionLabel).toBe("Exhibit 99.1 Press Release");
      expect(chunk.rawSourceId).toBe(rawSource.id);
      expect(sha256(chunk.text)).toBe(chunk.sha256);
    }
    expect(chunks[0].text).toContain("Apple reports third quarter results");

    const rerun = await fetchReport(reports.results);
    expect(rerun.objectKey).toBe(result.objectKey);
    expect(rerun.rawSourceId).toBe(result.rawSourceId);
    await expect(
      db.secFilingChunk.count({ where: { filingId: reports.results.id } }),
    ).resolves.toBe(result.chunkCount);
    await expect(
      db.secFilingExtraction.count({ where: { filingId: reports.results.id } }),
    ).resolves.toBe(1);
  });

  it("records an explicit missing state when the index lists no press release or the 8-K is not a results filing", async () => {
    await expect(fetchReport(reports.withoutExhibit)).rejects.toMatchObject({
      code: "SEC_FILING_EXHIBIT_NOT_FOUND",
      retryable: false,
    });
    await expect(
      db.secFilingExtraction.findUniqueOrThrow({
        where: { filingId: reports.withoutExhibit.id },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      expectedSections: ["PRESS_RELEASE"],
      extractedSections: [],
      chunkCount: 0,
      rawSourceId: null,
      errorCode: "SEC_FILING_EXHIBIT_NOT_FOUND",
    });

    await expect(fetchReport(reports.vote)).rejects.toMatchObject({
      code: "SEC_FILING_EXHIBIT_NOT_EXPECTED",
      retryable: false,
    });
    await expect(
      db.secFilingExtraction.findUniqueOrThrow({
        where: { filingId: reports.vote.id },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      errorCode: "SEC_FILING_EXHIBIT_NOT_EXPECTED",
      rawSourceId: null,
    });
    expect(
      client.getFilingDocument.mock.calls.filter(
        (call) => call[1] === reports.vote.accessionNumber,
      ),
    ).toHaveLength(0);
  });

  it("queues one exhibit fetch per results 8-K in the window that is not current, and none for amendments, other items, or older filings", async () => {
    const result = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId: `${prefix}-correlation`,
      publisher,
      environment: secEnvironment,
      now,
    });

    expect(result.queued.map((job) => job.accessionNumber)).toEqual([
      reports.pending.accessionNumber,
    ]);
    expect(result.queued[0]).toMatchObject({ formType: "8-K", reused: false });
    expect(result.current).toEqual(
      expect.arrayContaining([
        {
          formType: "8-K",
          accessionNumber: reports.results.accessionNumber,
          status: "COMPLETED",
        },
        {
          formType: "8-K",
          accessionNumber: reports.withoutExhibit.accessionNumber,
          status: "FAILED",
        },
      ]),
    );
    expect(result.current).toHaveLength(2);
    const job = await db.backgroundJob.findUniqueOrThrow({
      where: { id: result.queued[0].jobId },
    });
    expect(job).toMatchObject({
      type: BackgroundJobType.SEC_FILING_FETCH,
      payloadJson: {
        ticker: apple.ticker,
        accessionNumber: reports.pending.accessionNumber,
        primaryDocument: reports.pending.primaryDocument,
      },
    });
    expect(job.idempotencyKey).toBe(
      `sec-filing:${reports.pending.id}:${SEC_FILING_SECTION_PARSER_VERSION}:2099-06-01T12:00:00.000Z`,
    );

    const again = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId: `${prefix}-correlation`,
      publisher,
      environment: secEnvironment,
      now,
    });
    expect(again.queued).toEqual([{ ...result.queued[0], reused: true }]);

    // With the flag off nothing about current reports is read or queued.
    const disabled = await queueSecFilingDocumentFetches({
      ticker: apple.ticker,
      correlationId: `${prefix}-correlation`,
      publisher,
      environment: {
        ...secEnvironment,
        SEC_CURRENT_REPORTS_ENABLED: "false",
      },
      now,
    });
    expect(disabled).toEqual({
      queued: [],
      current: [],
      skipped: "SEC filing text and current-report evidence are disabled.",
    });
  });

  it("threads dated current-report items and press-release passages into the research snapshot with an explicit coverage state", async () => {
    const repository = createPrismaResearchEvidenceRepository(db);
    const listed = await repository.listCurrentReports({
      secEntityId,
      filedOnOrAfter: new Date("2098-06-01T00:00:00.000Z"),
    });
    expect(listed.map((report) => report.accessionNumber)).toEqual([
      reports.pending.accessionNumber,
      reports.results.accessionNumber,
      reports.amendment.accessionNumber,
      reports.vote.accessionNumber,
      reports.withoutExhibit.accessionNumber,
    ]);
    expect(listed.find((report) => report.id === reports.results.id)).toMatchObject({
      itemCodes: ["2.02", "9.01"],
      extraction: { status: "COMPLETED", rawSource: { kind: "FILING_DOCUMENT" } },
    });

    const snapshot = await prepareResearchEvidenceSnapshot(
      { stockId: appleStockId, ticker: apple.ticker, companyName: apple.companyName },
      { repository, now },
    );
    const events = snapshot.evidence.filter(
      (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT",
    );
    expect(events.map((item) => item.accessionNumber)).toEqual([
      reports.pending.accessionNumber,
      reports.results.accessionNumber,
      reports.amendment.accessionNumber,
      reports.vote.accessionNumber,
    ]);
    for (const event of events) {
      expect(event.sourceDate).toMatch(/^2099-/);
      expect(event.sourceUrl).toContain(`${event.accessionNumber}-index.html`);
    }
    expect(
      snapshot.evidence.find(
        (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT_COVERAGE",
      )?.metadata,
    ).toMatchObject({ reportCount: 5, listedCount: 4, resultsFilingsExtracted: 1 });
    const passages = snapshot.evidence.filter(
      (item) => item.metadata.sectionKind === "PRESS_RELEASE",
    );
    expect(passages.length).toBeGreaterThan(0);
    const chunksByOrdinal = new Map(
      (
        await db.secFilingChunk.findMany({ where: { filingId: reports.results.id } })
      ).map((chunk) => [chunk.ordinal, chunk]),
    );
    for (const passage of passages) {
      expect(passage.secFilingId).toBe(reports.results.id);
      const chunk = chunksByOrdinal.get(passage.metadata.chunkOrdinal as number)!;
      expect(passage.excerpt).toBe(chunk.text);
      expect(passage.sha256).toBe(chunk.sha256);
      expect(passage.sourceUrl).toBe(
        buildSecFilingUrl(apple.cik, reports.results.accessionNumber, exhibitName),
      );
    }
    expect(
      snapshot.evidence.some((item) => item.secFilingId === reports.old.id),
    ).toBe(false);
  });
});

describe("M32 recent events in research", () => {
  it("runs the News specialist after the first stage, persists dated event claims, and shows them in What to Watch", async () => {
    const provider = recordedProvider([
      recordedOutputs.FINANCIALS,
      recordedOutputs.COMPETITORS,
      recordedOutputs.RISK,
      recordedOutputs.NEWS,
      recordedOutputs.SYNTHESIS,
    ]);
    const generate = vi.spyOn(provider, "generate");
    const config = getAiResearchConfig(environment);
    const queued = await runResearch(ids.user, ticker, {
      publisher,
      environment,
      prepareSnapshot: async () => snapshotWithEvents,
    });
    if (!queued || !("jobId" in queued)) {
      throw new Error("The external research job was not queued.");
    }
    const agentJobs = () =>
      db.backgroundJob.findMany({
        where: { researchJobId: queued.jobId, type: "RESEARCH_AGENT_RUN" },
        select: { agentName: true },
      });
    expect((await agentJobs()).map((job) => job.agentName).sort()).toEqual([
      AgentName.COMPETITORS,
      AgentName.FINANCIALS,
      AgentName.RISK,
    ]);
    await expect(
      db.agentRun.findMany({
        where: { researchJobId: queued.jobId },
        select: { agentName: true, status: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { agentName: AgentName.NEWS, status: AgentStatus.PENDING },
      ]),
    );

    for (const agentName of ["FINANCIALS", "COMPETITORS"] as const) {
      await executeResearchAgent(
        { researchJobId: queued.jobId, agentName, userId: ids.user, correlationId: queued.correlationId! },
        { provider, config, environment, publisher },
      );
    }
    expect((await agentJobs()).some((job) => job.agentName === AgentName.NEWS)).toBe(false);
    await executeResearchAgent(
      { researchJobId: queued.jobId, agentName: "RISK", userId: ids.user, correlationId: queued.correlationId! },
      { provider, config, environment, publisher },
    );
    // The third first-stage completion queues News; synthesis waits for it.
    expect((await agentJobs()).some((job) => job.agentName === AgentName.NEWS)).toBe(true);
    await expect(
      db.backgroundJob.count({
        where: { researchJobId: queued.jobId, type: "RESEARCH_SYNTHESIS" },
      }),
    ).resolves.toBe(0);

    await executeResearchAgent(
      { researchJobId: queued.jobId, agentName: "NEWS", userId: ids.user, correlationId: queued.correlationId! },
      { provider, config, environment, publisher },
    );
    expect(generate).toHaveBeenCalledTimes(4);
    const newsRequest = JSON.parse(String(generate.mock.calls[3][0].input)) as {
      task: string;
      researchQuestions: string[];
      evidence: { registry: Array<{ id: string }> };
    };
    expect(newsRequest.task).toBe("NEWS");
    expect(newsRequest.researchQuestions).toHaveLength(5);
    const eventIds = snapshotWithEvents.evidence
      .filter((item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT")
      .map((item) => item.id);
    for (const id of eventIds) {
      expect(newsRequest.evidence.registry.some((item) => item.id === id)).toBe(true);
    }
    expect(generate.mock.calls[3][0].maxOutputTokens).toBe(800);
    await expect(
      db.backgroundJob.count({
        where: { researchJobId: queued.jobId, type: "RESEARCH_SYNTHESIS" },
      }),
    ).resolves.toBe(1);
    await executeResearchSynthesis(
      { researchJobId: queued.jobId, userId: ids.user },
      { provider, config, environment },
    );
    expect(generate).toHaveBeenCalledTimes(6);

    const stored = await db.researchJob.findUniqueOrThrow({
      where: { id: queued.jobId },
      include: { agentRuns: true, report: { include: { claims: { include: { evidence: true } } } } },
    });
    expect(stored.status).toBe(ResearchStatus.COMPLETED);
    const news = stored.agentRuns.find((run) => run.agentName === AgentName.NEWS)!;
    expect(news).toMatchObject({
      status: AgentStatus.COMPLETED,
      availability: "PARTIAL",
      provider: "recorded",
    });
    expect(news.modelConfigJson).toEqual({ maxOutputTokens: 800 });
    const eventReference = stored.report!.claims
      .flatMap((claim) => claim.evidence)
      .find((reference) => reference.secFilingId === `${prefix}-filing-results`);
    expect(eventReference).toMatchObject({
      sourceKind: "SEC_FILING",
      accessionNumber: accessions.results,
      sourceDate: new Date("2026-07-30T00:00:00.000Z"),
    });

    const owned = await getOwnedResearchJob(ids.user, queued.jobId);
    expect(owned?.research?.report.recentEvents).toEqual([
      {
        filingDate: "2026-07-30",
        formType: "8-K",
        accessionNumber: accessions.results,
        statement: recordedOutputs.SYNTHESIS.claims.at(-1)!.statement,
      },
    ]);
    expect(
      owned?.research?.report.evidenceCoverage?.newestFilingDate,
    ).toBe(AAPL_FIXTURE_FILING_DOCUMENTS["10-Q"].filingDate);
  });

  it("reports the News specialist NOT_AVAILABLE without a model call when no current report is stored", async () => {
    const provider = recordedProvider([]);
    const generate = vi.spyOn(provider, "generate");
    const config = getAiResearchConfig(environment);
    const queued = await runResearch(ids.quietUser, ticker, {
      publisher,
      environment,
      prepareSnapshot: async () => snapshotWithoutEvents,
    });
    if (!queued || !("jobId" in queued)) {
      throw new Error("The external research job was not queued.");
    }

    const result = await executeResearchAgent(
      { researchJobId: queued.jobId, agentName: "NEWS", userId: ids.quietUser, correlationId: queued.correlationId! },
      { provider, config, environment, publisher },
    );
    expect(result.researchJobId).toBe(queued.jobId);
    expect(generate).not.toHaveBeenCalled();
    await expect(
      db.agentRun.findUniqueOrThrow({
        where: {
          researchJobId_agentName: { researchJobId: queued.jobId, agentName: AgentName.NEWS },
        },
      }),
    ).resolves.toMatchObject({
      status: AgentStatus.COMPLETED,
      availability: "NOT_AVAILABLE",
      provider: "bounded-missing-data",
      rating: "NEUTRAL",
      claimsJson: [],
      summary: expect.stringContaining("No Form 8-K current report"),
    });
    await expect(
      db.aiUsage.count({ where: { researchJobId: queued.jobId } }),
    ).resolves.toBe(0);
    await expect(
      executeResearchAgent(
        { researchJobId: queued.jobId, agentName: "NEWS", userId: ids.user, correlationId: queued.correlationId! },
        { provider, config, environment, publisher },
      ),
    ).rejects.toBeInstanceOf(JobExecutionError);
  });
});
