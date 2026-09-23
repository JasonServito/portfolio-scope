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
  currentReportWindowStart,
  findExhibitDocument,
  PRESS_RELEASE_EXHIBIT_TYPE,
  RESULTS_ITEM_CODE,
} from "@/lib/sec/current-reports";
import {
  decodeFilingDocument,
  expectedFilingSectionKinds,
  extractFilingSections,
  FILING_TEXT_FORM_TYPES,
  SEC_FILING_SECTION_PARSER_VERSION,
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
// Item 2.02 results filings in a twelve-month window; a company files about
// four, and the bound keeps one refresh from queueing an unusual backlog.
const MAX_CURRENT_REPORT_FETCHES = 12;

type FetchCandidate = {
  id: string;
  accessionNumber: string;
  formType: string;
  primaryDocument: string | null;
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
 * is set (M31), and every Item 2.02 results 8-K filed in the last twelve
 * months when `SEC_CURRENT_REPORTS_ENABLED` is set (M32). "Not current" means
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
    // Every results filing in the window is fetched, newest first; an
    // amendment is kept as metadata only and never fetched.
    candidates.push(
      ...(await db.secFiling.findMany({
        where: {
          secEntity: { cik: supported.cik },
          formType: CURRENT_REPORT_FORM_TYPE,
          isAmendment: false,
          itemCodes: { has: RESULTS_ITEM_CODE },
          filingDate: { gte: currentReportWindowStart(now) },
          primaryDocument: { not: null },
        },
        orderBy: [{ filingDate: "desc" }, { accessionNumber: "desc" }],
        take: MAX_CURRENT_REPORT_FETCHES,
        select,
      })),
    );
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
  rawSourceId: string | null;
  errorCode: string;
  errorMessage: string;
  attemptedAt: Date;
}) {
  const state = {
    rawSourceId: input.rawSourceId,
    status: "FAILED" as const,
    parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    expectedSections: expectedFilingSectionKinds(input.formType),
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
 * Fetches one filing's document through the identified SEC client, stores it
 * content-addressed in private R2 as a `FILING_DOCUMENT` raw source, extracts
 * the expected sections, and replaces the filing's passages in PostgreSQL.
 * For a 10-K or 10-Q the document is the primary document in the payload;
 * for an Item 2.02 8-K it is the Exhibit 99.1 press release named on the
 * filing's index page, which is read first (M32). A failure after the filing
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
        rawSourceId,
        errorCode: error.code,
        errorMessage: error.message,
        attemptedAt,
      });
    }
    throw error;
  };

  let documentName = input.primaryDocument;
  if (filing.formType === CURRENT_REPORT_FORM_TYPE) {
    if (filing.isAmendment || !filing.itemCodes.includes(RESULTS_ITEM_CODE)) {
      return fail(
        null,
        new JobExecutionError(
          "SEC_FILING_EXHIBIT_NOT_EXPECTED",
          false,
          "Only an Item 2.02 results 8-K carries a press-release exhibit to extract.",
        ),
      );
    }
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
    const exhibit = findExhibitDocument(
      decodeFilingDocument(index.body, index.contentType),
      PRESS_RELEASE_EXHIBIT_TYPE,
    );
    if (!exhibit) {
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
    documentName = exhibit;
  }

  let document: Awaited<ReturnType<SecEdgarClient["getFilingDocument"]>>;
  try {
    document = await client.getFilingDocument(
      supported.cik,
      input.accessionNumber,
      documentName,
    );
  } catch (error) {
    return fail(null, fetchFailure(error));
  }

  const digest = createHash("sha256").update(document.body).digest("hex");
  const objectKey = `sec/${supported.cik}/filings/${digest}.${documentExtension(
    documentName,
    document.contentType,
  )}`;
  let stored: Awaited<ReturnType<ObjectStorage["put"]>>;
  try {
    stored = await storage.put({
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
    objectKey: stored.key,
    sha256: digest,
    contentType: stored.contentType,
    byteLength: stored.byteLength,
    retrievedAt: attemptedAt,
  });

  let extraction: ReturnType<typeof extractFilingSections>;
  try {
    extraction = extractFilingSections(
      decodeFilingDocument(document.body, document.contentType),
      filing.formType,
    );
  } catch (error) {
    return fail(
      rawSource.id,
      new JobExecutionError(
        "SEC_FILING_EXTRACTION_FAILED",
        false,
        "The SEC filing document could not be parsed into sections.",
        true,
        { cause: error },
      ),
    );
  }

  const status: SecFilingExtractionStatus =
    extraction.sections.length === 0
      ? "FAILED"
      : extraction.missingSections.length > 0
        ? "PARTIALLY_COMPLETED"
        : "COMPLETED";
  const chunks = extraction.sections.flatMap((section) =>
    section.chunks.map((chunk) => ({
      filingId: filing.id,
      rawSourceId: rawSource.id,
      sectionKind: section.kind,
      sectionLabel: section.label,
      ordinal: chunk.ordinal,
      passageStart: chunk.passageStart,
      passageEnd: chunk.passageEnd,
      sha256: chunk.sha256,
      text: chunk.text,
    })),
  );
  const extractedSections = extraction.sections.map((section) => section.kind);
  const state = {
    rawSourceId: rawSource.id,
    status,
    parserVersion: extraction.parserVersion,
    expectedSections: extraction.expectedSections,
    extractedSections,
    truncatedSections: extraction.truncatedSections,
    chunkCount: chunks.length,
    errorCode: status === "FAILED" ? "SEC_FILING_SECTIONS_NOT_FOUND" : null,
    errorMessage:
      status === "FAILED"
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
      "SEC_FILING_SECTIONS_NOT_FOUND",
      false,
      "No expected section heading was found in the SEC filing document.",
      true,
    );
  }
  return {
    filingId: filing.id,
    formType: filing.formType,
    document: documentName,
    rawSourceId: rawSource.id,
    objectKey: stored.key,
    sha256: digest,
    extractionStatus: status,
    parserVersion: extraction.parserVersion,
    extractedSections,
    missingSections: extraction.missingSections,
    truncatedSections: extraction.truncatedSections,
    chunkCount: chunks.length,
  };
}
