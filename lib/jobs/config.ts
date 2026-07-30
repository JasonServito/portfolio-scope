import { z } from "zod";

import {
  isFeatureEnabled,
  type FeatureFlagName,
} from "@/lib/operations/feature-flags";

export const backgroundFeatureNames = [
  "BACKGROUND_JOBS_ENABLED",
  "SEC_INGESTION_ENABLED",
  "RESEARCH_GENERATION_ENABLED",
] as const;

export type BackgroundFeatureName = (typeof backgroundFeatureNames)[number];

const booleanFlagSchema = z.enum(["true", "false"]);

const localManualSecFlag = "SEC_LOCAL_MANUAL_INGESTION_ENABLED";

export function isBackgroundFeatureEnabled(
  name: BackgroundFeatureName,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return isFeatureEnabled(name as FeatureFlagName, environment);
}

export function getApplicationOrigin(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (environment.NODE_ENV === "production" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isLocalManualSecIngestionEnabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configured = booleanFlagSchema.safeParse(
    environment[localManualSecFlag]?.trim().toLowerCase(),
  );
  if (!configured.success || configured.data !== "true") return false;

  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment === "preview" || vercelEnvironment === "production") {
    return false;
  }

  const value = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return false;

  try {
    const url = new URL(value);
    const loopbackHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return (
      url.protocol === "http:" &&
      loopbackHost &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
