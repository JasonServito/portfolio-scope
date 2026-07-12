import type { HoldingAnalytics } from "@/lib/portfolio/types";

export type RiskAlertSeverity = "LOW" | "MEDIUM" | "HIGH";

export type RiskAlertType =
  | "CONCENTRATION"
  | "DRAWDOWN"
  | "PRICE_MOVE"
  | "VOLATILITY"
  | "WATCHLIST_MOVE";

export type RiskAlertStatus = "ACTIVE" | "RESOLVED";

export type RiskAlert = {
  id: string;
  ticker: string;
  companyName: string;
  type: RiskAlertType;
  severity: RiskAlertSeverity;
  title: string;
  message: string;
  status: RiskAlertStatus;
  createdAt: string;
  metricLabel: string;
  metricValue: number;
  href: string;
};

export type WatchlistRiskInput = {
  ticker: string;
  companyName: string;
  latestPrice: number;
  targetPrice: number | null;
  oneWeekReturn: number;
  maxDailyMove: number;
};

export type RiskAlertInput = {
  asOf: string;
  holdings: HoldingAnalytics[];
  oneDayHoldings: HoldingAnalytics[];
  oneMonthHoldings: HoldingAnalytics[];
  watchlistItems: WatchlistRiskInput[];
};

function createAlert(
  input: Omit<RiskAlert, "id" | "status" | "href">,
): RiskAlert {
  return {
    ...input,
    id: `${input.type}:${input.ticker}`,
    status: "ACTIVE",
    href: `/stocks/${input.ticker.toLowerCase()}`,
  };
}

function getSeverity(value: number, mediumThreshold: number, highThreshold: number) {
  if (value >= highThreshold) {
    return "HIGH";
  }

  if (value >= mediumThreshold) {
    return "MEDIUM";
  }

  return null;
}

export function generateRiskAlerts(input: RiskAlertInput): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const oneDayByTicker = new Map(
    input.oneDayHoldings.map((holding) => [holding.ticker, holding]),
  );
  const oneMonthByTicker = new Map(
    input.oneMonthHoldings.map((holding) => [holding.ticker, holding]),
  );

  for (const holding of input.holdings) {
    const concentrationSeverity = getSeverity(
      holding.allocationPercent,
      0.18,
      0.25,
    );

    if (concentrationSeverity) {
      alerts.push(
        createAlert({
          createdAt: input.asOf,
          ticker: holding.ticker,
          companyName: holding.companyName,
          type: "CONCENTRATION",
          severity: concentrationSeverity,
          title: `${holding.ticker} allocation is above the risk band`,
          message: `${holding.companyName} represents ${(holding.allocationPercent * 100).toFixed(1)}% of the demo portfolio, above the 18% concentration review threshold.`,
          metricLabel: "Portfolio weight",
          metricValue: holding.allocationPercent,
        }),
      );
    }

    const oneMonthHolding = oneMonthByTicker.get(holding.ticker);
    const drawdown = Math.abs(Math.min(oneMonthHolding?.periodReturn ?? 0, 0));
    const drawdownSeverity = getSeverity(drawdown, 0.05, 0.08);

    if (drawdownSeverity) {
      alerts.push(
        createAlert({
          createdAt: input.asOf,
          ticker: holding.ticker,
          companyName: holding.companyName,
          type: "DRAWDOWN",
          severity: drawdownSeverity,
          title: `${holding.ticker} one-month drawdown needs review`,
          message: `${holding.companyName} is down ${(drawdown * 100).toFixed(1)}% over the seeded one-month window.`,
          metricLabel: "1M drawdown",
          metricValue: drawdown,
        }),
      );
    }

    const oneDayHolding = oneDayByTicker.get(holding.ticker);
    const dailyMove = Math.abs(oneDayHolding?.periodReturn ?? 0);
    const dailyMoveSeverity = getSeverity(dailyMove, 0.025, 0.04);

    if (dailyMoveSeverity) {
      alerts.push(
        createAlert({
          createdAt: input.asOf,
          ticker: holding.ticker,
          companyName: holding.companyName,
          type: "PRICE_MOVE",
          severity: dailyMoveSeverity,
          title: `${holding.ticker} moved sharply in the latest session`,
          message: `${holding.companyName} moved ${(dailyMove * 100).toFixed(1)}% in the latest seeded trading session.`,
          metricLabel: "1D move",
          metricValue: dailyMove,
        }),
      );
    }
  }

  for (const item of input.watchlistItems) {
    const watchlistMove = Math.abs(item.oneWeekReturn);
    const watchlistSeverity = getSeverity(watchlistMove, 0.04, 0.07);
    const targetDistance =
      item.targetPrice && item.targetPrice > 0
        ? Math.abs(item.latestPrice - item.targetPrice) / item.targetPrice
        : null;

    if (watchlistSeverity || (targetDistance !== null && targetDistance <= 0.05)) {
      alerts.push(
        createAlert({
          createdAt: input.asOf,
          ticker: item.ticker,
          companyName: item.companyName,
          type: "WATCHLIST_MOVE",
          severity: watchlistSeverity ?? "LOW",
          title: `${item.ticker} watchlist signal is active`,
          message:
            targetDistance !== null && targetDistance <= 0.05
              ? `${item.companyName} is within ${(targetDistance * 100).toFixed(1)}% of the seeded watchlist target.`
              : `${item.companyName} moved ${(watchlistMove * 100).toFixed(1)}% over the seeded one-week window.`,
          metricLabel:
            targetDistance !== null && targetDistance <= 0.05
              ? "Target distance"
              : "1W move",
          metricValue:
            targetDistance !== null && targetDistance <= 0.05
              ? targetDistance
              : watchlistMove,
        }),
      );
    }

    const volatilitySeverity = getSeverity(item.maxDailyMove, 0.035, 0.05);

    if (volatilitySeverity) {
      alerts.push(
        createAlert({
          createdAt: input.asOf,
          ticker: item.ticker,
          companyName: item.companyName,
          type: "VOLATILITY",
          severity: volatilitySeverity,
          title: `${item.ticker} volatility is elevated`,
          message: `${item.companyName} has a maximum seeded daily move of ${(item.maxDailyMove * 100).toFixed(1)}% over the recent watchlist window.`,
          metricLabel: "Max daily move",
          metricValue: item.maxDailyMove,
        }),
      );
    }
  }

  return alerts.sort((left, right) => {
    const severityRank: Record<RiskAlertSeverity, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return (
      severityRank[right.severity] - severityRank[left.severity] ||
      right.metricValue - left.metricValue ||
      left.ticker.localeCompare(right.ticker)
    );
  });
}
