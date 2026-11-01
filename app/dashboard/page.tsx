import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { DemoJourney } from "@/components/demo/demo-journey";
import { AlertsPreview } from "@/components/dashboard/alerts-preview";
import { AllocationChart } from "@/components/dashboard/allocation-chart";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PortfolioPerformanceChart } from "@/components/dashboard/portfolio-performance-chart";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { WinnersLosers } from "@/components/dashboard/winners-losers";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { formatCurrency, formatSignedPercent } from "@/lib/formatters";
import { getDemoDashboardData } from "@/lib/portfolio/dashboard-data";
import { isPerformancePeriod } from "@/lib/portfolio/performance";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    period?: string | string[];
  }>;
};

async function getSelectedPeriod(
  searchParams?: DashboardPageProps["searchParams"],
) {
  const params = await searchParams;
  const requestedPeriod = Array.isArray(params?.period)
    ? params?.period[0]
    : params?.period;

  return requestedPeriod && isPerformancePeriod(requestedPeriod)
    ? requestedPeriod
    : "1M";
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const selectedPeriod = await getSelectedPeriod(searchParams);
  const { activeAlertCount, alerts, analytics } =
    await getDemoDashboardData(selectedPeriod);

  return (
    <AppLayout>
      <AnalyticsEvent
        name="demo_opened"
        oncePerSession
        properties={{ entryPoint: "direct" }}
      />
      <PageShell
        actions={
          <Link className={buttonVariants()} href="/holdings" prefetch={false}>
            Inspect holdings
            <ArrowRight className="size-4" />
          </Link>
        }
        description="What the sample portfolio is worth, how it moved, and which positions need a closer look"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Dashboard"
      >
        <DemoJourney currentStep={1} />
        {!analytics ? (
          <Card>
            <CardContent>
              <DataState
                description="The sample portfolio could not be loaded. No portfolio values have been made up."
                kind="missing"
                title="Demo portfolio data is unavailable"
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              <AsOfStamp
                asOf={analytics.asOf}
                note="Sample portfolio and prices"
              />
              <SummaryCards
                analytics={analytics}
                alertCount={activeAlertCount}
              />
            </div>

            <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>Portfolio performance</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                        {formatSignedPercent(analytics.summary.periodReturn)}{" "}
                        from{" "}
                        {formatCurrency(
                          analytics.summary.periodStartValue,
                          analytics.portfolio.baseCurrency,
                        )}{" "}
                        to{" "}
                        {formatCurrency(
                          analytics.summary.periodEndValue,
                          analytics.portfolio.baseCurrency,
                        )}
                      </p>
                    </div>
                    <PeriodSelector selectedPeriod={analytics.period} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <PortfolioPerformanceChart
                    currency={analytics.portfolio.baseCurrency}
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
                    currency={analytics.portfolio.baseCurrency}
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
                    currency={analytics.portfolio.baseCurrency}
                    items={analytics.topWinners}
                    title="Top contributors"
                  />
                  <WinnersLosers
                    currency={analytics.portfolio.baseCurrency}
                    items={analytics.topLosers}
                    title="Bottom contributors"
                  />
                </CardContent>
              </Card>
              <AlertsPreview alerts={alerts} />
            </section>
          </>
        )}
      </PageShell>
    </AppLayout>
  );
}
