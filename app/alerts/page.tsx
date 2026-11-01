import Link from "next/link";

import { SeverityLabel } from "@/components/alerts/severity-label";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent } from "@/lib/formatters";
import { getDemoRiskAlerts } from "@/lib/portfolio/alerts-data";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const alerts = await getDemoRiskAlerts();

  return (
    <AppLayout>
      <PageShell
        description="Positions and watchlist stocks that crossed a concentration, drawdown, price move, volatility, or target check"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Alerts"
      >
        <div className="space-y-3">
          {alerts[0] ? (
            <AsOfStamp
              asOf={alerts[0].createdAt}
              note="Checked against sample prices"
            />
          ) : null}
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-3">
                <CardTitle>Active alerts</CardTitle>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {alerts.length} signal{alerts.length === 1 ? "" : "s"}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="font-medium">No active risk alerts</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Every position and watchlist stock is inside its review
                    thresholds
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {alerts.map((alert) => (
                    <li key={alert.id}>
                      <Link
                        className="-mx-2 grid gap-3 rounded-sm px-2 py-4 transition-colors hover:bg-muted sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8"
                        href={alert.href}
                      >
                        <div className="min-w-0">
                          <SeverityLabel
                            severity={alert.severity}
                            ticker={alert.ticker}
                            type={alert.type}
                          />
                          <p className="mt-1.5 text-sm font-medium">
                            {alert.title}
                          </p>
                          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                            {alert.message}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="text-xs text-muted-foreground">
                            {alert.metricLabel}
                          </p>
                          <p className="mt-0.5 text-sm font-medium tabular-nums">
                            {formatPercent(alert.metricValue, 1)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </PageShell>
    </AppLayout>
  );
}
