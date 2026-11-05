import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { calculatePercentChange } from "@/lib/portfolio/calculations";
import {
  getDemoPortfolioAnalyticsByPeriods,
  getOwnedPortfolioAnalyticsByPeriods,
} from "@/lib/portfolio/analytics";
import {
  generateRiskAlerts,
  type RiskAlert,
  type WatchlistRiskInput,
} from "@/lib/portfolio/risk-alerts";

function toNumber(value: { toNumber: () => number } | number | null) {
  if (value === null) {
    return 0;
  }

  return typeof value === "number" ? value : value.toNumber();
}

function calculateMaxDailyMove(prices: { close: { toNumber: () => number } }[]) {
  return prices.reduce((maxMove, price, index) => {
    if (index === 0) {
      return maxMove;
    }

    const previousClose = toNumber(prices[index - 1].close);
    const currentClose = toNumber(price.close);

    return Math.max(
      maxMove,
      Math.abs(calculatePercentChange(previousClose, currentClose)),
    );
  }, 0);
}

async function getWatchlistRiskInputs(
  where: Prisma.WatchlistItemWhereInput,
): Promise<WatchlistRiskInput[]> {
  const items = await db.watchlistItem.findMany({
    where,
    include: {
      stock: {
        include: {
          prices: {
            orderBy: {
              timestamp: "desc",
            },
            take: 31,
          },
        },
      },
    },
    orderBy: {
      stock: {
        ticker: "asc",
      },
    },
  });

  return items.flatMap((item) => {
    const prices = [...item.stock.prices].reverse();
    const latest = prices.at(-1);
    const oneWeekStart = prices.at(-8) ?? prices[0];

    if (!latest || !oneWeekStart) {
      return [];
    }

    const latestPrice = toNumber(latest.close);
    const startPrice = toNumber(oneWeekStart.close);

    return {
      ticker: item.stock.ticker,
      companyName: item.stock.companyName,
      latestPrice,
      targetPrice: item.targetPrice ? toNumber(item.targetPrice) : null,
      oneWeekReturn: calculatePercentChange(startPrice, latestPrice),
      maxDailyMove: calculateMaxDailyMove(prices),
    };
  });
}

export async function getDemoRiskAlerts(): Promise<RiskAlert[]> {
  return getDemoRiskAlertsWithAnalytics(
    getDemoPortfolioAnalyticsByPeriods(["1M", "1D"]),
  );
}

export async function getDemoRiskAlertsWithAnalytics(
  analyticsByPeriodPromise: AnalyticsByPeriodPromise,
): Promise<RiskAlert[]> {
  return getRiskAlertsWithAnalytics(
    analyticsByPeriodPromise,
    { user: { isDemo: true } },
    "the demo portfolio",
  );
}

export async function getOwnedRiskAlerts(
  userId: string,
  portfolioId: string,
): Promise<RiskAlert[]> {
  return getOwnedRiskAlertsWithAnalytics(
    userId,
    getOwnedPortfolioAnalyticsByPeriods(userId, portfolioId, ["1M", "1D"]),
  );
}

// The same review signals the demo shows, computed for one owner's portfolio
// and watchlist. Nothing is stored; the signals follow the cached prices.
export async function getOwnedRiskAlertsWithAnalytics(
  userId: string,
  analyticsByPeriodPromise: AnalyticsByPeriodPromise,
): Promise<RiskAlert[]> {
  return getRiskAlertsWithAnalytics(
    analyticsByPeriodPromise,
    { userId },
    "your portfolio",
  );
}

type AnalyticsByPeriodPromise = ReturnType<
  typeof getDemoPortfolioAnalyticsByPeriods
>;

async function getRiskAlertsWithAnalytics(
  analyticsByPeriodPromise: AnalyticsByPeriodPromise,
  watchlistWhere: Prisma.WatchlistItemWhereInput,
  portfolioLabel: string,
): Promise<RiskAlert[]> {
  const [analyticsByPeriod, watchlistItems] = await Promise.all([
    analyticsByPeriodPromise,
    getWatchlistRiskInputs(watchlistWhere),
  ]);
  const oneMonthAnalytics = analyticsByPeriod.find(
    (analytics) => analytics?.period === "1M",
  );
  const oneDayAnalytics = analyticsByPeriod.find(
    (analytics) => analytics?.period === "1D",
  );

  if (!oneMonthAnalytics || !oneDayAnalytics) {
    return [];
  }

  return generateRiskAlerts({
    asOf: oneMonthAnalytics.asOf,
    holdings: oneMonthAnalytics.holdings,
    oneDayHoldings: oneDayAnalytics.holdings,
    oneMonthHoldings: oneMonthAnalytics.holdings,
    watchlistItems,
    portfolioLabel,
  });
}
