import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { AlertsPreview } from "@/components/dashboard/alerts-preview";
import { AllocationChart } from "@/components/dashboard/allocation-chart";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PortfolioPerformanceChart } from "@/components/dashboard/portfolio-performance-chart";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { WinnersLosers } from "@/components/dashboard/winners-losers";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatSignedCurrency, formatSignedPercent } from "@/lib/formatters";
import { getDemoDashboardData } from "@/lib/portfolio/dashboard-data";
import { isPerformancePeriod } from "@/lib/portfolio/performance";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    period?: string | string[];
  }>;
};

async function getSelectedPeriod(searchParams?: DashboardPageProps["searchParams"]) {
  const params = await searchParams;
  const requestedPeriod = Array.isArray(params?.period)
    ? params?.period[0]
    : params?.period;

  return requestedPeriod && isPerformancePeriod(requestedPeriod)
    ? requestedPeriod
    : "1M";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
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
          <Link className={buttonVariants({ variant: "outline" })} href="/holdings">
            View holdings
          </Link>
        }
        description="A screenshot-ready overview for portfolio value, performance periods, allocation, and risk signals."
        eyebrow="Demo portfolio"
        title="Dashboard"
      >
        {!analytics ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-md bg-muted">
                <AlertTriangle className="size-5" />
              </span>
              <div>
                <p className="font-medium">Demo portfolio data is unavailable.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Seed the database to load portfolio analytics.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <SummaryCards analytics={analytics} alertCount={activeAlertCount} />

            <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Portfolio performance</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatSignedPercent(analytics.summary.periodReturn)} from{" "}
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
                <CardContent>
                  <PortfolioPerformanceChart
                    currency={analytics.portfolio.baseCurrency}
                    data={analytics.performance}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Allocation by sector</CardTitle>
                </CardHeader>
                <CardContent>
                  <AllocationChart
                    currency={analytics.portfolio.baseCurrency}
                    data={analytics.allocationBySector}
                  />
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <WinnersLosers
                currency={analytics.portfolio.baseCurrency}
                items={analytics.topWinners}
                title="Top winners"
                tone="positive"
              />
              <WinnersLosers
                currency={analytics.portfolio.baseCurrency}
                items={analytics.topLosers}
                title="Top losers"
                tone="negative"
              />
              <AlertsPreview alerts={alerts} />
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              {analytics.allocationByHolding.slice(0, 3).map((holding) => (
                <Card key={holding.key}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>{holding.label}</CardTitle>
                      <Badge variant="outline">
                        {formatSignedCurrency(
                          analytics.holdings.find(
                            (item) => item.ticker === holding.key,
                          )?.dollarContribution ?? 0,
                          analytics.portfolio.baseCurrency,
                        )}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.min(holding.percentage * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {formatCurrency(
                        holding.value,
                        analytics.portfolio.baseCurrency,
                      )}{" "}
                      current market value
                    </p>
                  </CardContent>
                </Card>
              ))}
            </section>
          </>
        )}
      </PageShell>
    </AppLayout>
  );
}
