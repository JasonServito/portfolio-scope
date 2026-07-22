import { afterEach, describe, expect, it, vi } from "vitest";

import { EphemeralStore } from "@/lib/cache/redis";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";

describe("API rate limiting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bypasses an unconfigured local cache but fails closed in production", async () => {
    const store = new EphemeralStore(null, {
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv);

    await expect(
      enforceRateLimit({
        category: "researchGeneration",
        identifier: "user-a",
        store,
        environment: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      }),
    ).resolves.toMatchObject({ success: true, bypassed: true });

    await expect(
      enforceRateLimit({
        category: "researchGeneration",
        identifier: "user-a",
        store,
        environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("returns controlled 429 metadata after the configured limit", async () => {
    const store = {
      configured: true,
      fixedWindowRateLimit: vi.fn().mockResolvedValue({
        success: false,
        limit: 3,
        remaining: 0,
        resetAt: new Date(Date.now() + 30_000),
      }),
    } as unknown as EphemeralStore;

    const error = await enforceRateLimit({
      category: "researchGeneration",
      identifier: "user-a",
      store,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      headers: { "X-RateLimit-Limit": "3", "X-RateLimit-Remaining": "0" },
    });
  });
});
