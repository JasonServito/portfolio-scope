import type {
  AllocationItem,
  Holding,
  PortfolioSummary,
  WinnerLoser,
} from "@/lib/portfolio/types";

export function calculateHoldingValue(holding: Holding) {
  return holding.shares * holding.currentPrice;
}

export function calculateGainLoss(marketValue: number, costBasis: number) {
  return marketValue - costBasis;
}

export function calculatePercentChange(startValue: number, endValue: number) {
  return startValue === 0 ? 0 : (endValue - startValue) / startValue;
}

export function calculateAllocationPercent(value: number, totalValue: number) {
  return totalValue === 0 ? 0 : value / totalValue;
}

export function calculateContributionPercent(
  holdingContribution: number,
  portfolioPeriodGainLoss: number,
) {
  return portfolioPeriodGainLoss === 0
    ? 0
    : holdingContribution / portfolioPeriodGainLoss;
}

export function calculatePortfolioSummary(holdings: Holding[]): PortfolioSummary {
  const marketValue = holdings.reduce(
    (total, holding) => total + calculateHoldingValue(holding),
    0,
  );
  const costBasis = holdings.reduce(
    (total, holding) => total + holding.shares * holding.averageCost,
    0,
  );
  const unrealizedGain = marketValue - costBasis;

  return {
    marketValue,
    costBasis,
    unrealizedGain,
    unrealizedGainPercent: costBasis === 0 ? 0 : unrealizedGain / costBasis,
  };
}

export function calculateAllocationItems<T>(
  items: T[],
  getKey: (item: T) => string,
  getLabel: (item: T) => string,
  getValue: (item: T) => number,
): AllocationItem[] {
  const totals = new Map<string, { label: string; value: number }>();

  for (const item of items) {
    const key = getKey(item);
    const previous = totals.get(key);
    totals.set(key, {
      label: previous?.label ?? getLabel(item),
      value: (previous?.value ?? 0) + getValue(item),
    });
  }

  const totalValue = Array.from(totals.values()).reduce(
    (total, item) => total + item.value,
    0,
  );

  return Array.from(totals.entries())
    .map(([key, item]) => ({
      key,
      label: item.label,
      value: item.value,
      percentage: calculateAllocationPercent(item.value, totalValue),
    }))
    .sort((a, b) => b.value - a.value);
}

export function rankWinnersAndLosers<T extends WinnerLoser>(
  holdings: T[],
  limit = 3,
) {
  const ranked = [...holdings].sort((a, b) => {
    const contributionDifference =
      b.dollarContribution - a.dollarContribution;

    if (contributionDifference !== 0) {
      return contributionDifference;
    }

    return b.periodReturn - a.periodReturn;
  });

  return {
    winners: ranked.slice(0, limit),
    losers: ranked.slice(-limit).reverse(),
  };
}
