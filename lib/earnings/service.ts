import type { EarningsMarketSession } from "@prisma/client";

import { ephemeralStore, RedisUnavailableError } from "@/lib/cache/redis";
import { getEarningsSyncConfig } from "@/lib/earnings/config";
import { getMarketDate, toDateOnly } from "@/lib/earnings/dates";
import {
  EarningsApiClient,
  EarningsProviderError,
  type UpcomingEarningsProvider,
} from "@/lib/earnings/provider";
import {
  prismaEarningsRepository,
  type EarningsRepository,
  type FollowedStock,
} from "@/lib/earnings/repository";
import { logger } from "@/lib/observability/logger";
import {
  isSupportedTicker,
  supportedCompanies,
} from "@/lib/sec/company-registry";

export const EARNINGS_FRESH_AFTER_MS = 36 * 60 * 60 * 1_000;
export const EARNINGS_STALE_AFTER_MS = 72 * 60 * 60 * 1_000;
const DAILY_CLAIM_TTL_SECONDS = 48 * 60 * 60;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const EARNINGS_SOURCE = "EarningsAPI.com /v1/earnings";

export type EarningsSourceStatus =
  | "AVAILABLE"
  | "COORDINATION_UNAVAILABLE"
  | "DISABLED"
  | "PARTIAL_FAILURE";

export type UpcomingEarningsItem = {
  companyName: string;
  eventDate: string | null;
  fetchedAt: string | null;
  followedVia: Array<"HOLDING" | "WATCHLIST">;
  marketSession: EarningsMarketSession | null;
  source: string | null;
  state: "KNOWN" | "STALE" | "UNKNOWN" | "UNAVAILABLE" | "UNSUPPORTED";
  ticker: string;
};

export type UpcomingEarningsPageData = {
  items: UpcomingEarningsItem[];
  sourceStatus: EarningsSourceStatus;
};

export interface EarningsAttemptCoordinator {
  claim(ticker: string, marketDate: string): Promise<boolean>;
}

const redisAttemptCoordinator: EarningsAttemptCoordinator = {
  claim(ticker, marketDate) {
    return ephemeralStore.claimOnce(
      "earnings-daily-attempt",
      `${ticker}:${marketDate}`,
      DAILY_CLAIM_TTL_SECONDS,
    );
  },
};

type EarningsSweepCoordinator = {
  claim(marketDate: string): Promise<boolean>;
  readStatus(marketDate: string): Promise<EarningsSourceStatus | null>;
  writeStatus(
    marketDate: string,
    status: EarningsSourceStatus,
  ): Promise<boolean>;
};

type RefreshResult = {
  attempted: number;
  coordinationUnavailable: boolean;
  failed: number;
  missingCatalogTickers: string[];
  updated: number;
};

export async function refreshUpcomingEarningsCatalog(input: {
  coordinator: EarningsAttemptCoordinator;
  now: Date;
  provider: UpcomingEarningsProvider;
  repository: EarningsRepository;
}): Promise<RefreshResult> {
  const marketDate = getMarketDate(input.now);
  const expectedTickers = supportedCompanies.map(({ ticker }) => ticker);
  const stocks = await input.repository.listCatalogStocks(expectedTickers);
  const availableTickers = new Set(stocks.map(({ ticker }) => ticker));
  const missingCatalogTickers = expectedTickers.filter(
    (ticker) => !availableTickers.has(ticker),
  );

  const outcomes = await Promise.all(
    stocks.map(async (stock) => {
      let claimed: boolean;
      try {
        claimed = await input.coordinator.claim(stock.ticker, marketDate);
      } catch (error) {
        if (!(error instanceof RedisUnavailableError)) {
          logger.warn(
            "Unexpected earnings coordination failure.",
            { provider: "earningsapi", ticker: stock.ticker },
            error,
          );
        }
        return "COORDINATION_UNAVAILABLE" as const;
      }
      if (!claimed) return "SKIPPED" as const;

      try {
        const event = await input.provider.getUpcomingEvent(
          stock.ticker,
          marketDate,
        );
        await input.repository.saveState({
          eventDate: event?.eventDate ?? null,
          fetchedAt: input.now,
          marketSession: event?.marketSession ?? null,
          source: EARNINGS_SOURCE,
          stockId: stock.id,
        });
        return "UPDATED" as const;
      } catch (error) {
        logger.warn(
          "Upcoming earnings refresh failed; persisted state was preserved.",
          {
            errorCode:
              error instanceof EarningsProviderError
                ? error.code
                : "PERSISTENCE_OR_UNKNOWN_FAILURE",
            provider: "earningsapi",
            ticker: stock.ticker,
          },
          error,
        );
        return "FAILED" as const;
      }
    }),
  );

  return {
    attempted: outcomes.filter(
      (outcome) => outcome === "UPDATED" || outcome === "FAILED",
    ).length,
    coordinationUnavailable: outcomes.includes("COORDINATION_UNAVAILABLE"),
    failed: outcomes.filter((outcome) => outcome === "FAILED").length,
    missingCatalogTickers,
    updated: outcomes.filter((outcome) => outcome === "UPDATED").length,
  };
}

async function refreshCatalogIfEnabled(
  now: Date,
  repository: EarningsRepository,
): Promise<EarningsSourceStatus> {
  const config = getEarningsSyncConfig();
  if (!config.enabled) return "DISABLED";

  try {
    return await refreshCatalogOnce({
      attemptCoordinator: redisAttemptCoordinator,
      now,
      provider: new EarningsApiClient(config.apiKey),
      repository,
      sweepCoordinator: {
        claim: (marketDate) =>
          ephemeralStore.claimOnce(
            "earnings-daily-catalog-sweep",
            marketDate,
            DAILY_CLAIM_TTL_SECONDS,
          ),
        readStatus: (marketDate) =>
          ephemeralStore.getJson<EarningsSourceStatus>(
            "earnings-daily-catalog-status",
            marketDate,
          ),
        writeStatus: (marketDate, status) =>
          ephemeralStore.setJson(
            "earnings-daily-catalog-status",
            marketDate,
            status,
            DAILY_CLAIM_TTL_SECONDS,
          ),
      },
    });
  } catch (error) {
    logger.warn(
      "Upcoming earnings catalog refresh was unavailable; persisted state will be served.",
      { provider: "earningsapi" },
      error,
    );
    return "PARTIAL_FAILURE";
  }
}

export async function refreshCatalogOnce(input: {
  attemptCoordinator: EarningsAttemptCoordinator;
  now: Date;
  provider: UpcomingEarningsProvider;
  repository: EarningsRepository;
  sweepCoordinator: EarningsSweepCoordinator;
}): Promise<EarningsSourceStatus> {
  const marketDate = getMarketDate(input.now);
  let shouldSweep: boolean;
  try {
    shouldSweep = await input.sweepCoordinator.claim(marketDate);
  } catch (error) {
    if (!(error instanceof RedisUnavailableError)) {
      logger.warn(
        "Unexpected earnings catalog sweep coordination failure.",
        { provider: "earningsapi" },
        error,
      );
    }
    return "COORDINATION_UNAVAILABLE";
  }
  if (!shouldSweep) {
    try {
      return (
        (await input.sweepCoordinator.readStatus(marketDate)) ??
        "PARTIAL_FAILURE"
      );
    } catch {
      return "COORDINATION_UNAVAILABLE";
    }
  }

  const result = await refreshUpcomingEarningsCatalog({
    coordinator: input.attemptCoordinator,
    now: input.now,
    provider: input.provider,
    repository: input.repository,
  });
  const status = result.coordinationUnavailable
    ? "COORDINATION_UNAVAILABLE"
    : result.failed > 0 || result.missingCatalogTickers.length > 0
      ? "PARTIAL_FAILURE"
      : "AVAILABLE";
  try {
    await input.sweepCoordinator.writeStatus(marketDate, status);
  } catch {
    // The retained sweep claim still prevents a same-day provider retry. A
    // later reader without an outcome will conservatively show partial failure.
  }
  return status;
}

async function pruneExpiredEarningsStates(
  now: Date,
  repository: EarningsRepository,
) {
  try {
    await repository.deleteStatesFetchedBefore(
      new Date(now.getTime() - EARNINGS_STALE_AFTER_MS),
    );
  } catch (error) {
    logger.warn(
      "Expired upcoming earnings observations could not be pruned.",
      { provider: "earningsapi" },
      error,
    );
  }
}

export function presentUpcomingEarnings(
  followedStocks: readonly FollowedStock[],
  now = new Date(),
): UpcomingEarningsItem[] {
  const marketDate = getMarketDate(now);
  const byTicker = new Map<
    string,
    Omit<UpcomingEarningsItem, "followedVia" | "state"> & {
      followedVia: Set<"HOLDING" | "WATCHLIST">;
      persistedState: FollowedStock["state"];
    }
  >();

  for (const stock of followedStocks) {
    const existing = byTicker.get(stock.ticker);
    if (existing) {
      existing.followedVia.add(stock.followedVia);
      continue;
    }
    byTicker.set(stock.ticker, {
      companyName: stock.companyName,
      eventDate: stock.state?.eventDate
        ? toDateOnly(stock.state.eventDate)
        : null,
      fetchedAt: stock.state?.fetchedAt.toISOString() ?? null,
      followedVia: new Set([stock.followedVia]),
      marketSession: stock.state?.marketSession ?? null,
      persistedState: stock.state,
      source: stock.state?.source ?? null,
      ticker: stock.ticker,
    });
  }

  return [...byTicker.values()]
    .map(({ followedVia, persistedState, ...item }): UpcomingEarningsItem => {
      if (!isSupportedTicker(item.ticker)) {
        return {
          ...item,
          eventDate: null,
          fetchedAt: null,
          followedVia: [...followedVia].sort(),
          marketSession: null,
          source: null,
          state: "UNSUPPORTED",
        };
      }
      if (!persistedState) {
        return {
          ...item,
          followedVia: [...followedVia].sort(),
          state: "UNAVAILABLE",
        };
      }

      const age = now.getTime() - persistedState.fetchedAt.getTime();
      if (age > EARNINGS_STALE_AFTER_MS || age < -MAX_FUTURE_CLOCK_SKEW_MS) {
        return {
          ...item,
          eventDate: null,
          followedVia: [...followedVia].sort(),
          marketSession: null,
          state: "UNAVAILABLE",
        };
      }
      if (!item.eventDate || item.eventDate < marketDate) {
        return {
          ...item,
          eventDate: null,
          followedVia: [...followedVia].sort(),
          marketSession: null,
          state: "UNKNOWN",
        };
      }

      return {
        ...item,
        followedVia: [...followedVia].sort(),
        state: age > EARNINGS_FRESH_AFTER_MS ? "STALE" : "KNOWN",
      };
    })
    .sort((left, right) => {
      if (left.eventDate && right.eventDate) {
        return (
          left.eventDate.localeCompare(right.eventDate) ||
          left.ticker.localeCompare(right.ticker)
        );
      }
      if (left.eventDate) return -1;
      if (right.eventDate) return 1;
      return left.ticker.localeCompare(right.ticker);
    });
}

export async function getUserUpcomingEarnings(
  userId: string,
  options: { now?: Date; repository?: EarningsRepository } = {},
): Promise<UpcomingEarningsPageData> {
  const now = options.now ?? new Date();
  const repository = options.repository ?? prismaEarningsRepository;
  await pruneExpiredEarningsStates(now, repository);
  const sourceStatus = await refreshCatalogIfEnabled(now, repository);
  const followedStocks = await repository.listFollowedStocks(userId);
  return { items: presentUpcomingEarnings(followedStocks, now), sourceStatus };
}

export async function getDemoUpcomingEarnings(
  options: { now?: Date; repository?: EarningsRepository } = {},
): Promise<UpcomingEarningsPageData> {
  const now = options.now ?? new Date();
  const repository = options.repository ?? prismaEarningsRepository;
  await pruneExpiredEarningsStates(now, repository);
  const sourceStatus = await refreshCatalogIfEnabled(now, repository);
  const followedStocks = await repository.listDemoFollowedStocks();
  return { items: presentUpcomingEarnings(followedStocks, now), sourceStatus };
}
