import {
  getDemoRiskAlertsWithAnalytics,
  getOwnedRiskAlertsWithAnalytics,
} from "@/lib/portfolio/alerts-data";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";
import {
  getDemoPortfolioAnalyticsByPeriods,
  getOwnedPortfolioAnalyticsByPeriods,
} from "@/lib/portfolio/analytics";
import type { RiskAlert } from "@/lib/portfolio/risk-alerts";
import {
  PERFORMANCE_PERIODS,
  type HoldingAnalytics,
  type PerformancePeriod,
  type PortfolioAnalytics,
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
  const analyticsByPeriodPromise =
    getDemoPortfolioAnalyticsByPeriods(PERFORMANCE_PERIODS);
  const [analyticsByPeriod, alerts] = await Promise.all([
    analyticsByPeriodPromise,
    getDemoRiskAlertsWithAnalytics(analyticsByPeriodPromise),
  ]);

  return buildDashboardData(
    analyticsByPeriod,
    alerts.map(toAlertPreview),
    period,
  );
}

// The signed-in dashboard: the owner's review signals plus any saved
// target-price alerts they have not resolved yet.
export async function getOwnedDashboardData(
  userId: string,
  portfolioId: string,
  period: PerformancePeriod,
) {
  const analyticsByPeriodPromise = getOwnedPortfolioAnalyticsByPeriods(
    userId,
    portfolioId,
    PERFORMANCE_PERIODS,
  );
  const [analyticsByPeriod, signals, savedAlerts] = await Promise.all([
    analyticsByPeriodPromise,
    getOwnedRiskAlertsWithAnalytics(userId, analyticsByPeriodPromise),
    listUserAlerts(userId, { reconcileTargetCrossings: false }),
  ]);
  const activeSavedAlerts = savedAlerts
    .filter((alert) => alert.status === "ACTIVE")
    .map(
      (alert): DashboardAlertPreview => ({
        id: alert.id,
        ticker: alert.stock?.ticker ?? null,
        severity: alert.severity,
        type: alert.type,
        title: alert.title,
        message: alert.message,
      }),
    );

  return buildDashboardData(
    analyticsByPeriod,
    [...activeSavedAlerts, ...signals.map(toAlertPreview)],
    period,
  );
}

function toAlertPreview(alert: RiskAlert): DashboardAlertPreview {
  return {
    id: alert.id,
    ticker: alert.ticker,
    severity: alert.severity,
    type: alert.type,
    title: alert.title,
    message: alert.message,
  };
}

function buildDashboardData(
  analyticsByPeriod: Array<PortfolioAnalytics | null>,
  alerts: DashboardAlertPreview[],
  period: PerformancePeriod,
) {
  return {
    activeAlertCount: alerts.length,
    analytics:
      analyticsByPeriod.find((item) => item?.period === period) ?? null,
    alerts: alerts.slice(0, 3),
  };
}

export async function getDemoHoldingsPageData() {
  return buildHoldingsPageData(
    await getDemoPortfolioAnalyticsByPeriods(PERFORMANCE_PERIODS),
  );
}

export async function getOwnedHoldingsPageData(
  userId: string,
  portfolioId: string,
) {
  return buildHoldingsPageData(
    await getOwnedPortfolioAnalyticsByPeriods(
      userId,
      portfolioId,
      PERFORMANCE_PERIODS,
    ),
  );
}

function buildHoldingsPageData(
  analyticsByPeriod: Array<PortfolioAnalytics | null>,
) {
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
