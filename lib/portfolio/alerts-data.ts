import { db } from "@/lib/db";
import { demoPortfolioName } from "@/lib/demo";
import { calculatePercentChange } from "@/lib/portfolio/calculations";
import { getDemoPortfolioAnalytics } from "@/lib/portfolio/analytics";
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
      user: {
        portfolios: {
          some: {
            name: demoPortfolioName,
          },
        },
      },
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
  const [baseAnalytics, oneDayAnalytics, oneMonthAnalytics, watchlistItems] =
    await Promise.all([
      getDemoPortfolioAnalytics("1M"),
      getDemoPortfolioAnalytics("1D"),
      getDemoPortfolioAnalytics("1M"),
      getWatchlistRiskInputs(),
    ]);

  if (!baseAnalytics || !oneDayAnalytics || !oneMonthAnalytics) {
    return [];
  }

  return generateRiskAlerts({
    asOf: baseAnalytics.asOf,
    holdings: baseAnalytics.holdings,
    oneDayHoldings: oneDayAnalytics.holdings,
    oneMonthHoldings: oneMonthAnalytics.holdings,
    watchlistItems,
  });
}
