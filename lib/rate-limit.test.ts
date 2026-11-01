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

  it("uses a stricter local limit for ordinary CRUD when Redis is unavailable", async () => {
    const store = {
      configured: true,
      fixedWindowRateLimit: vi
        .fn()
        .mockRejectedValue(new Error("Redis connection failed")),
    } as unknown as EphemeralStore;
    const localRateLimit = vi.fn().mockReturnValue({
      success: true,
      limit: 20,
      remaining: 19,
      resetAt: new Date(Date.now() + 60_000),
    });

    await expect(
      enforceRateLimit({
        category: "portfolioMutation",
        identifier: "user-a",
        store,
        environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
        localRateLimit,
      }),
    ).resolves.toMatchObject({
      bypassed: false,
      degraded: true,
      limit: 20,
      remaining: 19,
      success: true,
    });

    expect(localRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "portfolioMutation",
        identifier: "user-a",
        limit: 20,
        windowSeconds: 60,
      }),
    );
  });

  it("still rejects excess CRUD through the local fallback", async () => {
    const store = new EphemeralStore(null, {
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    const identifier = `ip:203.0.113.10:${Date.now()}`;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(
        enforceRateLimit({
          category: "portfolioMutation",
          identifier,
          store,
          environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
        }),
      ).resolves.toMatchObject({
        bypassed: false,
        degraded: true,
        limit: 20,
      });
    }

    await expect(
      enforceRateLimit({
        category: "portfolioMutation",
        identifier,
        store,
        environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({
      status: 429,
      headers: {
        "X-RateLimit-Limit": "20",
        "X-RateLimit-Remaining": "0",
      },
    });

    await expect(
      enforceRateLimit({
        category: "portfolioMutation",
        identifier: `${identifier}:distinct`,
        store,
        environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
      }),
    ).resolves.toMatchObject({
      degraded: true,
      remaining: 19,
      success: true,
    });
  });

  it("keeps costly and privileged mutations fail-closed", async () => {
    const store = {
      configured: true,
      fixedWindowRateLimit: vi
        .fn()
        .mockRejectedValue(new Error("Redis connection failed")),
    } as unknown as EphemeralStore;

    for (const category of ["researchGeneration", "adminIngestion"] as const) {
      await expect(
        enforceRateLimit({
          category,
          identifier: "user-a",
          store,
          environment: { NODE_ENV: "production" } as NodeJS.ProcessEnv,
        }),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
});
