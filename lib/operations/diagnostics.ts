import { BackgroundJobStatus } from "@prisma/client";

import { getRedis, isRedisConfigured } from "@/lib/cache/redis";
import { db } from "@/lib/db";
import { getCostReview } from "@/lib/operations/cost-policy";
import {
  getFeatureFlagSummary,
  isFeatureEnabled,
} from "@/lib/operations/feature-flags";
import {
  getHeartbeatUrl,
  type HeartbeatKind,
} from "@/lib/operations/heartbeat";
import {
  R2ConfigurationError,
  R2ObjectStorage,
} from "@/lib/storage/object-storage";

export type DependencyStatus =
  | "ok"
  | "degraded"
  | "failed"
  | "disabled"
  | "unconfigured";

type ServiceStatus = {
  status: DependencyStatus;
  detail: string;
};

async function within<T>(promise: Promise<T>, timeoutMs = 2_500) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Dependency probe timed out.")),
        timeoutMs,
      );
      timeout.unref?.();
    }),
  ]);
}

function hasValues(names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function heartbeatConfigured(kind: HeartbeatKind) {
  return Boolean(getHeartbeatUrl(kind));
}

function configuredStatus(
  configured: boolean,
  detail: string,
): ServiceStatus {
  return configured
    ? { status: "ok", detail }
    : { status: "unconfigured", detail: `${detail} is not configured.` };
}

async function databaseDiagnostics() {
  try {
    const [sizeRows, failedJobs, supportedCompanies, latestWorker] =
      await Promise.all([
        db.$queryRaw<Array<{ bytes: bigint }>>`
          SELECT pg_database_size(current_database())::bigint AS bytes
        `,
        db.backgroundJob.count({
          where: {
            status: {
              in: [
                BackgroundJobStatus.FAILED,
                BackgroundJobStatus.PARTIALLY_COMPLETED,
              ],
            },
          },
        }),
        db.company.count({ where: { isSupported: true } }),
        db.backgroundJob.findFirst({
          where: { heartbeatAt: { not: null } },
          select: {
            id: true,
            type: true,
            heartbeatAt: true,
            correlationId: true,
          },
          orderBy: { heartbeatAt: "desc" },
        }),
      ]);
    return {
      status: "ok" as const,
      sizeBytes: Number(sizeRows[0]?.bytes ?? 0),
      failedJobs,
      supportedCompanies,
      latestWorkerHeartbeat: latestWorker
        ? {
            jobId: latestWorker.id,
            type: latestWorker.type,
            at: latestWorker.heartbeatAt?.toISOString() ?? null,
            correlationId: latestWorker.correlationId,
          }
        : null,
    };
  } catch {
    return {
      status: "failed" as const,
      sizeBytes: null,
      failedJobs: null,
      supportedCompanies: null,
      latestWorkerHeartbeat: null,
    };
  }
}

async function redisStatus(): Promise<ServiceStatus> {
  if (!isRedisConfigured()) {
    return {
      status: "unconfigured",
      detail: "Ephemeral coordination is not configured.",
    };
  }
  try {
    const client = getRedis();
    if (!client) throw new Error("Redis client unavailable.");
    await within(client.ping());
    return { status: "ok", detail: "Ephemeral coordination responded." };
  } catch {
    return {
      status: "failed",
      detail: "Ephemeral coordination did not respond.",
    };
  }
}

async function r2Status() {
  try {
    const storage = new R2ObjectStorage();
    const environment =
      process.env.VERCEL_ENV?.trim() ||
      process.env.NODE_ENV?.trim() ||
      "development";
    const objects = await within(
      storage.list(`backups/postgres/${environment}`, 20),
    );
    return {
      service: {
        status: "ok" as const,
        detail: "Private object storage responded.",
      },
      lastBackup: objects[0]
        ? {
            key: objects[0].key,
            byteLength: objects[0].byteLength,
            createdAt: objects[0].lastModified?.toISOString() ?? null,
          }
        : null,
    };
  } catch (error) {
    const unconfigured = error instanceof R2ConfigurationError;
    return {
      service: {
        status: unconfigured
          ? ("unconfigured" as const)
          : ("failed" as const),
        detail: unconfigured
          ? "Private object storage is not configured."
          : "Private object storage did not respond.",
      },
      lastBackup: null,
    };
  }
}

function restoreDrill() {
  const value = process.env.LAST_RESTORE_DRILL_AT?.trim();
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return {
    completedAt: timestamp.toISOString(),
    reference: process.env.LAST_RESTORE_DRILL_REFERENCE?.trim() || null,
  };
}

export async function getOperationalDiagnostics() {
  const [database, redis, r2] = await Promise.all([
    databaseDiagnostics(),
    redisStatus(),
    r2Status(),
  ]);
  const jobsEnabled = isFeatureEnabled("BACKGROUND_JOBS_ENABLED");
  const qstashConfigured = hasValues([
    "QSTASH_TOKEN",
    "QSTASH_CURRENT_SIGNING_KEY",
    "QSTASH_NEXT_SIGNING_KEY",
  ]);
  const sentryConfigured = Boolean(
    process.env.SENTRY_DSN?.trim() ||
      process.env.NEXT_PUBLIC_SENTRY_DSN?.trim(),
  );
  const posthogConfigured = hasValues([
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
  ]);
  const workerHeartbeat = heartbeatConfigured("worker");
  const backupHeartbeat = heartbeatConfigured("backup");
  const backupFailureHeartbeat = heartbeatConfigured("backupFailure");

  return {
    generatedAt: new Date().toISOString(),
    services: {
      database: {
        status: database.status,
        detail:
          database.status === "ok"
            ? "Authoritative application state responded."
            : "Authoritative application state did not respond.",
      } satisfies ServiceStatus,
      redis,
      r2: r2.service,
      qstash: jobsEnabled
        ? configuredStatus(qstashConfigured, "Signed background delivery")
        : {
            status: "disabled" as const,
            detail: "Background delivery is disabled by its kill switch.",
          },
      sentry: configuredStatus(sentryConfigured, "Error monitoring"),
      posthog: configuredStatus(posthogConfigured, "Product analytics"),
      betterStack:
        workerHeartbeat && backupHeartbeat && backupFailureHeartbeat
          ? {
              status: "ok" as const,
              detail:
                "Worker, backup-success, and backup-failure heartbeat endpoints are configured.",
            }
          : {
              status: "degraded" as const,
              detail: "One or more heartbeat endpoints are not configured.",
            },
    },
    metrics: {
      databaseSizeBytes: database.sizeBytes,
      failedJobs: database.failedJobs,
      supportedCompanies: database.supportedCompanies,
    },
    latestWorkerHeartbeat: database.latestWorkerHeartbeat,
    lastBackup: r2.lastBackup,
    lastRestoreDrill: restoreDrill(),
    costReview: getCostReview(),
    featureFlags: getFeatureFlagSummary(),
  };
}
