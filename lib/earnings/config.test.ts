import { describe, expect, it } from "vitest";

import { getEarningsSyncConfig } from "@/lib/earnings/config";

const productionEnvironment = {
  EARNINGS_API_KEY: "server-key",
  EARNINGS_SYNC_ENABLED: "true",
  NODE_ENV: "production",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  UPSTASH_REDIS_REST_URL: "https://redis.invalid",
  VERCEL_ENV: "production",
} as NodeJS.ProcessEnv;

describe("earnings sync activation", () => {
  it("is default-off even in Production", () => {
    expect(
      getEarningsSyncConfig({
        ...productionEnvironment,
        EARNINGS_SYNC_ENABLED: undefined,
      }),
    ).toEqual({ enabled: false, reason: "DISABLED" });
  });

  it.each(["preview", "development", undefined])(
    "rejects live calls in VERCEL_ENV=%s",
    (vercelEnvironment) => {
      expect(
        getEarningsSyncConfig({
          ...productionEnvironment,
          VERCEL_ENV: vercelEnvironment,
        }),
      ).toEqual({ enabled: false, reason: "NON_PRODUCTION" });
    },
  );

  it("requires both the server key and Redis coordination", () => {
    expect(
      getEarningsSyncConfig({
        ...productionEnvironment,
        EARNINGS_API_KEY: "",
      }),
    ).toEqual({ enabled: false, reason: "MISSING_API_KEY" });
    expect(
      getEarningsSyncConfig({
        ...productionEnvironment,
        UPSTASH_REDIS_REST_TOKEN: "",
      }),
    ).toEqual({ enabled: false, reason: "MISSING_REDIS" });
  });

  it("enables the approved Production configuration only", () => {
    expect(getEarningsSyncConfig(productionEnvironment)).toEqual({
      enabled: true,
      apiKey: "server-key",
    });
  });
});
