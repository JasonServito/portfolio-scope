import { createHash, randomUUID } from "node:crypto";

import { BackgroundJobType } from "@prisma/client";

import { cachePolicies, ephemeralStore } from "@/lib/cache/redis";
import { db } from "@/lib/db";
import { isBackgroundFeatureEnabled } from "@/lib/jobs/config";
import { JobExecutionError, JobRequestError, JobErrorCode } from "@/lib/jobs/errors";
import type { JobPublisher } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import {
  SecEdgarClient,
  buildSecFilingUrl,
  getSecEdgarClient,
} from "@/lib/sec/client";
import { getSupportedCompany } from "@/lib/sec/company-registry";
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

export async function executeSecIngestionJob(input: {
  ticker: string;
  requestedByUserId: string | null;
  companyId: string;
  correlationId: string;
  timeoutMs: number;
}) {
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
    const result = await ingestSupportedCompany(input.ticker, {
      trigger: "JOB",
      requestedByUserId: input.requestedByUserId,
      correlationId: input.correlationId,
    });
    await Promise.all([
      ephemeralStore.invalidate("fundamentals", input.ticker),
      ephemeralStore.setJson(
        "freshness",
        input.ticker,
        { refreshedAt: new Date().toISOString(), status: "COMPLETED" },
        cachePolicies.dataFreshness.ttlSeconds,
      ),
    ]);
    return result;
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

export async function fetchSecFilingDocument(
  input: {
    ticker: string;
    accessionNumber: string;
    primaryDocument: string;
  },
  dependencies: {
    client?: Pick<SecEdgarClient, "getFilingDocument">;
    storage?: ObjectStorage;
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
      secEntity: { company: { securities: { some: { ticker: supported.ticker } } } },
    },
    select: { secEntityId: true },
  });
  if (!filing) {
    throw new JobExecutionError(
      "SEC_FILING_NOT_FOUND",
      false,
      "The selected SEC filing document was not found.",
    );
  }

  const client = dependencies.client ?? getSecEdgarClient();
  const storage = dependencies.storage ?? new R2ObjectStorage();
  const document = await client.getFilingDocument(
    supported.cik,
    input.accessionNumber,
    input.primaryDocument,
  );
  const digest = createHash("sha256").update(document.body).digest("hex");
  const objectKey = `sec/${supported.cik}/filings/${input.accessionNumber}/${input.primaryDocument}`;
  const stored = await storage.put({
    key: objectKey,
    body: document.body,
    contentType: document.contentType,
    metadata: { sha256: digest, source: "sec-edgar" },
  });
  const retrievedAt = new Date();
  const rawSource = await db.secRawSource.upsert({
    where: { objectKey },
    update: { lastRetrievedAt: retrievedAt, sha256: digest },
    create: {
      secEntityId: filing.secEntityId,
      kind: "FILING_DOCUMENT",
      sourceUrl: buildSecFilingUrl(
        supported.cik,
        input.accessionNumber,
        input.primaryDocument,
      ),
      objectKey,
      sha256: digest,
      contentType: stored.contentType,
      byteLength: BigInt(stored.byteLength),
      firstRetrievedAt: retrievedAt,
      lastRetrievedAt: retrievedAt,
    },
  });
  return { rawSourceId: rawSource.id, objectKey: stored.key };
}
