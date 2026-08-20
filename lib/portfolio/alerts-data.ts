import { db } from "@/lib/db";
import { calculatePercentChange } from "@/lib/portfolio/calculations";
import { getDemoPortfolioAnalyticsByPeriods } from "@/lib/portfolio/analytics";
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

async function getWatchlistRiskInputs(): Promise<WatchlistRiskInput[]> {
  const items = await db.watchlistItem.findMany({
    where: {
      user: { isDemo: true },
    },
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
  analyticsByPeriodPromise: ReturnType<
    typeof getDemoPortfolioAnalyticsByPeriods
  >,
): Promise<RiskAlert[]> {
  const [analyticsByPeriod, watchlistItems] = await Promise.all([
    analyticsByPeriodPromise,
    getWatchlistRiskInputs(),
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
  });
}
