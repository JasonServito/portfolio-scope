import { AlertsPreview } from "@/components/dashboard/alerts-preview";
import { AllocationChart } from "@/components/dashboard/allocation-chart";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PortfolioPerformanceChart } from "@/components/dashboard/portfolio-performance-chart";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { WinnersLosers } from "@/components/dashboard/winners-losers";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatSignedPercent } from "@/lib/formatters";
import type { DashboardAlertPreview } from "@/lib/portfolio/dashboard-data";
import type { PortfolioAnalytics } from "@/lib/portfolio/types";

type DashboardOverviewProps = {
  analytics: PortfolioAnalytics;
  alerts: DashboardAlertPreview[];
  activeAlertCount: number;
  asOfNote: string;
  periodBasePath?: string;
  alertsHref?: string;
  alertsEmptyMessage?: string;
};

// The dashboard body shared by the read-only demo and the signed-in workspace.
export function DashboardOverview({
  activeAlertCount,
  alerts,
  alertsEmptyMessage,
  alertsHref,
  analytics,
  asOfNote,
  periodBasePath,
}: DashboardOverviewProps) {
  const currency = analytics.portfolio.baseCurrency;

  return (
    <>
      <div className="space-y-3">
        <AsOfStamp asOf={analytics.asOf} note={asOfNote} />
        <SummaryCards analytics={analytics} alertCount={activeAlertCount} />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Portfolio performance</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                  {formatSignedPercent(analytics.summary.periodReturn)} from{" "}
                  {formatCurrency(analytics.summary.periodStartValue, currency)}{" "}
                  to{" "}
                  {formatCurrency(analytics.summary.periodEndValue, currency)}
                </p>
              </div>
              <PeriodSelector
                basePath={periodBasePath}
                selectedPeriod={analytics.period}
              />
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <PortfolioPerformanceChart
              currency={currency}
              data={analytics.performance}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationChart
              currency={currency}
              positions={analytics.allocationByHolding}
              sectors={analytics.allocationBySector}
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr] xl:items-start">
        <Card>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <WinnersLosers
              currency={currency}
              items={analytics.topWinners}
              title="Top contributors"
            />
            <WinnersLosers
              currency={currency}
              items={analytics.topLosers}
              title="Bottom contributors"
            />
          </CardContent>
        </Card>
        <AlertsPreview
          alerts={alerts}
          alertsHref={alertsHref}
          emptyMessage={alertsEmptyMessage}
        />
      </section>
    </>
  );
}
