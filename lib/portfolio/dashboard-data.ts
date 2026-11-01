import { getDemoRiskAlertsWithAnalytics } from "@/lib/portfolio/alerts-data";
import {
  getDemoPortfolioAnalyticsByPeriods,
} from "@/lib/portfolio/analytics";
import {
  PERFORMANCE_PERIODS,
  type HoldingAnalytics,
  type PerformancePeriod,
} from "@/lib/portfolio/types";

export type DashboardAlertPreview = {
  id: string;
  ticker: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH";
  type: string;
  title: string;
  message: string;
};

export type HoldingsPageRow = HoldingAnalytics & {
  periodReturns: Record<PerformancePeriod, number>;
};

export async function getDemoDashboardData(period: PerformancePeriod) {
  const analyticsByPeriodPromise = getDemoPortfolioAnalyticsByPeriods(
    PERFORMANCE_PERIODS,
  );
  const [analyticsByPeriod, alerts] = await Promise.all([
    analyticsByPeriodPromise,
    getDemoRiskAlertsWithAnalytics(analyticsByPeriodPromise),
  ]);
  const analytics =
    analyticsByPeriod.find((item) => item?.period === period) ?? null;

  return {
    activeAlertCount: alerts.length,
    analytics,
    alerts: alerts.slice(0, 3).map(
      (alert): DashboardAlertPreview => ({
        id: alert.id,
        ticker: alert.ticker,
        severity: alert.severity,
        type: alert.type,
        title: alert.title,
        message: alert.message,
      }),
    ),
  };
}

export async function getDemoHoldingsPageData() {
  const analyticsByPeriod =
    await getDemoPortfolioAnalyticsByPeriods(PERFORMANCE_PERIODS);

  if (analyticsByPeriod.some((analytics) => analytics === null)) {
    return null;
  }

  const analytics = analyticsByPeriod.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  const baseAnalytics =
    analytics.find((item) => item.period === "1M") ?? analytics[0];

  const rows: HoldingsPageRow[] = baseAnalytics.holdings.map((holding) => {
    const periodReturns = Object.fromEntries(
      analytics.map((item) => [
        item.period,
        item.holdings.find((periodHolding) => periodHolding.id === holding.id)
          ?.periodReturn ?? 0,
      ]),
    ) as Record<PerformancePeriod, number>;

    return {
      ...holding,
      periodReturns,
    };
  });

  return {
    portfolio: baseAnalytics.portfolio,
    asOf: baseAnalytics.asOf,
    summary: baseAnalytics.summary,
    holdings: rows,
  };
}
