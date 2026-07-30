import { logger } from "@/lib/observability/logger";

export type HeartbeatKind = "worker" | "backup" | "backupFailure";

const heartbeatVariables: Record<HeartbeatKind, string> = {
  worker: "BETTER_STACK_WORKER_HEARTBEAT_URL",
  backup: "BETTER_STACK_BACKUP_HEARTBEAT_URL",
  backupFailure: "BETTER_STACK_BACKUP_FAILURE_HEARTBEAT_URL",
};

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function getHeartbeatUrl(
  kind: HeartbeatKind,
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment[heartbeatVariables[kind]]?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (
      environment.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      isLoopback(url.hostname)
    ) {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

export async function sendOperationalHeartbeat(
  kind: HeartbeatKind,
  options: {
    environment?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    correlationId?: string;
    jobId?: string;
  } = {},
) {
  const url = getHeartbeatUrl(kind, options.environment);
  if (!url) return { sent: false as const, reason: "not_configured" as const };

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Heartbeat endpoint returned ${response.status}.`);
    }
    logger.info("operations.heartbeat.sent", {
      correlationId: options.correlationId,
      jobId: options.jobId,
      provider: "better-stack",
      details: { kind },
    });
    return { sent: true as const };
  } catch (error) {
    logger.warn(
      "operations.heartbeat.failed",
      {
        correlationId: options.correlationId,
        jobId: options.jobId,
        provider: "better-stack",
        errorCode: "HEARTBEAT_DELIVERY_FAILED",
        details: { kind },
      },
      error,
    );
    return { sent: false as const, reason: "delivery_failed" as const };
  }
}
