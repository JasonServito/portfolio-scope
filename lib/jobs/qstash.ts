import { createHash } from "node:crypto";

import { Client, Receiver } from "@upstash/qstash";
import { z } from "zod";

import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import { getApplicationOrigin } from "@/lib/jobs/config";
import { jobDeliverySchema } from "@/lib/jobs/types";

const defaultQstashHost = "qstash.upstash.io";
const maximumDiagnosticMessageLength = 240;
const qstashDeduplicationIdMaximumLength = 64;

const qstashApiBaseUrlSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "QSTASH_URL must be a credential-free HTTPS origin.",
      });
      return z.NEVER;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "QSTASH_URL must be a credential-free HTTPS origin.",
      });
      return z.NEVER;
    }
    return url.origin;
  });

const qstashClientEnvironmentSchema = z.object({
  QSTASH_TOKEN: z.string().trim().min(1),
  QSTASH_URL: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    qstashApiBaseUrlSchema.optional(),
  ),
});

const qstashReceiverEnvironmentSchema = z.object({
  QSTASH_CURRENT_SIGNING_KEY: z.string().trim().min(1),
  QSTASH_NEXT_SIGNING_KEY: z.string().trim().min(1),
});

export interface JobPublisher {
  publishJSON(input: {
    url: string;
    body: { jobId: string };
    retries: number;
    retryDelay: string;
    timeout: number;
    deduplicationId: string;
    label: string[];
    headers: { "x-correlation-id": string };
    redact: { body: true };
  }): Promise<{ messageId: string }>;
}

export interface SignatureReceiver {
  verify(input: {
    signature: string;
    body: string;
    url: string;
    clockTolerance: number;
  }): Promise<boolean>;
}

export type QstashPublishFailureDiagnostic = {
  qstashHost: string;
  errorName: string;
  httpStatus?: number;
  errorCode?: string;
  providerMessage?: string;
};

let sharedClient: Client | undefined;
let sharedReceiver: Receiver | undefined;

export function createQstashDeduplicationId(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, qstashDeduplicationIdMaximumLength);
}

function readErrorField(error: unknown, field: string) {
  if ((typeof error !== "object" && typeof error !== "function") || !error) {
    return undefined;
  }
  return (error as Record<string, unknown>)[field];
}

function sanitizeDiagnosticIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9_.-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function sanitizeProviderMessage(
  value: unknown,
  environment: NodeJS.ProcessEnv,
) {
  if (typeof value !== "string" || !value.trim()) return undefined;

  let providerMessage = value.trim();
  if (providerMessage.startsWith("{") || providerMessage.startsWith("[")) {
    try {
      const parsed = JSON.parse(providerMessage) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return undefined;
      }
      const candidate =
        typeof (parsed as Record<string, unknown>).error === "string"
          ? (parsed as Record<string, unknown>).error
          : (parsed as Record<string, unknown>).message;
      if (typeof candidate !== "string") return undefined;
      providerMessage = candidate;
    } catch {
      return undefined;
    }
  }

  if (
    /\b(?:request\s+)?(?:body|payload)\b/i.test(providerMessage) ||
    /[{}\[\]]/.test(providerMessage)
  ) {
    return undefined;
  }

  let sanitized = providerMessage
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(
      /\b(authorization|qstash[_-]?token|token|signing[_-]?key)\b\s*[:=]\s*["']?[^"'\s,;}]+["']?/gi,
      "$1=[REDACTED]",
    );

  for (const secret of [
    environment.QSTASH_TOKEN,
    environment.QSTASH_CURRENT_SIGNING_KEY,
    environment.QSTASH_NEXT_SIGNING_KEY,
  ]) {
    const normalizedSecret = secret?.trim();
    if (normalizedSecret) {
      sanitized = sanitized.replaceAll(normalizedSecret, "[REDACTED]");
    }
  }

  sanitized = sanitized.trim().replace(/\s{2,}/g, " ");
  if (!sanitized) return undefined;
  return sanitized.slice(0, maximumDiagnosticMessageLength);
}

function getConfiguredQstashHost(environment: NodeJS.ProcessEnv) {
  const configuredUrl = environment.QSTASH_URL?.trim();
  if (!configuredUrl) return defaultQstashHost;
  try {
    return new URL(configuredUrl).host;
  } catch {
    return "invalid";
  }
}

export function getPreviewQstashPublishFailureDiagnostic(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): QstashPublishFailureDiagnostic | null {
  if (environment.VERCEL_ENV?.trim().toLowerCase() !== "preview") {
    return null;
  }

  const status = readErrorField(error, "status");
  const cause = readErrorField(error, "cause");
  const directCode = sanitizeDiagnosticIdentifier(
    readErrorField(error, "code"),
  );
  const causeCode = sanitizeDiagnosticIdentifier(readErrorField(cause, "code"));
  const errorName =
    sanitizeDiagnosticIdentifier(readErrorField(error, "name")) ??
    (error instanceof Error
      ? sanitizeDiagnosticIdentifier(error.name)
      : undefined) ??
    "UnknownError";
  const message =
    readErrorField(error, "message") ??
    (error instanceof Error ? error.message : undefined);
  const providerMessage = sanitizeProviderMessage(message, environment);

  return {
    qstashHost: getConfiguredQstashHost(environment),
    errorName,
    ...(typeof status === "number" && Number.isInteger(status)
      ? { httpStatus: status }
      : {}),
    ...((directCode ?? causeCode)
      ? { errorCode: directCode ?? causeCode }
      : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
}

export function formatQstashPublishFailureDiagnostic(
  diagnostic: QstashPublishFailureDiagnostic,
) {
  return [
    `QStash publish failed: host=${diagnostic.qstashHost}`,
    `error=${diagnostic.errorName}`,
    ...(diagnostic.httpStatus === undefined
      ? []
      : [`status=${diagnostic.httpStatus}`]),
    ...(diagnostic.errorCode ? [`code=${diagnostic.errorCode}`] : []),
    ...(diagnostic.providerMessage
      ? [`message=${diagnostic.providerMessage}`]
      : []),
  ].join("; ");
}

export function getQstashClient(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = qstashClientEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background job delivery is not configured.",
      { cause: parsed.error },
    );
  }

  sharedClient ??= new Client({
    token: parsed.data.QSTASH_TOKEN,
    ...(parsed.data.QSTASH_URL ? { baseUrl: parsed.data.QSTASH_URL } : {}),
  });
  return sharedClient;
}

export function getQstashReceiver(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = qstashReceiverEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background worker verification is not configured.",
      { cause: parsed.error },
    );
  }

  sharedReceiver ??= new Receiver({
    currentSigningKey: parsed.data.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: parsed.data.QSTASH_NEXT_SIGNING_KEY,
  });
  return sharedReceiver;
}

export async function publishJobMessage(input: {
  jobId: string;
  type: string;
  maxAttempts: number;
  timeoutMs: number;
  correlationId: string;
  deduplicationId?: string;
  publisher?: JobPublisher;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = input.environment ?? process.env;
  const origin = getApplicationOrigin(environment);
  if (!origin) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "The public application origin is not configured for job delivery.",
    );
  }

  const publisher = input.publisher ?? getQstashClient(environment);
  const response = await publisher.publishJSON({
    url: `${origin}/api/internal/jobs/worker`,
    body: { jobId: input.jobId },
    retries: Math.max(0, input.maxAttempts - 1),
    retryDelay: "min(300000, 15000 * pow(2, retried))",
    timeout: Math.max(1, Math.ceil(input.timeoutMs / 1000)),
    deduplicationId: createQstashDeduplicationId(
      input.deduplicationId ?? input.jobId,
    ),
    label: ["portfolioscope", input.type.toLowerCase()],
    headers: { "x-correlation-id": input.correlationId },
    redact: { body: true },
  });
  if (!("messageId" in response) || typeof response.messageId !== "string") {
    throw new JobRequestError(
      JobErrorCode.PUBLISH_FAILED,
      503,
      "QStash returned an invalid publish response.",
    );
  }
  return { messageId: response.messageId };
}

export async function verifyQstashRequest(
  request: Request,
  input: {
    receiver?: SignatureReceiver;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const body = await verifyQstashSignature(request, input);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch (error) {
    throw new JobRequestError(
      JobErrorCode.INVALID_PAYLOAD,
      400,
      "The worker payload is invalid.",
      { cause: error },
    );
  }

  const parsed = jobDeliverySchema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.INVALID_PAYLOAD,
      400,
      "The worker payload is invalid.",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export async function verifyQstashSignature(
  request: Request,
  input: {
    receiver?: SignatureReceiver;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    throw new JobRequestError(
      JobErrorCode.WORKER_SIGNATURE_MISSING,
      401,
      "A valid worker signature is required.",
    );
  }

  const body = await request.text();
  const receiver =
    input.receiver ?? getQstashReceiver(input.environment ?? process.env);
  try {
    const valid = await receiver.verify({
      signature,
      body,
      url: request.url,
      clockTolerance: 5,
    });
    if (!valid) throw new Error("Signature did not validate.");
  } catch (error) {
    throw new JobRequestError(
      JobErrorCode.WORKER_AUTH_FAILED,
      401,
      "The worker signature is invalid.",
      { cause: error },
    );
  }

  return body;
}
