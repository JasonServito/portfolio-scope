import { isRedisConfigured } from "@/lib/cache/redis";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";

export type EarningsSyncConfig =
  | { enabled: true; apiKey: string }
  | {
      enabled: false;
      reason:
        | "DISABLED"
        | "MISSING_API_KEY"
        | "MISSING_REDIS"
        | "NON_PRODUCTION";
    };

export function getEarningsSyncConfig(
  environment: NodeJS.ProcessEnv = process.env,
): EarningsSyncConfig {
  if (!isFeatureEnabled("EARNINGS_SYNC_ENABLED", environment)) {
    return { enabled: false, reason: "DISABLED" };
  }
  if (environment.VERCEL_ENV?.trim().toLowerCase() !== "production") {
    return { enabled: false, reason: "NON_PRODUCTION" };
  }

  const apiKey = environment.EARNINGS_API_KEY?.trim();
  if (!apiKey) return { enabled: false, reason: "MISSING_API_KEY" };
  if (!isRedisConfigured(environment)) {
    return { enabled: false, reason: "MISSING_REDIS" };
  }

  return { enabled: true, apiKey };
}
