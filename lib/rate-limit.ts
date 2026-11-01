import {
  buildRedisKey,
  EphemeralStore,
  RedisUnavailableError,
  ephemeralStore,
} from "@/lib/cache/redis";

export const rateLimitPolicies = {
  portfolioMutation: {
    limit: 60,
    windowSeconds: 60,
    failureMode: "local-fallback",
  },
  researchGeneration: {
    limit: 3,
    windowSeconds: 600,
    failureMode: "closed",
  },
  adminIngestion: {
    limit: 5,
    windowSeconds: 600,
    failureMode: "closed",
  },
  workerCallback: {
    limit: 300,
    windowSeconds: 60,
    failureMode: "closed",
  },
  publicStock: {
    limit: 120,
    windowSeconds: 60,
    failureMode: "open",
  },
} as const;

export type RateLimitCategory = keyof typeof rateLimitPolicies;

export class RateLimitError extends Error {
  readonly name = "RateLimitError";

  constructor(
    public readonly status: 429 | 503,
    message: string,
    public readonly headers: Record<string, string> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

type LocalRateLimit = (input: {
  category: RateLimitCategory;
  identifier: string;
  limit: number;
  windowSeconds: number;
  environment: NodeJS.ProcessEnv;
}) => RateLimitResult;

const localWindows = new Map<string, { count: number; resetAt: number }>();
const LOCAL_PORTFOLIO_MUTATION_LIMIT = 20;

const enforceLocalRateLimit: LocalRateLimit = (input) => {
  const now = Date.now();
  const key = buildRedisKey(
    `local-rate:${input.category}`,
    input.identifier,
    input.environment,
  );
  const current = localWindows.get(key);
  const window =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + input.windowSeconds * 1_000 }
      : current;

  window.count += 1;
  localWindows.set(key, window);

  if (localWindows.size > 10_000) {
    for (const [candidateKey, candidate] of localWindows) {
      if (candidate.resetAt <= now) localWindows.delete(candidateKey);
    }
    while (localWindows.size > 10_000) {
      const oldestKey = localWindows.keys().next().value;
      if (oldestKey === undefined) break;
      localWindows.delete(oldestKey);
    }
  }

  return {
    success: window.count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - window.count),
    resetAt: new Date(window.resetAt),
  };
};

function assertRateLimit(result: RateLimitResult) {
  if (result.success) return;

  const retryAfter = Math.max(
    1,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000),
  );
  throw new RateLimitError(429, "Too many requests. Please try again later.", {
    "Retry-After": String(retryAfter),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1_000)),
  });
}

export async function enforceRateLimit(input: {
  category: RateLimitCategory;
  identifier: string;
  store?: EphemeralStore;
  environment?: NodeJS.ProcessEnv;
  localRateLimit?: LocalRateLimit;
}) {
  const environment = input.environment ?? process.env;
  const store = input.store ?? ephemeralStore;
  const policy = rateLimitPolicies[input.category];

  if (!store.configured && environment.NODE_ENV !== "production") {
    return {
      success: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: new Date(),
      bypassed: true,
    };
  }

  const applyLocalFallback = () => {
    const result = (input.localRateLimit ?? enforceLocalRateLimit)({
      category: input.category,
      identifier: input.identifier,
      limit: Math.min(policy.limit, LOCAL_PORTFOLIO_MUTATION_LIMIT),
      windowSeconds: policy.windowSeconds,
      environment,
    });
    assertRateLimit(result);
    return { ...result, bypassed: false, degraded: true };
  };

  if (!store.configured && policy.failureMode === "local-fallback") {
    return applyLocalFallback();
  }

  try {
    const result = await store.fixedWindowRateLimit({
      category: input.category,
      identifier: input.identifier,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    });

    assertRateLimit(result);

    return { ...result, bypassed: false, degraded: false };
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (policy.failureMode === "local-fallback") return applyLocalFallback();
    if (policy.failureMode === "closed") {
      throw new RateLimitError(
        503,
        "Request limits are temporarily unavailable.",
        { "Retry-After": "30" },
        {
          cause:
            error instanceof RedisUnavailableError
              ? error
              : new RedisUnavailableError("Redis rate limiting failed.", {
                  cause: error,
                }),
        },
      );
    }

    return {
      success: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: new Date(),
      bypassed: true,
    };
  }
}

export function getRequestIp(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function enforcePortfolioMutationLimits(
  request: Request,
  userId: string,
) {
  return Promise.all([
    enforceRateLimit({
      category: "portfolioMutation",
      identifier: `user:${userId}`,
    }),
    enforceRateLimit({
      category: "portfolioMutation",
      identifier: `ip:${getRequestIp(request)}`,
    }),
  ]);
}
