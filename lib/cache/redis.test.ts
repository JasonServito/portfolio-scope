import { describe, expect, it } from "vitest";

import {
  EphemeralStore,
  RedisUnavailableError,
  buildRedisKey,
  type RedisCommands,
} from "@/lib/cache/redis";

class FakeRedis implements RedisCommands {
  readonly values = new Map<string, unknown>();
  count = 0;
  ttl = 60;

  async get<T>(key: string) {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(
    key: string,
    value: T,
    options?: { nx?: boolean; ex?: number },
  ) {
    void options?.ex;
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK" as const;
  }

  async del(...keys: string[]) {
    return keys.reduce((count, key) => count + Number(this.values.delete(key)), 0);
  }

  async eval<TResult>(script: string, keys: string[], args: string[]) {
    if (script.includes('redis.call("TIME")')) return 125 as TResult;
    if (args.length === 1 && Number.isFinite(Number(args[0]))) {
      this.count += 1;
      return [this.count, this.ttl] as TResult;
    }
    const released = this.values.get(keys[0]) === args[0];
    if (released) this.values.delete(keys[0]);
    return Number(released) as TResult;
  }
}

describe("Redis ephemeral store", () => {
  const environment = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

  it("namespaces and hashes private identifiers", () => {
    const key = buildRedisKey("fundamentals", "user@example.com:AAPL", environment);
    expect(key).toMatch(/^portfolioscope:test:fundamentals:[a-f0-9]{32}$/);
    expect(key).not.toContain("user@example.com");
  });

  it("uses token-checked locks so one worker cannot release another lock", async () => {
    const client = new FakeRedis();
    const store = new EphemeralStore(client, environment);
    const first = await store.acquireLock("sec", "company-a", 30);
    const second = await store.acquireLock("sec", "company-a", 30);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    if (!first.acquired) throw new Error("Expected the first lock.");
    await expect(store.releaseLock("sec", "company-a", "wrong")).resolves.toBe(
      false,
    );
    await expect(
      store.releaseLock("sec", "company-a", first.token),
    ).resolves.toBe(true);
  });

  it("returns fixed-window limits and controlled recovery", async () => {
    const store = new EphemeralStore(new FakeRedis(), environment);
    await expect(
      store.fixedWindowRateLimit({
        category: "research",
        identifier: "user-a",
        limit: 1,
        windowSeconds: 60,
      }),
    ).resolves.toMatchObject({ success: true, remaining: 0 });
    await expect(
      store.fixedWindowRateLimit({
        category: "research",
        identifier: "user-a",
        limit: 1,
        windowSeconds: 60,
      }),
    ).resolves.toMatchObject({ success: false, remaining: 0 });
  });

  it("returns an atomic cross-instance interval permit", async () => {
    const store = new EphemeralStore(new FakeRedis(), environment);
    await expect(
      store.acquireIntervalPermit({
        category: "sec-provider",
        identifier: "global",
        intervalMs: 125,
      }),
    ).resolves.toEqual({ delayMs: 125, unavailable: false });
  });

  it("degrades cache reads but fails explicit rate limits when unconfigured", async () => {
    const store = new EphemeralStore(null, environment);
    await expect(store.getJson("cache", "key")).resolves.toBeNull();
    await expect(
      store.fixedWindowRateLimit({
        category: "research",
        identifier: "user-a",
        limit: 1,
        windowSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(RedisUnavailableError);
  });
});
