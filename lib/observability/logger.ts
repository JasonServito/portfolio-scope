import { createHash } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  requestId?: string;
  correlationId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  jobId?: string;
  ticker?: string;
  provider?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
};

const sensitiveKey =
  /authorization|cookie|password|secret|token|credential|api[-_]?key|database[-_]?url|connection[-_]?string/i;
const bearerValue = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const credentialUrl = /([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;
const maximumStringLength = 500;

function redactString(value: string) {
  const redacted = value
    .replace(bearerValue, "Bearer [REDACTED]")
    .replace(credentialUrl, "$1[REDACTED]@");
  return redacted.length > maximumStringLength
    ? `${redacted.slice(0, maximumStringLength)}…`
    : redacted;
}

function sanitizeValue(
  value: unknown,
  depth = 0,
): string | number | boolean | null | unknown[] | Record<string, unknown> {
  if (value === null) return null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= 3) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          sensitiveKey.test(key)
            ? "[REDACTED]"
            : sanitizeValue(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

export function privacySafeUserId(userId: string | undefined) {
  if (!userId) return undefined;
  return `user_${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
}

function environmentName() {
  return (
    process.env.VERCEL_ENV?.trim() ||
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development"
  );
}

export function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError", errorMessage: sanitizeValue(error) };
  }

  return {
    errorName: error.name,
    errorMessage:
      process.env.NODE_ENV === "production"
        ? "Error details redacted; inspect the correlated error event."
        : redactString(error.message),
    ...(process.env.NODE_ENV === "production" || !error.stack
      ? {}
      : { stack: redactString(error.stack) }),
  };
}

export function writeLog(
  level: LogLevel,
  message: string,
  context: LogContext = {},
  error?: unknown,
) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
    environment: environmentName(),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.correlationId
      ? { correlationId: context.correlationId }
      : {}),
    ...(context.route ? { route: context.route } : {}),
    ...(context.method ? { method: context.method } : {}),
    ...(context.statusCode !== undefined
      ? { statusCode: context.statusCode }
      : {}),
    ...(context.durationMs !== undefined
      ? { durationMs: Math.round(context.durationMs) }
      : {}),
    ...(context.userId ? { userId: privacySafeUserId(context.userId) } : {}),
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.ticker ? { ticker: context.ticker } : {}),
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.errorCode ? { errorCode: context.errorCode } : {}),
    ...(context.details ? { details: sanitizeValue(context.details) } : {}),
    ...(error === undefined ? {} : serializeError(error)),
  };
  const output = JSON.stringify(payload);

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else if (level === "debug") {
    console.debug(output);
  } else {
    console.info(output);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    writeLog("debug", message, context),
  info: (message: string, context?: LogContext) =>
    writeLog("info", message, context),
  warn: (message: string, context?: LogContext, error?: unknown) =>
    writeLog("warn", message, context, error),
  error: (message: string, context?: LogContext, error?: unknown) =>
    writeLog("error", message, context, error),
};
