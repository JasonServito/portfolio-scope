import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { demoPortfolioName } from "@/lib/demo";
import {
  calculateAllocationItems,
  calculateAllocationPercent,
  calculateContributionPercent,
  calculateGainLoss,
  calculatePercentChange,
  rankWinnersAndLosers,
} from "@/lib/portfolio/calculations";
import { getPeriodStartDate } from "@/lib/portfolio/performance";
import type {
  HoldingAnalytics,
  PerformancePeriod,
  PortfolioAnalytics,
  SnapshotPoint,
} from "@/lib/portfolio/types";

const analyticsInclude = Prisma.validator<Prisma.PortfolioInclude>()({
  holdings: {
    include: {
      stock: true,
      snapshots: {
        orderBy: { timestamp: "asc" },
      },
    },
    orderBy: {
      stock: {
        ticker: "asc",
      },
    },
  },
  snapshots: {
    orderBy: { timestamp: "asc" },
  },
});

type AnalyticsPortfolio = Prisma.PortfolioGetPayload<{
  include: typeof analyticsInclude;
}>;

function toNumber(value: Prisma.Decimal | number) {
  return Number(value);
}

function toSnapshotPoint(snapshot: {
  timestamp: Date;
  totalValue: Prisma.Decimal;
}): SnapshotPoint {
  return {
    date: snapshot.timestamp.toISOString(),
    value: toNumber(snapshot.totalValue),
  };
}

function findSnapshotAtOrBefore<T extends { timestamp: Date }>(
  snapshots: T[],
  targetDate: Date,
) {
  return [...snapshots]
    .reverse()
    .find((snapshot) => snapshot.timestamp.getTime() <= targetDate.getTime());
}

function getLatestSnapshot<T extends { timestamp: Date }>(snapshots: T[]) {
  return snapshots.at(-1) ?? null;
}

function buildHoldingAnalytics(
  portfolio: AnalyticsPortfolio,
  periodStartDate: Date,
  periodEndValue: number,
  periodGainLoss: number,
): HoldingAnalytics[] {
  return portfolio.holdings.map((holding) => {
    const currentSnapshot = getLatestSnapshot(holding.snapshots);
    const periodStartSnapshot =
      findSnapshotAtOrBefore(holding.snapshots, periodStartDate) ??
      holding.snapshots[0] ??
      currentSnapshot;

    const currentPrice = currentSnapshot ? toNumber(currentSnapshot.price) : 0;
    const marketValue = currentSnapshot
      ? toNumber(currentSnapshot.marketValue)
      : 0;
    const costBasis = toNumber(holding.costBasis);
    const periodStartValue = periodStartSnapshot
      ? toNumber(periodStartSnapshot.marketValue)
      : 0;
    const dollarContribution = marketValue - periodStartValue;
    const totalGainLoss = calculateGainLoss(marketValue, costBasis);

    return {
      id: holding.id,
      ticker: holding.stock.ticker,
      companyName: holding.stock.companyName,
      sector: holding.stock.sector,
      shares: toNumber(holding.shares),
      averageCost: toNumber(holding.averageCost),
      costBasis,
      currentPrice,
      marketValue,
      allocationPercent: calculateAllocationPercent(
        marketValue,
        periodEndValue,
      ),
      periodStartValue,
      periodEndValue: marketValue,
      periodReturn: calculatePercentChange(periodStartValue, marketValue),
      dollarContribution,
      portfolioContributionPercent: calculateContributionPercent(
        dollarContribution,
        periodGainLoss,
      ),
      totalGainLoss,
      totalGainLossPercent: calculatePercentChange(costBasis, marketValue),
    };
  });
}

export async function getDemoPortfolioAnalytics(
  period: PerformancePeriod,
): Promise<PortfolioAnalytics | null> {
  const portfolio = await db.portfolio.findFirst({
    where: { name: demoPortfolioName },
    include: analyticsInclude,
  });

  if (!portfolio) {
    return null;
  }

  const currentSnapshot = getLatestSnapshot(portfolio.snapshots);

  if (!currentSnapshot) {
    return null;
  }

  const periodStartDate = getPeriodStartDate(currentSnapshot.timestamp, period);
  const periodStartSnapshot =
    findSnapshotAtOrBefore(portfolio.snapshots, periodStartDate) ??
    portfolio.snapshots[0] ??
    currentSnapshot;
  const performance = portfolio.snapshots
    .filter(
      (snapshot) =>
        snapshot.timestamp.getTime() >= periodStartSnapshot.timestamp.getTime(),
    )
    .map(toSnapshotPoint);

  const periodStartValue = toNumber(periodStartSnapshot.totalValue);
  const periodEndValue = toNumber(currentSnapshot.totalValue);
  const periodGainLoss = periodEndValue - periodStartValue;
  const holdings = buildHoldingAnalytics(
    portfolio,
    periodStartSnapshot.timestamp,
    periodEndValue,
    periodGainLoss,
  );
  const { winners, losers } = rankWinnersAndLosers(holdings);

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      baseCurrency: portfolio.baseCurrency,
    },
    period,
    asOf: currentSnapshot.timestamp.toISOString(),
    summary: {
      marketValue: periodEndValue,
      costBasis: toNumber(currentSnapshot.totalCostBasis),
      unrealizedGain: toNumber(currentSnapshot.totalGainLoss),
      unrealizedGainPercent: toNumber(currentSnapshot.totalGainLossPercent),
      periodStartValue,
      periodEndValue,
      periodReturn: calculatePercentChange(periodStartValue, periodEndValue),
      periodGainLoss,
    },
    holdings,
    allocationByHolding: calculateAllocationItems(
      holdings,
      (holding) => holding.ticker,
      (holding) => holding.ticker,
      (holding) => holding.marketValue,
    ),
    allocationBySector: calculateAllocationItems(
      holdings,
      (holding) => holding.sector,
      (holding) => holding.sector,
      (holding) => holding.marketValue,
    ),
    performance,
    topWinners: winners,
    topLosers: losers,
  };
}
