import { describe, expect, it } from "vitest";

import {
  getFeatureFlagSummary,
  isFeatureEnabled,
} from "@/lib/operations/feature-flags";

describe("operational feature flags", () => {
  it("defaults every missing production flag to disabled", () => {
    const summary = getFeatureFlagSummary({ NODE_ENV: "production" });

    expect(Object.values(summary).every((flag) => flag.enabled === false)).toBe(
      true,
    );
    expect(summary.SEC_INGESTION_ENABLED.source).toBe(
      "safe-production-default",
    );
  });

  it("preserves deterministic local features while future cost flags stay off", () => {
    expect(
      isFeatureEnabled("PUBLIC_STOCK_PAGES_ENABLED", {
        NODE_ENV: "development",
      }),
    ).toBe(true);
    expect(
      isFeatureEnabled("AI_RESEARCH_ENABLED", {
        NODE_ENV: "development",
      }),
    ).toBe(false);
    expect(
      isFeatureEnabled("EARNINGS_SYNC_ENABLED", {
        NODE_ENV: "development",
      }),
    ).toBe(false);
  });

  it("honors explicit true and false values", () => {
    expect(
      isFeatureEnabled("MAINTENANCE_MODE", {
        NODE_ENV: "production",
        MAINTENANCE_MODE: " true ",
      }),
    ).toBe(true);
    expect(
      isFeatureEnabled("AUTH_GOOGLE_ENABLED", {
        NODE_ENV: "development",
        AUTH_GOOGLE_ENABLED: "false",
      }),
    ).toBe(false);
  });
});
