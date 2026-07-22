import { z } from "zod";

import { formatCik } from "@/lib/sec/company-registry";
import { waitForDistributedSecPermit } from "@/lib/sec/distributed-rate";
import {
  secCompanyFactsSchema,
  secSubmissionsSchema,
  type SecCompanyFacts,
  type SecSubmissions,
} from "@/lib/sec/schemas";

const secEnvironmentSchema = z.object({
  SEC_USER_AGENT: z.string().trim().min(3),
  SEC_CONTACT_EMAIL: z.string().trim().email(),
});

const SEC_DATA_ORIGIN = "https://data.sec.gov";
const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";

export const SecClientErrorCode = {
  INVALID_CONFIGURATION: "SEC_INVALID_CONFIGURATION",
  INVALID_RESPONSE: "SEC_INVALID_RESPONSE",
  INVALID_JSON: "SEC_INVALID_JSON",
  SCHEMA_VALIDATION_FAILED: "SEC_SCHEMA_VALIDATION_FAILED",
  PROVIDER_RATE_LIMITED: "SEC_PROVIDER_RATE_LIMITED",
  PROVIDER_UNAVAILABLE: "SEC_PROVIDER_UNAVAILABLE",
  REQUEST_REJECTED: "SEC_REQUEST_REJECTED",
  NETWORK_ERROR: "SEC_NETWORK_ERROR",
  REQUEST_TIMEOUT: "SEC_REQUEST_TIMEOUT",
} as const;

export type SecClientErrorCode =
  (typeof SecClientErrorCode)[keyof typeof SecClientErrorCode];

export type SecClientOperation =
  | "configure-client"
  | "get-submissions"
  | "get-company-facts"
  | "get-filing-document"
  | "validate-response-cik";

export type SecClientFailureCategory =
  | "configuration"
  | "provider-rejection"
  | "provider-rate-limit"
  | "provider-unavailable"
  | "network"
  | "timeout"
  | "invalid-json"
  | "schema-validation"
  | "invalid-response";

export type SecClientErrorDetails = {
  operation: SecClientOperation;
  endpointUrl?: string;
  attemptNumber?: number;
  httpStatus?: number;
  failureCategory: SecClientFailureCategory;
};

export class SecClientError extends Error {
  readonly name = "SecClientError";
  readonly details?: SecClientErrorDetails;

  constructor(
    public readonly code: SecClientErrorCode,
    public readonly retryable: boolean,
    message: string,
    options?: ErrorOptions & { details?: SecClientErrorDetails },
  ) {
    super(message, options);
    this.details = options?.details;
  }
}

type Fetch = typeof fetch;

type SecClientOptions = {
  userAgent: string;
  contactEmail: string;
  fetch?: Fetch;
  requestsPerSecond?: number;
  timeoutMs?: number;
  maxRetries?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeRequest?: () => Promise<unknown>;
};

class FairAccessGate {
  private nextAllowedAt = 0;
  private tail = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async wait() {
    const predecessor = this.tail;
    let release: () => void = () => void 0;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await predecessor;
    try {
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + this.intervalMs;
    } finally {
      release();
    }
  }
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date))
      return Math.min(Math.max(0, date - Date.now()), 10_000);
  }

  return Math.min(250 * 2 ** attempt, 2_000);
}

export class SecEdgarClient {
  private readonly fetchImplementation: Fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly beforeRequest: () => Promise<unknown>;
  private readonly gate: FairAccessGate;

  constructor(options: SecClientOptions) {
    const requestsPerSecond = options.requestsPerSecond ?? 8;
    if (requestsPerSecond <= 0 || requestsPerSecond > 10) {
      throw new SecClientError(
        SecClientErrorCode.INVALID_CONFIGURATION,
        false,
        "SEC request rate must be between 1 and 10 requests per second.",
        {
          details: {
            operation: "configure-client",
            failureCategory: "configuration",
          },
        },
      );
    }

    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? defaultSleep;
    this.beforeRequest = options.beforeRequest ?? (() => Promise.resolve());
    this.userAgent = `${options.userAgent.trim()} ${options.contactEmail.trim()}`;
    this.gate = new FairAccessGate(
      Math.ceil(1000 / requestsPerSecond),
      options.now ?? Date.now,
      this.sleep,
    );
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
    const parsed = secEnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
      throw new SecClientError(
        SecClientErrorCode.INVALID_CONFIGURATION,
        false,
        "SEC_USER_AGENT and a valid SEC_CONTACT_EMAIL are required.",
        {
          details: {
            operation: "configure-client",
            failureCategory: "configuration",
          },
        },
      );
    }

    return new SecEdgarClient({
      userAgent: parsed.data.SEC_USER_AGENT,
      contactEmail: parsed.data.SEC_CONTACT_EMAIL,
      beforeRequest: waitForDistributedSecPermit,
    });
  }

  async getSubmissions(cik: string): Promise<SecSubmissions> {
    const url = buildSecSubmissionsUrl(cik);
    const result = await this.requestJson(
      url,
      secSubmissionsSchema,
      "get-submissions",
    );
    this.assertExpectedCik(cik, result.data.cik, {
      operation: "validate-response-cik",
      endpointUrl: url,
      attemptNumber: result.attemptNumber,
      httpStatus: 200,
      failureCategory: "invalid-response",
    });
    return result.data;
  }

  async getCompanyFacts(cik: string): Promise<SecCompanyFacts> {
    const url = buildSecCompanyFactsUrl(cik);
    const result = await this.requestJson(
      url,
      secCompanyFactsSchema,
      "get-company-facts",
    );
    this.assertExpectedCik(cik, result.data.cik, {
      operation: "validate-response-cik",
      endpointUrl: url,
      attemptNumber: result.attemptNumber,
      httpStatus: 200,
      failureCategory: "invalid-response",
    });
    return result.data;
  }

  async getFilingDocument(
    cik: string,
    accessionNumber: string,
    primaryDocument: string,
  ) {
    const url = buildSecFilingUrl(cik, accessionNumber, primaryDocument);
    const maximumBytes = 10 * 1024 * 1024;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const attemptNumber = attempt + 1;
      await this.gate.wait();
      await this.beforeRequest();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(url, {
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain",
            "Accept-Encoding": "gzip, deflate",
            "User-Agent": this.userAgent,
          },
          signal: controller.signal,
        });
        if (response.ok) {
          const declaredLength = Number(response.headers.get("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
            throw new SecClientError(
              SecClientErrorCode.INVALID_RESPONSE,
              false,
              "SEC filing document exceeded the safe size limit.",
              {
                details: {
                  operation: "get-filing-document",
                  endpointUrl: url,
                  attemptNumber,
                  httpStatus: response.status,
                  failureCategory: "invalid-response",
                },
              },
            );
          }
          const body = new Uint8Array(await response.arrayBuffer());
          if (body.byteLength === 0 || body.byteLength > maximumBytes) {
            throw new SecClientError(
              SecClientErrorCode.INVALID_RESPONSE,
              false,
              "SEC filing document was empty or exceeded the safe size limit.",
              {
                details: {
                  operation: "get-filing-document",
                  endpointUrl: url,
                  attemptNumber,
                  httpStatus: response.status,
                  failureCategory: "invalid-response",
                },
              },
            );
          }
          return {
            url,
            body,
            contentType:
              response.headers.get("content-type")?.split(";")[0] ??
              "application/octet-stream",
          };
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            await this.sleep(retryAfterMilliseconds(response, attempt));
            continue;
          }
          throw new SecClientError(
            response.status === 429
              ? SecClientErrorCode.PROVIDER_RATE_LIMITED
              : SecClientErrorCode.PROVIDER_UNAVAILABLE,
            true,
            response.status === 429
              ? "SEC temporarily rate limited the filing request."
              : "SEC filing retrieval is temporarily unavailable.",
            {
              details: {
                operation: "get-filing-document",
                endpointUrl: url,
                attemptNumber,
                httpStatus: response.status,
                failureCategory:
                  response.status === 429
                    ? "provider-rate-limit"
                    : "provider-unavailable",
              },
            },
          );
        }

        throw new SecClientError(
          SecClientErrorCode.REQUEST_REJECTED,
          false,
          `SEC rejected the filing request with status ${response.status}.`,
          {
            details: {
              operation: "get-filing-document",
              endpointUrl: url,
              attemptNumber,
              httpStatus: response.status,
              failureCategory: "provider-rejection",
            },
          },
        );
      } catch (error) {
        if (error instanceof SecClientError) throw error;
        if (attempt < this.maxRetries) {
          await this.sleep(Math.min(250 * 2 ** attempt, 2_000));
          continue;
        }
        const timedOut = controller.signal.aborted;
        throw new SecClientError(
          timedOut
            ? SecClientErrorCode.REQUEST_TIMEOUT
            : SecClientErrorCode.NETWORK_ERROR,
          true,
          timedOut
            ? "SEC filing retrieval timed out before a valid response was received."
            : "SEC filing retrieval failed before a valid response was received.",
          {
            cause: error,
            details: {
              operation: "get-filing-document",
              endpointUrl: url,
              attemptNumber,
              failureCategory: timedOut ? "timeout" : "network",
            },
          },
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new SecClientError(
      SecClientErrorCode.PROVIDER_UNAVAILABLE,
      true,
      "SEC filing retrieval exhausted its attempts.",
      {
        details: {
          operation: "get-filing-document",
          endpointUrl: url,
          attemptNumber: this.maxRetries + 1,
          failureCategory: "provider-unavailable",
        },
      },
    );
  }

  private assertExpectedCik(
    requestedCik: string,
    responseCik: string | number,
    details: SecClientErrorDetails,
  ) {
    if (formatCik(responseCik) !== formatCik(requestedCik)) {
      throw new SecClientError(
        SecClientErrorCode.INVALID_RESPONSE,
        false,
        "SEC response CIK did not match the requested entity.",
        { details },
      );
    }
  }

  private async requestJson<T>(
    url: string,
    schema: z.ZodType<T>,
    operation: Extract<
      SecClientOperation,
      "get-submissions" | "get-company-facts"
    >,
  ): Promise<{ data: T; attemptNumber: number }> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const attemptNumber = attempt + 1;
      await this.gate.wait();
      await this.beforeRequest();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImplementation(url, {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
            "User-Agent": this.userAgent,
          },
          signal: controller.signal,
        });

        if (response.ok) {
          let payload: unknown;
          try {
            payload = JSON.parse(await response.text());
          } catch (error) {
            throw new SecClientError(
              SecClientErrorCode.INVALID_JSON,
              false,
              "SEC returned malformed JSON.",
              {
                cause: error,
                details: {
                  operation,
                  endpointUrl: url,
                  attemptNumber,
                  httpStatus: response.status,
                  failureCategory: "invalid-json",
                },
              },
            );
          }

          const parsed = schema.safeParse(payload);
          if (!parsed.success) {
            throw new SecClientError(
              SecClientErrorCode.SCHEMA_VALIDATION_FAILED,
              false,
              "SEC response did not match the expected contract.",
              {
                cause: parsed.error,
                details: {
                  operation,
                  endpointUrl: url,
                  attemptNumber,
                  httpStatus: response.status,
                  failureCategory: "schema-validation",
                },
              },
            );
          }

          return { data: parsed.data, attemptNumber };
        }

        if (response.status === 429) {
          if (attempt < this.maxRetries) {
            await this.sleep(retryAfterMilliseconds(response, attempt));
            continue;
          }

          throw new SecClientError(
            SecClientErrorCode.PROVIDER_RATE_LIMITED,
            true,
            "SEC temporarily rate limited the request.",
            {
              details: {
                operation,
                endpointUrl: url,
                attemptNumber,
                httpStatus: response.status,
                failureCategory: "provider-rate-limit",
              },
            },
          );
        }

        if (response.status >= 500) {
          if (attempt < this.maxRetries) {
            await this.sleep(retryAfterMilliseconds(response, attempt));
            continue;
          }

          throw new SecClientError(
            SecClientErrorCode.PROVIDER_UNAVAILABLE,
            true,
            "SEC is temporarily unavailable.",
            {
              details: {
                operation,
                endpointUrl: url,
                attemptNumber,
                httpStatus: response.status,
                failureCategory: "provider-unavailable",
              },
            },
          );
        }

        throw new SecClientError(
          SecClientErrorCode.REQUEST_REJECTED,
          false,
          `SEC rejected the request with status ${response.status}.`,
          {
            details: {
              operation,
              endpointUrl: url,
              attemptNumber,
              httpStatus: response.status,
              failureCategory: "provider-rejection",
            },
          },
        );
      } catch (error) {
        if (error instanceof SecClientError) throw error;

        if (attempt < this.maxRetries) {
          await this.sleep(Math.min(250 * 2 ** attempt, 2_000));
          continue;
        }

        const timedOut = controller.signal.aborted;
        throw new SecClientError(
          timedOut
            ? SecClientErrorCode.REQUEST_TIMEOUT
            : SecClientErrorCode.NETWORK_ERROR,
          true,
          timedOut
            ? "SEC request timed out before a valid response was received."
            : "SEC request failed before a valid response was received.",
          {
            cause: error,
            details: {
              operation,
              endpointUrl: url,
              attemptNumber,
              failureCategory: timedOut ? "timeout" : "network",
            },
          },
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new SecClientError(
      SecClientErrorCode.PROVIDER_UNAVAILABLE,
      true,
      "SEC request exhausted its attempts.",
      {
        details: {
          operation,
          endpointUrl: url,
          attemptNumber: this.maxRetries + 1,
          failureCategory: "provider-unavailable",
        },
      },
    );
  }
}

let sharedSecEdgarClient: SecEdgarClient | undefined;

export function getSecEdgarClient() {
  sharedSecEdgarClient ??= SecEdgarClient.fromEnvironment();
  return sharedSecEdgarClient;
}

export function buildSecSubmissionsUrl(cik: string) {
  return `${SEC_DATA_ORIGIN}/submissions/CIK${formatCik(cik)}.json`;
}

export function buildSecCompanyFactsUrl(cik: string) {
  return `${SEC_DATA_ORIGIN}/api/xbrl/companyfacts/CIK${formatCik(cik)}.json`;
}

export function buildSecFilingUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
    throw new Error("SEC accession number is not valid.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(primaryDocument)) {
    throw new Error("SEC primary document name is not valid.");
  }

  return `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${Number(formatCik(cik))}/${accessionNumber.replaceAll("-", "")}/${primaryDocument}`;
}

export function buildSecFilingIndexUrl(cik: string, accessionNumber: string) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
    throw new Error("SEC accession number is not valid.");
  }

  return `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${Number(formatCik(cik))}/${accessionNumber.replaceAll("-", "")}/${accessionNumber}-index.html`;
}
