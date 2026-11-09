import { createHash, randomUUID } from "node:crypto";

import {
  BackgroundJobType,
  type SecFilingExtractionStatus,
} from "@prisma/client";

import { cachePolicies, ephemeralStore } from "@/lib/cache/redis";
import { db } from "@/lib/db";
import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import { JobExecutionError, JobRequestError, JobErrorCode } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import { logger } from "@/lib/observability/logger";
import {
  SecClientError,
  SecEdgarClient,
  getSecEdgarClient,
} from "@/lib/sec/client";
import { getSupportedCompany } from "@/lib/sec/company-registry";
import {
  CURRENT_REPORT_FORM_TYPE,
  currentReportReadsExhibit,
  currentReportTextItemCodes,
  currentReportWindowStart,
  findExhibitDocument,
  PRESS_RELEASE_EXHIBIT_TYPE,
  RESULTS_ITEM_CODE,
} from "@/lib/sec/current-reports";
import {
  decodeFilingDocument,
  expectedFilingSectionKinds,
  extractCurrentReportItems,
  extractFilingSections,
  FILING_TEXT_FORM_TYPES,
  SEC_FILING_SECTION_PARSER_VERSION,
  type FilingSectionExtraction,
  type FilingSectionKind,
} from "@/lib/sec/filing-sections";
import {
  SecIngestionError,
  ingestSupportedCompany,
} from "@/lib/sec/ingestion";
import { normalizeCompanyFacts } from "@/lib/sec/normalization";
import { prismaSecRepository } from "@/lib/sec/repository";
import { secCompanyFactsSchema } from "@/lib/sec/schemas";
import {
  R2ObjectStorage,
  type ObjectStorage,
} from "@/lib/storage/object-storage";

// A document whose expected headings the current parser cannot find fails
// the same way on every attempt, so it waits for a parser update or an
// administrator retry instead of being fetched again on every refresh.
const DETERMINISTIC_EXTRACTION_ERROR_CODES = new Set([
  "SEC_FILING_SECTIONS_NOT_FOUND",
  "SEC_FILING_EXTRACTION_FAILED",
  "SEC_FILING_EXHIBIT_NOT_FOUND",
  "SEC_FILING_EXHIBIT_NOT_EXPECTED",
]);
// Per query of the twelve-month window: the newest 8-Ks of any item, and
// every Item 2.02 results filing (about four a year). Research lists only
// the newest four reports plus the newest results filing, so the bound keeps
// one refresh from queueing an unusual backlog.
const MAX_CURRENT_REPORT_FETCHES = 12;

type FetchCandidate = {
  id: string;
  accessionNumber: string;
  formType: string;
  primaryDocument: string | null;
  itemCodes: string[];
  extraction: {
    status: SecFilingExtractionStatus;
    parserVersion: string;
    errorCode: string | null;
  } | null;
};

function sixHourBucket(date: Date) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / 6) * 6);
  return bucket.toISOString();
}

export async function queueSecIngestion(
  ticker: string,
  input: {
    requestedByUserId?: string | null;
    correlationId?: string;
    publisher?: JobPublisher;
    environment?: NodeJS.ProcessEnv;
    now?: () => Date;
  } = {},
) {
  const environment = input.environment ?? process.env;
  if (!isBackgroundFeatureEnabled("SEC_INGESTION_ENABLED", environment)) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "SEC ingestion is disabled.",
    );
  }
  const supported = getSupportedCompany(ticker);
  if (!supported) {
    throw new SecIngestionError(
      "SEC_UNSUPPORTED_TICKER",
      400,
      "Ticker is not in the supported SEC universe.",
    );
  }

  const identity = await prismaSecRepository.ensureIdentity(supported);
  const now = input.now?.() ?? new Date();
  return enqueueBackgroundJob(
    {
      type: BackgroundJobType.SEC_SUBMISSIONS_SYNC,
      idempotencyKey: `sec:${identity.companyId}:${sixHourBucket(now)}`,
      correlationId: input.correlationId ?? randomUUID(),
      payload: { ticker: supported.ticker },
      userId: input.requestedByUserId ?? null,
      companyId: identity.companyId,
    },
    { publisher: input.publisher, environment },
  );
}

/**
 * Queues one `SEC_FILING_FETCH` job for each filing whose passages are not
 * current: the latest 10-K and the latest 10-Q when `SEC_FILING_TEXT_ENABLED`
 * is set (M31), and, when `SEC_CURRENT_REPORTS_ENABLED` is set (M32), the
 * twelve newest 8-Ks of the last twelve months plus every Item 2.02 results
 * 8-K of that window, skipping any whose items carry neither text nor an
 * exhibit to read (an Item 9.01-only filing). "Not current" means
 * no extraction with the current parser version, or a failed one whose error
 * was transient (fetch or storage). Jobs are keyed per filing, parser
 * version, and six-hour bucket, so a refresh that finds every filing current
 * queues nothing, a new filing queues one fetch, and a filing left failed by
 * a transient outage is queued again by a later refresh rather than waiting
 * for an administrator. Both capabilities stay off until their flag is set.
 */
export async function queueSecFilingDocumentFetches(input: {
  ticker: string;
  correlationId: string;
  publisher?: JobPublisher;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}) {
  const environment = input.environment ?? process.env;
  const filingText = isBackgroundFeatureEnabled(
    "SEC_FILING_TEXT_ENABLED",
    environment,
  );
  const currentReports = isBackgroundFeatureEnabled(
    "SEC_CURRENT_REPORTS_ENABLED",
    environment,
  );
  if (!filingText && !currentReports) {
    return {
      queued: [],
      current: [],
      skipped: "SEC filing text and current-report evidence are disabled.",
    };
  }
  const supported = getSupportedCompany(input.ticker);
  if (!supported) {
    throw new SecIngestionError(
      "SEC_UNSUPPORTED_TICKER",
      400,
      "Ticker is not in the supported SEC universe.",
    );
  }

  const now = input.now?.() ?? new Date();
  const select = {
    id: true,
    accessionNumber: true,
    formType: true,
    primaryDocument: true,
    itemCodes: true,
    extraction: {
      select: { status: true, parserVersion: true, errorCode: true },
    },
  } as const;
  const candidates: FetchCandidate[] = [];
  if (filingText) {
    const filings = await db.secFiling.findMany({
      where: {
        secEntity: { cik: supported.cik },
        formType: { in: [...FILING_TEXT_FORM_TYPES] },
        primaryDocument: { not: null },
      },
      orderBy: [{ filingDate: "desc" }, { accessionNumber: "desc" }],
      take: 24,
      select,
    });
    const latestByForm = new Map<string, FetchCandidate>();
    for (const filing of filings) {
      if (!latestByForm.has(filing.formType)) latestByForm.set(filing.formType, filing);
    }
    for (const formType of FILING_TEXT_FORM_TYPES) {
      const filing = latestByForm.get(formType);
      if (filing) candidates.push(filing);
    }
  }
  if (currentReports) {
    // The newest reports of any item and every results filing in the window,
    // newest first; an amendment is kept as metadata only and never fetched.
    const window = {
      secEntity: { cik: supported.cik },
      formType: CURRENT_REPORT_FORM_TYPE,
      isAmendment: false,
      filingDate: { gte: currentReportWindowStart(now) },
      primaryDocument: { not: null },
    };
    const query = (where: typeof window & { itemCodes?: { has: string } }) =>
      db.secFiling.findMany({
        where,
        orderBy: [{ filingDate: "desc" }, { accessionNumber: "desc" }],
        take: MAX_CURRENT_REPORT_FETCHES,
        select,
      });
    const [newest, results] = await Promise.all([
      query(window),
      query({ ...window, itemCodes: { has: RESULTS_ITEM_CODE } }),
    ]);
    const seen = new Set<string>();
    for (const filing of [...newest, ...results]) {
      if (seen.has(filing.id)) continue;
      seen.add(filing.id);
      if (
        currentReportTextItemCodes(filing.itemCodes).length > 0 ||
        currentReportReadsExhibit(filing.itemCodes)
      ) {
        candidates.push(filing);
      }
    }
  }
  const bucket = sixHourBucket(now);

  const queued: Array<{
    jobId: string;
    formType: string;
    accessionNumber: string;
    reused: boolean;
  }> = [];
  const current: Array<{
    formType: string;
    accessionNumber: string;
    status: SecFilingExtractionStatus;
  }> = [];
  for (const filing of candidates) {
    if (!filing.primaryDocument) continue;
    const { formType } = filing;
    const extraction = filing.extraction;
    if (
      extraction?.parserVersion === SEC_FILING_SECTION_PARSER_VERSION &&
      (extraction.status !== "FAILED" ||
        DETERMINISTIC_EXTRACTION_ERROR_CODES.has(extraction.errorCode ?? ""))
    ) {
      current.push({
        formType,
        accessionNumber: filing.accessionNumber,
        status: extraction.status,
      });
      continue;
    }
    // No company binding: the active-scope reuse in the job repository is per
    // company and type, and the 10-K and 10-Q fetches must both be queued.
    const job = await enqueueBackgroundJob(
      {
        type: BackgroundJobType.SEC_FILING_FETCH,
        idempotencyKey: `sec-filing:${filing.id}:${SEC_FILING_SECTION_PARSER_VERSION}:${bucket}`,
        correlationId: input.correlationId,
        payload: {
          ticker: supported.ticker,
          accessionNumber: filing.accessionNumber,
          primaryDocument: filing.primaryDocument,
        },
      },
      { publisher: input.publisher, environment },
    );
    queued.push({
      jobId: job.jobId,
      formType,
      accessionNumber: filing.accessionNumber,
      reused: job.reused,
    });
  }
  return { queued, current };
}

export async function executeSecIngestionJob(
  input: {
    ticker: string;
    requestedByUserId: string | null;
    companyId: string;
    correlationId: string;
    timeoutMs: number;
  },
  dependencies: {
    publisher?: JobPublisher;
    environment?: NodeJS.ProcessEnv;
    now?: () => Date;
  } = {},
) {
  const lock = await ephemeralStore.acquireLock(
    "sec-company",
    input.companyId,
    Math.ceil(input.timeoutMs / 1000) + 30,
  );
  if (!lock.acquired && !lock.unavailable) {
    throw new JobExecutionError(
      JobErrorCode.LOCKED,
      true,
      "Another SEC refresh currently holds the company lock.",
    );
  }

  try {
    const result = await ingestSupportedCompany(
      input.ticker,
      {
        trigger: "JOB",
        requestedByUserId: input.requestedByUserId,
        correlationId: input.correlationId,
      },
      { environment: dependencies.environment },
    );
    await Promise.all([
      ephemeralStore.invalidate("fundamentals", input.ticker),
      ephemeralStore.setJson(
        "freshness",
        input.ticker,
        { refreshedAt: new Date().toISOString(), status: "COMPLETED" },
        cachePolicies.dataFreshness.ttlSeconds,
      ),
    ]);
    // Filing-document fetches are follow-up work: a queueing failure is
    // recorded on the completed ingestion result rather than failing the
    // fact refresh that already succeeded.
    const filingDocuments = await queueSecFilingDocumentFetches({
      ticker: input.ticker,
      correlationId: input.correlationId,
      publisher: dependencies.publisher,
      environment: dependencies.environment,
      now: dependencies.now,
    }).catch((error: unknown) => {
      logger.warn(
        "sec.filing-text.queue-failed",
        {
          correlationId: input.correlationId,
          ticker: input.ticker,
          errorCode:
            error instanceof JobRequestError || error instanceof JobExecutionError
              ? error.code
              : undefined,
        },
        error,
      );
      return {
        queued: [],
        current: [],
        error: "SEC filing document fetches could not be queued.",
      };
    });
    return { ...result, filingDocuments };
  } catch (error) {
    if (error instanceof SecIngestionError) {
      throw new JobExecutionError(
        error.code,
        error.retryable,
        error.message,
        error.partiallyCompleted,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (lock.acquired) {
      await ephemeralStore.releaseLock("sec-company", input.companyId, lock.token);
    }
  }
}

export async function renormalizeStoredCompanyFacts(
  input: { ticker: string; rawSourceId: string },
  dependencies: { storage?: ObjectStorage } = {},
) {
  const supported = getSupportedCompany(input.ticker);
  if (!supported) {
    throw new JobExecutionError(
      "SEC_UNSUPPORTED_TICKER",
      false,
      "Ticker is not in the supported SEC universe.",
    );
  }
  const rawSource = await db.secRawSource.findFirst({
    where: {
      id: input.rawSourceId,
      kind: "COMPANY_FACTS",
      secEntity: { company: { securities: { some: { ticker: supported.ticker } } } },
    },
    include: { secEntity: { select: { id: true } } },
  });
  if (!rawSource) {
    throw new JobExecutionError(
      "SEC_RAW_SOURCE_NOT_FOUND",
      false,
      "The requested SEC raw source was not found.",
    );
  }

  const storage = dependencies.storage ?? new R2ObjectStorage();
  const body = await storage.get(rawSource.objectKey);
  if (!body) {
    throw new JobExecutionError(
      "SEC_RAW_SOURCE_MISSING",
      true,
      "The SEC raw source is temporarily unavailable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    throw new JobExecutionError(
      "SEC_INVALID_RESPONSE",
      false,
      "The stored SEC source is not valid JSON.",
      false,
      { cause: error },
    );
  }
  const companyFacts = secCompanyFactsSchema.parse(parsed);
  const filings = await db.secFiling.findMany({
    where: { secEntityId: rawSource.secEntity.id },
    select: { id: true, accessionNumber: true },
  });
  const facts = normalizeCompanyFacts(companyFacts, {
    cik: supported.cik,
    observedAt: rawSource.lastRetrievedAt,
  });
  const counts = await prismaSecRepository.saveFacts({
    secEntityId: rawSource.secEntity.id,
    rawSourceId: rawSource.id,
    facts,
    filingIds: new Map(filings.map((filing) => [filing.accessionNumber, filing.id])),
  });
  return { rawSourceId: rawSource.id, ...counts };
}

function documentExtension(primaryDocument: string, contentType: string) {
  const declared = /\.(htm|html|txt|xml)$/i.exec(primaryDocument)?.[1];
  if (declared) return declared.toLowerCase();
  return contentType === "text/plain" ? "txt" : "htm";
}

async function recordFilingExtractionFailure(input: {
  filingId: string;
  formType: string;
  itemCodes: readonly string[];
  rawSourceId: string | null;
  errorCode: string;
  errorMessage: string;
  attemptedAt: Date;
}) {
  const state = {
    rawSourceId: input.rawSourceId,
    status: "FAILED" as const,
    parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    expectedSections: expectedFilingSectionKinds(input.formType, input.itemCodes),
    extractedSections: [],
    truncatedSections: [],
    chunkCount: 0,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage.slice(0, 500),
    attemptedAt: input.attemptedAt,
  };
  await db.$transaction([
    db.secFilingChunk.deleteMany({ where: { filingId: input.filingId } }),
    db.secFilingExtraction.upsert({
      where: { filingId: input.filingId },
      update: state,
      create: { filingId: input.filingId, ...state },
    }),
  ]);
}

function fetchFailure(error: unknown) {
  return error instanceof SecClientError
    ? new JobExecutionError(error.code, error.retryable, error.message, false, {
        cause: error,
      })
    : new JobExecutionError(
        "SEC_FILING_FETCH_FAILED",
        true,
        "The SEC filing document could not be retrieved.",
        false,
        { cause: error },
      );
}

/**
 * Fetches one filing's documents through the identified SEC client, stores
 * each content-addressed in private R2 as a `FILING_DOCUMENT` raw source,
 * extracts the expected sections, and replaces the filing's passages in
 * PostgreSQL. For a 10-K or 10-Q the document is the primary document in the
 * payload. For an 8-K it is the primary document when the filing lists items
 * with text (their CURRENT_REPORT_ITEM passages), and the Exhibit 99.1 named
 * on the filing's index page, read first, when it lists Item 2.02, 7.01, or
 * 8.01 (PRESS_RELEASE passages); each passage keeps the raw source of the
 * document it came from. Only a results filing must carry the exhibit, so
 * its absence elsewhere is not a missing state. A failure after the filing
 * lookup is recorded on the filing's extraction state before it is rethrown,
 * so the state is explicit and never blocks fact ingestion or page
 * rendering. One exception keeps evidence available: when no new document
 * was obtained (fetch or storage failure) and an earlier extraction still
 * holds passages, that extraction is left as it is, the job row records the
 * failure, and a later refresh queues the fetch again because the earlier
 * extraction is not current.
 */
export async function fetchSecFilingDocument(
  input: {
    ticker: string;
    accessionNumber: string;
    primaryDocument: string;
  },
  dependencies: {
    client?: Pick<SecEdgarClient, "getFilingDocument">;
    storage?: ObjectStorage;
    now?: () => Date;
  } = {},
) {
  const supported = getSupportedCompany(input.ticker);
  if (!supported) {
    throw new JobExecutionError(
      "SEC_UNSUPPORTED_TICKER",
      false,
      "Ticker is not in the supported SEC universe.",
    );
  }
  const filing = await db.secFiling.findFirst({
    where: {
      accessionNumber: input.accessionNumber,
      primaryDocument: input.primaryDocument,
      secEntity: { cik: supported.cik },
    },
    select: {
      id: true,
      secEntityId: true,
      formType: true,
      isAmendment: true,
      itemCodes: true,
    },
  });
  if (!filing) {
    throw new JobExecutionError(
      "SEC_FILING_NOT_FOUND",
      false,
      "The selected SEC filing document was not found.",
    );
  }

  const attemptedAt = (dependencies.now ?? (() => new Date()))();
  const client = dependencies.client ?? getSecEdgarClient();
  const storage = dependencies.storage ?? new R2ObjectStorage();
  const fail = async (
    rawSourceId: string | null,
    error: JobExecutionError,
  ): Promise<never> => {
    const preserveEarlierPassages =
      rawSourceId === null &&
      ((
        await db.secFilingExtraction.findUnique({
          where: { filingId: filing.id },
          select: { chunkCount: true },
        })
      )?.chunkCount ?? 0) > 0;
    if (!preserveEarlierPassages) {
      await recordFilingExtractionFailure({
        filingId: filing.id,
        formType: filing.formType,
        itemCodes: filing.itemCodes,
        rawSourceId,
        errorCode: error.code,
        errorMessage: error.message,
        attemptedAt,
      });
    }
    throw error;
  };

  type PlannedDocument = {
    name: string;
    extract: (html: string) => FilingSectionExtraction;
  };
  const documents: PlannedDocument[] = [];
  let expectedSections: FilingSectionKind[] | null = null;
  let exhibitNotFound = false;
  if (filing.formType === CURRENT_REPORT_FORM_TYPE) {
    const textItems = currentReportTextItemCodes(filing.itemCodes);
    const readsExhibit = currentReportReadsExhibit(filing.itemCodes);
    if (filing.isAmendment || (textItems.length === 0 && !readsExhibit)) {
      return fail(
        null,
        new JobExecutionError(
          "SEC_FILING_EXHIBIT_NOT_EXPECTED",
          false,
          "This 8-K lists no item with text or an exhibit to extract.",
        ),
      );
    }
    expectedSections = expectedFilingSectionKinds(filing.formType, filing.itemCodes);
    let exhibit: string | null = null;
    if (readsExhibit) {
      let index: Awaited<ReturnType<SecEdgarClient["getFilingDocument"]>>;
      try {
        index = await client.getFilingDocument(
          supported.cik,
          input.accessionNumber,
          `${input.accessionNumber}-index.html`,
        );
      } catch (error) {
        return fail(null, fetchFailure(error));
      }
      exhibit = findExhibitDocument(
        decodeFilingDocument(index.body, index.contentType),
        PRESS_RELEASE_EXHIBIT_TYPE,
      );
      exhibitNotFound = !exhibit && filing.itemCodes.includes(RESULTS_ITEM_CODE);
      if (exhibitNotFound && textItems.length === 0) {
        return fail(
          null,
          new JobExecutionError(
            "SEC_FILING_EXHIBIT_NOT_FOUND",
            false,
            "The 8-K filing index lists no Exhibit 99.1 press release.",
            true,
          ),
        );
      }
    }
    if (textItems.length > 0) {
      documents.push({
        name: input.primaryDocument,
        extract: (html) => extractCurrentReportItems(html, filing.itemCodes),
      });
    }
    if (exhibit) {
      documents.push({
        name: exhibit,
        extract: (html) => extractFilingSections(html, CURRENT_REPORT_FORM_TYPE),
      });
    }
  } else {
    documents.push({
      name: input.primaryDocument,
      extract: (html) => extractFilingSections(html, filing.formType),
    });
  }

  const fetched: Array<
    PlannedDocument & {
      document: Awaited<ReturnType<SecEdgarClient["getFilingDocument"]>>;
    }
  > = [];
  for (const planned of documents) {
    try {
      fetched.push({
        ...planned,
        document: await client.getFilingDocument(
          supported.cik,
          input.accessionNumber,
          planned.name,
        ),
      });
    } catch (error) {
      return fail(null, fetchFailure(error));
    }
  }

  const stored: Array<{
    name: string;
    digest: string;
    key: string;
    rawSourceId: string;
    html: string;
    extract: PlannedDocument["extract"];
  }> = [];
  for (const { name, document, extract } of fetched) {
    const digest = createHash("sha256").update(document.body).digest("hex");
    const objectKey = `sec/${supported.cik}/filings/${digest}.${documentExtension(
      name,
      document.contentType,
    )}`;
    let object: Awaited<ReturnType<ObjectStorage["put"]>>;
    try {
      object = await storage.put({
        key: objectKey,
        body: document.body,
        contentType: document.contentType,
        metadata: {
          cik: supported.cik,
          source: "sec-edgar",
          sha256: digest,
          accessionNumber: input.accessionNumber,
        },
      });
    } catch (error) {
      return fail(
        null,
        new JobExecutionError(
          "SEC_STORAGE_ERROR",
          true,
          "Raw SEC filing document storage failed.",
          false,
          { cause: error },
        ),
      );
    }
    const rawSource = await prismaSecRepository.saveRawSource({
      secEntityId: filing.secEntityId,
      kind: "FILING_DOCUMENT",
      sourceUrl: document.url,
      objectKey: object.key,
      sha256: digest,
      contentType: object.contentType,
      byteLength: object.byteLength,
      retrievedAt: attemptedAt,
    });
    stored.push({
      name,
      digest,
      key: object.key,
      rawSourceId: rawSource.id,
      html: decodeFilingDocument(document.body, document.contentType),
      extract,
    });
  }

  const extractions: Array<{
    rawSourceId: string;
    extraction: FilingSectionExtraction;
  }> = [];
  for (const item of stored) {
    try {
      extractions.push({ rawSourceId: item.rawSourceId, extraction: item.extract(item.html) });
    } catch (error) {
      return fail(
        item.rawSourceId,
        new JobExecutionError(
          "SEC_FILING_EXTRACTION_FAILED",
          false,
          "The SEC filing document could not be parsed into sections.",
          true,
          { cause: error },
        ),
      );
    }
  }
  const sections = extractions.flatMap(({ rawSourceId, extraction }) =>
    extraction.sections.map((section) => ({ ...section, rawSourceId })),
  );
  const extractedSections = [...new Set(sections.map((section) => section.kind))];
  const expected = expectedSections ?? extractions[0].extraction.expectedSections;
  const extraction = {
    parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    expectedSections: expected,
    missingSections: expected.filter((kind) => !extractedSections.includes(kind)),
    truncatedSections: [
      ...new Set(extractions.flatMap((item) => item.extraction.truncatedSections)),
    ],
  };
  const primary = stored[0];

  const status: SecFilingExtractionStatus =
    sections.length === 0
      ? "FAILED"
      : extraction.missingSections.length > 0
        ? "PARTIALLY_COMPLETED"
        : "COMPLETED";
  const chunks = sections.flatMap((section) =>
    section.chunks.map((chunk) => ({
      filingId: filing.id,
      rawSourceId: section.rawSourceId,
      sectionKind: section.kind,
      sectionLabel: section.label,
      ordinal: chunk.ordinal,
      passageStart: chunk.passageStart,
      passageEnd: chunk.passageEnd,
      sha256: chunk.sha256,
      text: chunk.text,
    })),
  );
  // A results 8-K whose index lists no exhibit keeps that explicit code even
  // when its other items' text was extracted.
  const errorCode = exhibitNotFound
    ? "SEC_FILING_EXHIBIT_NOT_FOUND"
    : status === "FAILED"
      ? "SEC_FILING_SECTIONS_NOT_FOUND"
      : null;
  const state = {
    rawSourceId: primary.rawSourceId,
    status,
    parserVersion: extraction.parserVersion,
    expectedSections: extraction.expectedSections,
    extractedSections,
    truncatedSections: extraction.truncatedSections,
    chunkCount: chunks.length,
    errorCode,
    errorMessage: exhibitNotFound
      ? "The 8-K filing index lists no Exhibit 99.1 press release."
      : status === "FAILED"
        ? "No expected section heading was found in the filing document."
        : null,
    attemptedAt,
  };
  await db.$transaction(async (transaction) => {
    const record = await transaction.secFilingExtraction.upsert({
      where: { filingId: filing.id },
      update: state,
      create: { filingId: filing.id, ...state },
      select: { id: true },
    });
    await transaction.secFilingChunk.deleteMany({
      where: { filingId: filing.id },
    });
    if (chunks.length > 0) {
      await transaction.secFilingChunk.createMany({
        data: chunks.map((chunk) => ({ ...chunk, extractionId: record.id })),
      });
    }
  });
  if (status === "FAILED") {
    throw new JobExecutionError(
      errorCode ?? "SEC_FILING_SECTIONS_NOT_FOUND",
      false,
      "No expected section heading was found in the SEC filing document.",
      true,
    );
  }
  return {
    filingId: filing.id,
    formType: filing.formType,
    document: primary.name,
    documents: stored.map((item) => item.name),
    rawSourceId: primary.rawSourceId,
    objectKey: primary.key,
    sha256: primary.digest,
    extractionStatus: status,
    parserVersion: extraction.parserVersion,
    extractedSections,
    missingSections: extraction.missingSections,
    truncatedSections: extraction.truncatedSections,
    chunkCount: chunks.length,
  };
}
