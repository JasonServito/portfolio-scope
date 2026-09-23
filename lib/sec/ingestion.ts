import { createHash, randomUUID } from "node:crypto";

import {
  R2ConfigurationError,
  R2ObjectStorage,
  type ObjectStorage,
} from "@/lib/storage/object-storage";
import {
  SecClientError,
  SecEdgarClient,
  buildSecCompanyFactsUrl,
  buildSecSubmissionsUrl,
} from "@/lib/sec/client";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";
import { getCachedSecEdgarClient } from "@/lib/sec/cached-client";
import { getSupportedCompany } from "@/lib/sec/company-registry";
import { currentReportWindowStart } from "@/lib/sec/current-reports";
import {
  normalizeCompanyFacts,
  parseRecentFilings,
} from "@/lib/sec/normalization";
import {
  prismaSecRepository,
  type SecIdentity,
  type SecRepository,
} from "@/lib/sec/repository";

export const SecIngestionErrorCode = {
  INVALID_TICKER: "SEC_INVALID_TICKER",
  UNSUPPORTED_TICKER: "SEC_UNSUPPORTED_TICKER",
  CONFIGURATION_ERROR: "SEC_CONFIGURATION_ERROR",
  PROVIDER_REJECTED: "SEC_PROVIDER_REJECTED",
  PROVIDER_RATE_LIMITED: "SEC_PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "SEC_PROVIDER_UNAVAILABLE",
  NETWORK_ERROR: "SEC_NETWORK_ERROR",
  TIMEOUT: "SEC_REQUEST_TIMEOUT",
  INVALID_JSON: "SEC_INVALID_JSON",
  SCHEMA_VALIDATION_FAILED: "SEC_SCHEMA_VALIDATION_FAILED",
  INVALID_RESPONSE: "SEC_INVALID_RESPONSE",
  // Retained for compatibility with persisted historical M14 failures.
  PROVIDER_ERROR: "SEC_PROVIDER_ERROR",
  STORAGE_ERROR: "SEC_STORAGE_ERROR",
  DATABASE_ERROR: "SEC_DATABASE_ERROR",
  INTERNAL_ERROR: "SEC_INTERNAL_ERROR",
} as const;

export type SecIngestionErrorCode =
  (typeof SecIngestionErrorCode)[keyof typeof SecIngestionErrorCode];

export class SecIngestionError extends Error {
  readonly name = "SecIngestionError";
  readonly retryable: boolean;
  readonly clientError?: SecClientError;
  readonly operation?: string;
  partiallyCompleted = false;

  constructor(
    public readonly code: SecIngestionErrorCode,
    public readonly status: 400 | 503,
    message: string,
    options?: ErrorOptions & {
      retryable?: boolean;
      partiallyCompleted?: boolean;
      clientError?: SecClientError;
      operation?: string;
    },
  ) {
    super(message, options);
    this.retryable =
      options?.retryable ??
      (code === SecIngestionErrorCode.PROVIDER_RATE_LIMITED ||
        code === SecIngestionErrorCode.PROVIDER_UNAVAILABLE ||
        code === SecIngestionErrorCode.NETWORK_ERROR ||
        code === SecIngestionErrorCode.TIMEOUT ||
        code === SecIngestionErrorCode.PROVIDER_ERROR ||
        code === SecIngestionErrorCode.STORAGE_ERROR ||
        code === SecIngestionErrorCode.DATABASE_ERROR);
    this.partiallyCompleted = options?.partiallyCompleted ?? false;
    this.clientError = options?.clientError;
    this.operation = options?.operation;
  }
}

export type SecIngestionDiagnostic = {
  timestamp: string;
  level: "error";
  event: "sec.ingestion.failed" | "sec.ingestion.failure-recording-failed";
  correlationId: string;
  ticker: string;
  cik: string;
  trigger: "ADMIN" | "LOCAL" | "TEST" | "JOB" | "SCHEDULE";
  executionPath:
    | "LOCAL_SYNCHRONOUS"
    | "BACKGROUND_JOB"
    | "CONTROLLED_SYNCHRONOUS";
  stage: string;
  operation: string;
  endpointUrl?: string;
  attemptNumber?: number;
  httpStatus?: number;
  failureCategory: string;
  upstreamErrorCode?: string;
  errorCode: string;
  retryable: boolean;
  partiallyCompleted: boolean;
};

type SecDiagnosticLogger = (diagnostic: SecIngestionDiagnostic) => void;

type IngestionClient = Pick<
  SecEdgarClient,
  "getSubmissions" | "getCompanyFacts"
>;

type IngestionDependencies = {
  repository?: SecRepository;
  client?: IngestionClient;
  storage?: ObjectStorage;
  storageEnvironment?: Record<string, string | undefined>;
  /** Feature-flag source; 8-K retention follows `SEC_CURRENT_REPORTS_ENABLED`. */
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  logger?: SecDiagnosticLogger;
};

function serializePayload(payload: unknown) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function sha256(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

function classifyClientError(error: SecClientError) {
  const classification = (() => {
    switch (error.code) {
      case "SEC_INVALID_CONFIGURATION":
        return {
          code: SecIngestionErrorCode.CONFIGURATION_ERROR,
          message: "SEC ingestion is not configured.",
        };
      case "SEC_REQUEST_REJECTED":
        return {
          code: SecIngestionErrorCode.PROVIDER_REJECTED,
          message: "SEC rejected the data request.",
        };
      case "SEC_PROVIDER_RATE_LIMITED":
        return {
          code: SecIngestionErrorCode.PROVIDER_RATE_LIMITED,
          message: "SEC temporarily rate limited the data request.",
        };
      case "SEC_PROVIDER_UNAVAILABLE":
        return {
          code: SecIngestionErrorCode.PROVIDER_UNAVAILABLE,
          message: "SEC is temporarily unavailable.",
        };
      case "SEC_NETWORK_ERROR":
        return {
          code: SecIngestionErrorCode.NETWORK_ERROR,
          message: "SEC could not be reached safely.",
        };
      case "SEC_REQUEST_TIMEOUT":
        return {
          code: SecIngestionErrorCode.TIMEOUT,
          message: "SEC did not respond before the request timeout.",
        };
      case "SEC_INVALID_JSON":
        return {
          code: SecIngestionErrorCode.INVALID_JSON,
          message: "SEC returned malformed JSON.",
        };
      case "SEC_SCHEMA_VALIDATION_FAILED":
        return {
          code: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
          message: "SEC returned data that failed contract validation.",
        };
      case "SEC_INVALID_RESPONSE":
        return {
          code: SecIngestionErrorCode.INVALID_RESPONSE,
          message: "SEC returned an invalid response.",
        };
    }
  })();

  return new SecIngestionError(classification.code, 503, classification.message, {
    cause: error,
    retryable: error.retryable,
    clientError: error,
    operation: error.details?.operation,
  });
}

function classifyError(error: unknown) {
  if (error instanceof SecIngestionError) return error;
  if (error instanceof SecClientError) return classifyClientError(error);
  if (error instanceof R2ConfigurationError) {
    return new SecIngestionError(
      SecIngestionErrorCode.CONFIGURATION_ERROR,
      503,
      "SEC raw storage is not configured.",
      { cause: error, operation: "configure-r2-storage" },
    );
  }

  return new SecIngestionError(
    SecIngestionErrorCode.INTERNAL_ERROR,
    503,
    "SEC ingestion could not be completed.",
    { cause: error, retryable: false },
  );
}

async function runDatabaseOperation<T>(
  operation: string,
  action: () => Promise<T>,
) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SecIngestionError) throw error;
    throw new SecIngestionError(
      SecIngestionErrorCode.DATABASE_ERROR,
      503,
      "SEC database persistence failed.",
      { cause: error, retryable: true, operation },
    );
  }
}

function executionPath(
  trigger: "ADMIN" | "LOCAL" | "TEST" | "JOB" | "SCHEDULE",
): SecIngestionDiagnostic["executionPath"] {
  if (trigger === "LOCAL") return "LOCAL_SYNCHRONOUS";
  if (trigger === "JOB" || trigger === "SCHEDULE") return "BACKGROUND_JOB";
  return "CONTROLLED_SYNCHRONOUS";
}

function sanitizedSecEndpoint(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".sec.gov")) {
      return undefined;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function defaultDiagnosticLogger(diagnostic: SecIngestionDiagnostic) {
  if (process.env.NODE_ENV !== "test") {
    console.error(JSON.stringify(diagnostic));
  }
}

function ingestionFailureCategory(error: SecIngestionError) {
  if (error.clientError?.details?.failureCategory) {
    return error.clientError.details.failureCategory;
  }
  switch (error.code) {
    case SecIngestionErrorCode.CONFIGURATION_ERROR:
      return "configuration";
    case SecIngestionErrorCode.STORAGE_ERROR:
      return "object-storage";
    case SecIngestionErrorCode.DATABASE_ERROR:
      return "database-persistence";
    case SecIngestionErrorCode.INTERNAL_ERROR:
      return "internal-orchestration";
    default:
      return "ingestion";
  }
}

async function storeRawPayload(input: {
  storage: ObjectStorage;
  repository: SecRepository;
  secEntityId: string;
  cik: string;
  kind: "SUBMISSIONS" | "COMPANY_FACTS";
  sourceUrl: string;
  payload: unknown;
  retrievedAt: Date;
}) {
  const body = serializePayload(input.payload);
  const digest = sha256(body);
  const path = input.kind === "SUBMISSIONS" ? "submissions" : "company-facts";
  const objectKey = `sec/${input.cik}/${path}/${digest}.json`;

  let stored;
  try {
    stored = await input.storage.put({
      key: objectKey,
      body,
      contentType: "application/json",
      metadata: {
        cik: input.cik,
        source: "sec-edgar",
        sha256: digest,
      },
    });
  } catch (error) {
    throw new SecIngestionError(
      SecIngestionErrorCode.STORAGE_ERROR,
      503,
      "Raw SEC source storage failed.",
      {
        cause: error,
        retryable: true,
        operation: `r2-put-${input.kind.toLowerCase().replaceAll("_", "-")}`,
      },
    );
  }

  return runDatabaseOperation(
    `save-${input.kind.toLowerCase().replaceAll("_", "-")}-raw-source`,
    () =>
      input.repository.saveRawSource({
        secEntityId: input.secEntityId,
        kind: input.kind,
        sourceUrl: input.sourceUrl,
        objectKey: stored.key,
        sha256: digest,
        contentType: stored.contentType,
        byteLength: stored.byteLength,
        retrievedAt: input.retrievedAt,
      }),
  );
}

export async function ingestSupportedCompany(
  ticker: string,
  input: {
    trigger: "ADMIN" | "LOCAL" | "TEST" | "JOB" | "SCHEDULE";
    requestedByUserId?: string | null;
    correlationId?: string;
  },
  dependencies: IngestionDependencies = {},
) {
  const supportedCompany = getSupportedCompany(ticker);
  if (!supportedCompany) {
    throw new SecIngestionError(
      SecIngestionErrorCode.UNSUPPORTED_TICKER,
      400,
      "Ticker is not in the supported SEC universe.",
    );
  }

  const repository = dependencies.repository ?? prismaSecRepository;
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? defaultDiagnosticLogger;
  const correlationId = input.correlationId ?? randomUUID();
  const startedAt = now();
  let stage = "identity";
  let operation = "ensure-sec-identity";
  let endpointUrl: string | undefined;
  const logFailure = (
    event: SecIngestionDiagnostic["event"],
    error: SecIngestionError,
  ) => {
    const clientDetails = error.clientError?.details;
    try {
      logger({
        timestamp: now().toISOString(),
        level: "error",
        event,
        correlationId,
        ticker: supportedCompany.ticker,
        cik: supportedCompany.cik,
        trigger: input.trigger,
        executionPath: executionPath(input.trigger),
        stage,
        operation:
          error.operation ?? clientDetails?.operation ?? operation,
        endpointUrl: sanitizedSecEndpoint(
          clientDetails?.endpointUrl ?? endpointUrl,
        ),
        attemptNumber: clientDetails?.attemptNumber,
        httpStatus: clientDetails?.httpStatus,
        failureCategory: ingestionFailureCategory(error),
        upstreamErrorCode: error.clientError?.code,
        errorCode: error.code,
        retryable: error.retryable,
        partiallyCompleted: error.partiallyCompleted,
      });
    } catch {
      // Diagnostics must never replace the categorized ingestion failure.
    }
  };
  let identity: SecIdentity;
  let run: { id: string };
  try {
    identity = await runDatabaseOperation("ensure-sec-identity", () =>
      repository.ensureIdentity(supportedCompany),
    );
    stage = "run-initialization";
    operation = "start-ingestion-run";
    run = await runDatabaseOperation("start-ingestion-run", () =>
      repository.startRun({
        secEntityId: identity.secEntityId,
        requestedByUserId: input.requestedByUserId ?? null,
        trigger: input.trigger,
        correlationId,
        startedAt,
      }),
    );
  } catch (error) {
    const ingestionError = classifyError(error);
    logFailure("sec.ingestion.failed", ingestionError);
    throw ingestionError;
  }
  const counts = {
    filingsProcessed: 0,
    factsProcessed: 0,
    factsSelected: 0,
    ambiguousFacts: 0,
  };

  try {
    stage = "provider-configuration";
    operation = "configure-sec-client-and-storage";
    const client = dependencies.client ?? getCachedSecEdgarClient();
    const storage =
      dependencies.storage ??
      new R2ObjectStorage(dependencies.storageEnvironment);

    stage = "submissions-retrieval";
    operation = "get-submissions";
    const submissionsUrl = buildSecSubmissionsUrl(supportedCompany.cik);
    endpointUrl = submissionsUrl;
    const submissionsRetrievedAt = now();
    const submissions = await client.getSubmissions(supportedCompany.cik);

    stage = "submissions-raw-persistence";
    operation = "persist-submissions-raw-source";
    await storeRawPayload({
      storage,
      repository,
      secEntityId: identity.secEntityId,
      cik: supportedCompany.cik,
      kind: "SUBMISSIONS",
      sourceUrl: submissionsUrl,
      payload: submissions,
      retrievedAt: submissionsRetrievedAt,
    });
    stage = "submissions-database-persistence";
    operation = "update-sec-entity-metadata";
    await runDatabaseOperation("update-sec-entity-metadata", () =>
      repository.updateEntityMetadata(identity, submissions),
    );

    stage = "filing-normalization";
    operation = "parse-recent-filings";
    // 8-K metadata is retained only where the M32 capability is enabled, so
    // the original 10-K and 10-Q filing set is unchanged elsewhere.
    const filings = parseRecentFilings(submissions, supportedCompany.cik, {
      currentReportsFiledOnOrAfter: isFeatureEnabled(
        "SEC_CURRENT_REPORTS_ENABLED",
        dependencies.environment ?? process.env,
      )
        ? currentReportWindowStart(startedAt)
        : null,
    });
    stage = "filing-database-persistence";
    operation = "save-filings";
    const filingIds = await runDatabaseOperation("save-filings", () =>
      repository.saveFilings(identity.secEntityId, filings),
    );
    counts.filingsProcessed = filings.length;

    stage = "company-facts-retrieval";
    operation = "get-company-facts";
    const companyFactsUrl = buildSecCompanyFactsUrl(supportedCompany.cik);
    endpointUrl = companyFactsUrl;
    const factsRetrievedAt = now();
    const companyFacts = await client.getCompanyFacts(supportedCompany.cik);

    stage = "company-facts-raw-persistence";
    operation = "persist-company-facts-raw-source";
    const rawFacts = await storeRawPayload({
      storage,
      repository,
      secEntityId: identity.secEntityId,
      cik: supportedCompany.cik,
      kind: "COMPANY_FACTS",
      sourceUrl: companyFactsUrl,
      payload: companyFacts,
      retrievedAt: factsRetrievedAt,
    });
    stage = "company-facts-normalization";
    operation = "normalize-company-facts";
    const normalizedFacts = normalizeCompanyFacts(companyFacts, {
      cik: supportedCompany.cik,
      observedAt: factsRetrievedAt,
    });
    stage = "company-facts-database-persistence";
    operation = "save-normalized-facts";
    const factCounts = await runDatabaseOperation("save-normalized-facts", () =>
      repository.saveFacts({
        secEntityId: identity.secEntityId,
        rawSourceId: rawFacts.id,
        facts: normalizedFacts,
        filingIds,
      }),
    );
    counts.factsProcessed = factCounts.processed;
    counts.factsSelected = factCounts.selected;
    counts.ambiguousFacts = factCounts.ambiguous;

    stage = "run-completion";
    operation = "complete-ingestion-run";
    const completedAt = now();
    await runDatabaseOperation("complete-ingestion-run", () =>
      repository.completeRun({
        runId: run.id,
        companyId: identity.companyId,
        completedAt,
        ...counts,
      }),
    );

    return {
      runId: run.id,
      ticker: supportedCompany.ticker,
      correlationId,
      status: "COMPLETED" as const,
      ...counts,
    };
  } catch (error) {
    const ingestionError = classifyError(error);
    ingestionError.partiallyCompleted = counts.filingsProcessed > 0;
    logFailure("sec.ingestion.failed", ingestionError);
    try {
      await repository.failRun({
        runId: run.id,
        completedAt: now(),
        partiallyCompleted: counts.filingsProcessed > 0,
        ...counts,
        errorCode: ingestionError.code,
        errorMessage: ingestionError.message,
      });
    } catch (failureRecordingError) {
      const recordingError = new SecIngestionError(
        SecIngestionErrorCode.DATABASE_ERROR,
        503,
        "SEC ingestion failure state could not be recorded.",
        {
          cause: failureRecordingError,
          retryable: true,
          partiallyCompleted: ingestionError.partiallyCompleted,
          operation: "fail-ingestion-run",
        },
      );
      logFailure("sec.ingestion.failure-recording-failed", recordingError);
      // The original categorized failure is safer to expose than a database
      // implementation detail from the attempt to record it.
    }
    throw ingestionError;
  }
}
