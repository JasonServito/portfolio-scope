import { z } from "zod";

export const featureFlagNames = [
  "AUTH_GOOGLE_ENABLED",
  "BACKGROUND_JOBS_ENABLED",
  "SEC_INGESTION_ENABLED",
  "PUBLIC_STOCK_PAGES_ENABLED",
  "RESEARCH_GENERATION_ENABLED",
  "AI_RESEARCH_ENABLED",
  "PORTFOLIO_EXPORT_ENABLED",
  "MAINTENANCE_MODE",
] as const;

export type FeatureFlagName = (typeof featureFlagNames)[number];

const booleanFlag = z.enum(["true", "false"]);

const localDefaults: Record<FeatureFlagName, boolean> = {
  AUTH_GOOGLE_ENABLED: true,
  BACKGROUND_JOBS_ENABLED: true,
  SEC_INGESTION_ENABLED: true,
  PUBLIC_STOCK_PAGES_ENABLED: true,
  RESEARCH_GENERATION_ENABLED: true,
  AI_RESEARCH_ENABLED: false,
  PORTFOLIO_EXPORT_ENABLED: false,
  MAINTENANCE_MODE: false,
};

export function isFeatureEnabled(
  name: FeatureFlagName,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = booleanFlag.safeParse(
    environment[name]?.trim().toLowerCase(),
  );
  if (parsed.success) return parsed.data === "true";

  if (environment.NODE_ENV === "production") return false;
  return localDefaults[name];
}

export function getFeatureFlagSummary(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Object.fromEntries(
    featureFlagNames.map((name) => [
      name,
      {
        enabled: isFeatureEnabled(name, environment),
        source: booleanFlag.safeParse(
          environment[name]?.trim().toLowerCase(),
        ).success
          ? "environment"
          : environment.NODE_ENV === "production"
            ? "safe-production-default"
            : "local-default",
      },
    ]),
  ) as Record<
    FeatureFlagName,
    { enabled: boolean; source: string }
  >;
}
