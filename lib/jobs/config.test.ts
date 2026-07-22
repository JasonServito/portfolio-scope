import { describe, expect, it } from "vitest";

import {
  getApplicationOrigin,
  isBackgroundFeatureEnabled,
  isLocalManualSecIngestionEnabled,
} from "@/lib/jobs/config";

describe("background feature configuration", () => {
  it("defaults expensive production work off and local work on", () => {
    expect(
      isBackgroundFeatureEnabled("SEC_INGESTION_ENABLED", {
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isBackgroundFeatureEnabled("SEC_INGESTION_ENABLED", {
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("honors explicit flags and validates the worker origin", () => {
    expect(
      isBackgroundFeatureEnabled("BACKGROUND_JOBS_ENABLED", {
        NODE_ENV: "production",
        BACKGROUND_JOBS_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      getApplicationOrigin({
        NODE_ENV: "test",
        NEXT_PUBLIC_APP_URL: "https://portfolioscope.dev/path",
      } as NodeJS.ProcessEnv),
    ).toBe("https://portfolioscope.dev");
    expect(
      getApplicationOrigin({
        NODE_ENV: "test",
        NEXT_PUBLIC_APP_URL: "javascript:alert(1)",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      getApplicationOrigin({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://portfolioscope.dev",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("allows manual SEC ingestion only with an explicit loopback configuration", () => {
    expect(
      isLocalManualSecIngestionEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        SEC_LOCAL_MANUAL_INGESTION_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isLocalManualSecIngestionEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isLocalManualSecIngestionEnabled({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        SEC_LOCAL_MANUAL_INGESTION_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isLocalManualSecIngestionEnabled({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        SEC_LOCAL_MANUAL_INGESTION_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isLocalManualSecIngestionEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_APP_URL: "https://preview.example.com",
        SEC_LOCAL_MANUAL_INGESTION_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
