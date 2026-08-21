import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

export const cachePolicies = {
  publicCompanyMetadata: { ttlSeconds: 86_400, staleAllowed: true },
  normalizedFundamentals: { ttlSeconds: 300, staleAllowed: true },
  researchReport: { ttlSeconds: 1_800, staleAllowed: true },
  secSource: { ttlSeconds: 21_600, staleAllowed: false },
  supportedTickerRegistry: { ttlSeconds: 86_400, staleAllowed: true },
  dataFreshness: { ttlSeconds: 86_400, staleAllowed: true },
} as const;

type SetOptions = {
  ex?: number;
  nx?: boolean;
};

export interface RedisCommands {
  get<TData = unknown>(key: string): Promise<TData | null>;
  set<TData = unknown>(
    key: string,
    value: TData,
    options?: SetOptions,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  eval<TResult = unknown>(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<TResult>;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`;

const INTERVAL_PERMIT_SCRIPT = `
local redisTime = redis.call("TIME")
local nowMs = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
local nextAllowedMs = tonumber(redis.call("GET", KEYS[1]) or "0")
local allowedAtMs = math.max(nowMs, nextAllowedMs)
local delayMs = allowedAtMs - nowMs
local intervalMs = tonumber(ARGV[1])
redis.call("SET", KEYS[1], allowedAtMs + intervalMs, "PX", math.max(1000, intervalMs * 20))
return delayMs
`;

export class RedisUnavailableError extends Error {
  readonly name = "RedisUnavailableError";
}

function environmentPrefix(environment: NodeJS.ProcessEnv = process.env) {
  const environmentName =
    environment.VERCEL_ENV?.trim() ||
    environment.NODE_ENV?.trim() ||
    "development";
  return `portfolioscope:${environmentName.toLowerCase()}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function buildRedisKey(
  category: string,
  identifier: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9:_-]/g, "-");
  return `${environmentPrefix(environment)}:${safeCategory}:${digest(identifier)}`;
}

export function isRedisConfigured(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Boolean(
    environment.UPSTASH_REDIS_REST_URL?.trim() &&
    environment.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

let sharedRedis: Redis | undefined;

export function getRedis(environment: NodeJS.ProcessEnv = process.env) {
  if (!isRedisConfigured(environment)) return null;

  sharedRedis ??= new Redis({
    url: environment.UPSTASH_REDIS_REST_URL!,
    token: environment.UPSTASH_REDIS_REST_TOKEN!,
    enableAutoPipelining: true,
  });
  return sharedRedis;
}

export class EphemeralStore {
  constructor(
    private readonly client: RedisCommands | null = getRedis(),
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  get configured() {
    return this.client !== null;
  }

  key(category: string, identifier: string) {
    return buildRedisKey(category, identifier, this.environment);
  }

  async getJson<T>(category: string, identifier: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      return await this.client.get<T>(this.key(category, identifier));
    } catch {
      return null;
    }
  }

  async setJson(
    category: string,
    identifier: string,
    value: unknown,
    ttlSeconds: number,
  ) {
    if (!this.client) return false;
    try {
      await this.client.set(this.key(category, identifier), value, {
        ex: ttlSeconds,
      });
      return true;
    } catch {
      return false;
    }
  }

  async invalidate(category: string, identifier: string) {
    if (!this.client) return false;
    try {
      await this.client.del(this.key(category, identifier));
      return true;
    } catch {
      return false;
    }
  }

  async acquireLock(category: string, identifier: string, ttlSeconds: number) {
    if (!this.client) {
      return { acquired: false as const, unavailable: true as const };
    }

    const token = randomUUID();
    try {
      const result = await this.client.set(
        this.key(`lock:${category}`, identifier),
        token,
        { ex: ttlSeconds, nx: true },
      );
      return result === "OK"
        ? { acquired: true as const, token }
        : { acquired: false as const, unavailable: false as const };
    } catch {
      return { acquired: false as const, unavailable: true as const };
    }
  }

  async claimOnce(category: string, identifier: string, ttlSeconds: number) {
    if (!this.client) {
      throw new RedisUnavailableError("Redis is not configured.");
    }

    try {
      const result = await this.client.set(
        this.key(`claim:${category}`, identifier),
        "claimed",
        { ex: ttlSeconds, nx: true },
      );
      return result === "OK";
    } catch (error) {
      if (error instanceof RedisUnavailableError) throw error;
      throw new RedisUnavailableError(
        "Redis claim coordination is unavailable.",
        {
          cause: error,
        },
      );
    }
  }

  async releaseLock(category: string, identifier: string, token: string) {
    if (!this.client) return false;
    try {
      const released = await this.client.eval<number>(
        RELEASE_LOCK_SCRIPT,
        [this.key(`lock:${category}`, identifier)],
        [token],
      );
      return released === 1;
    } catch {
      return false;
    }
  }

  async fixedWindowRateLimit(input: {
    category: string;
    identifier: string;
    limit: number;
    windowSeconds: number;
  }) {
    if (!this.client)
      throw new RedisUnavailableError("Redis is not configured.");

    try {
      const result = await this.client.eval<[number, number]>(
        RATE_LIMIT_SCRIPT,
        [this.key(`rate:${input.category}`, input.identifier)],
        [String(input.windowSeconds)],
      );
      const count = Number(result[0]);
      const ttl = Math.max(0, Number(result[1]));
      return {
        success: count <= input.limit,
        limit: input.limit,
        remaining: Math.max(0, input.limit - count),
        resetAt: new Date(Date.now() + ttl * 1000),
      };
    } catch (error) {
      if (error instanceof RedisUnavailableError) throw error;
      throw new RedisUnavailableError("Redis rate limiting is unavailable.", {
        cause: error,
      });
    }
  }

  async acquireIntervalPermit(input: {
    category: string;
    identifier: string;
    intervalMs: number;
  }) {
    if (!this.client) {
      return { delayMs: 0, unavailable: true as const };
    }

    try {
      const delayMs = await this.client.eval<number>(
        INTERVAL_PERMIT_SCRIPT,
        [this.key(`interval:${input.category}`, input.identifier)],
        [String(Math.max(1, Math.floor(input.intervalMs)))],
      );
      return {
        delayMs: Math.max(0, Number(delayMs)),
        unavailable: false as const,
      };
    } catch {
      return { delayMs: 0, unavailable: true as const };
    }
  }
}

export const ephemeralStore = new EphemeralStore();
