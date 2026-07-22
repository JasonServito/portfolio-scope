import {
  EphemeralStore,
  RedisUnavailableError,
  ephemeralStore,
} from "@/lib/cache/redis";

export const rateLimitPolicies = {
  portfolioMutation: { limit: 60, windowSeconds: 60, failClosed: true },
  researchGeneration: { limit: 3, windowSeconds: 600, failClosed: true },
  adminIngestion: { limit: 5, windowSeconds: 600, failClosed: true },
  workerCallback: { limit: 300, windowSeconds: 60, failClosed: true },
  publicStock: { limit: 120, windowSeconds: 60, failClosed: false },
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

export async function enforceRateLimit(input: {
  category: RateLimitCategory;
  identifier: string;
  store?: EphemeralStore;
  environment?: NodeJS.ProcessEnv;
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

  try {
    const result = await store.fixedWindowRateLimit({
      category: input.category,
      identifier: input.identifier,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    });

    if (!result.success) {
      const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
      );
      throw new RateLimitError(429, "Too many requests. Please try again later.", {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1000)),
      });
    }

    return { ...result, bypassed: false };
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (policy.failClosed) {
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
