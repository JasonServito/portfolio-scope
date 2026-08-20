import { db } from "@/lib/db";
import { demoPortfolioName } from "@/lib/demo";
import { calculatePercentChange } from "@/lib/portfolio/calculations";
import { getDemoRiskAlertsWithAnalytics } from "@/lib/portfolio/alerts-data";
import { getDemoPortfolioAnalyticsByPeriods } from "@/lib/portfolio/analytics";
import { getPeriodStartDate } from "@/lib/portfolio/performance";
import {
  PERFORMANCE_PERIODS,
  type PerformancePeriod,
  type SnapshotPoint,
} from "@/lib/portfolio/types";

function toNumber(value: { toNumber: () => number } | number | null) {
  if (value === null) {
    return 0;
  }

  return typeof value === "number" ? value : value.toNumber();
}

function findPriceAtOrBefore<T extends { timestamp: Date }>(
  prices: T[],
  targetDate: Date,
) {
  return [...prices]
    .reverse()
    .find((price) => price.timestamp.getTime() <= targetDate.getTime());
}

export type StockDetailData = {
  stock: {
    ticker: string;
    companyName: string;
    sector: string;
    industry: string;
    exchange: string;
    currency: string;
  };
  latestPrice: number | null;
  asOf: string | null;
  priceChart: SnapshotPoint[];
  periodReturns: Record<PerformancePeriod, number | null>;
  position: {
    shares: number;
    averageCost: number;
    marketValue: number;
    costBasis: number;
    totalGainLoss: number;
    totalGainLossPercent: number;
    allocationPercent: number;
  } | null;
  watchlist: {
    targetPrice: number | null;
    notes: string | null;
  } | null;
  relatedAlerts: Awaited<ReturnType<typeof getDemoRiskAlertsWithAnalytics>>;
};

export async function getDemoStockDetail(
  ticker: string,
): Promise<StockDetailData | null> {
  const symbol = ticker.toUpperCase();
  const analyticsByPeriodPromise =
    getDemoPortfolioAnalyticsByPeriods(PERFORMANCE_PERIODS);
  const [stock, alerts, analyticsByPeriod] = await Promise.all([
    db.stock.findUnique({
      where: {
        ticker: symbol,
      },
      include: {
        holdings: {
          where: {
            portfolio: {
              name: demoPortfolioName,
              user: { isDemo: true },
            },
          },
        },
        prices: {
          orderBy: {
            timestamp: "asc",
          },
        },
        watchlistItems: {
          where: {
            user: { isDemo: true },
          },
        },
      },
    }),
    getDemoRiskAlertsWithAnalytics(analyticsByPeriodPromise),
    analyticsByPeriodPromise,
  ]);

  if (!stock) {
    return null;
  }

  const latestPrice = stock.prices.at(-1);

  const periodReturns = Object.fromEntries(
    PERFORMANCE_PERIODS.map((period, index) => {
      const analytics = analyticsByPeriod[index];
      const holdingReturn = analytics?.holdings.find(
        (holding) => holding.ticker === symbol,
      )?.periodReturn;

      if (holdingReturn !== undefined) {
        return [period, holdingReturn];
      }

      if (!latestPrice || stock.prices.length === 0) {
        return [period, null];
      }

      const periodStartDate = getPeriodStartDate(latestPrice.timestamp, period);
      const periodStartPrice =
        findPriceAtOrBefore(stock.prices, periodStartDate) ?? stock.prices[0];

      return [
        period,
        calculatePercentChange(
          toNumber(periodStartPrice.close),
          toNumber(latestPrice.close),
        ),
      ];
    }),
  ) as Record<PerformancePeriod, number | null>;

  const oneMonthAnalytics =
    analyticsByPeriod[PERFORMANCE_PERIODS.indexOf("1M")];
  const holdingAnalytics = oneMonthAnalytics?.holdings.find(
    (holding) => holding.ticker === symbol,
  );
  const holding = stock.holdings[0];
  const watchlistItem = stock.watchlistItems[0];

  return {
    stock: {
      ticker: stock.ticker,
      companyName: stock.companyName,
      sector: stock.sector,
      industry: stock.industry,
      exchange: stock.exchange,
      currency: stock.currency,
    },
    latestPrice: latestPrice ? toNumber(latestPrice.close) : null,
    asOf: latestPrice?.timestamp.toISOString() ?? null,
    priceChart: stock.prices.slice(-90).map((price) => ({
      date: price.timestamp.toISOString(),
      value: toNumber(price.close),
    })),
    periodReturns,
    position:
      holding && holdingAnalytics
        ? {
            shares: toNumber(holding.shares),
            averageCost: toNumber(holding.averageCost),
            marketValue: holdingAnalytics.marketValue,
            costBasis: holdingAnalytics.costBasis,
            totalGainLoss: holdingAnalytics.totalGainLoss,
            totalGainLossPercent: holdingAnalytics.totalGainLossPercent,
            allocationPercent: holdingAnalytics.allocationPercent,
          }
        : null,
    watchlist: watchlistItem
      ? {
          targetPrice: watchlistItem.targetPrice
            ? toNumber(watchlistItem.targetPrice)
            : null,
          notes: watchlistItem.notes,
        }
      : null,
    relatedAlerts: alerts.filter((alert) => alert.ticker === symbol),
  };
}
