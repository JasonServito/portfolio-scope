import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent } from "@/lib/formatters";
import { getDemoRiskAlerts } from "@/lib/portfolio/alerts-data";
import type { RiskAlertSeverity } from "@/lib/portfolio/risk-alerts";

export const dynamic = "force-dynamic";

function severityVariant(severity: RiskAlertSeverity) {
  return severity === "HIGH" ? "destructive" : "outline";
}

function severityClassName(severity: RiskAlertSeverity) {
  if (severity === "HIGH") {
    return "border-destructive/30 bg-destructive/5";
  }

  if (severity === "MEDIUM") {
    return "border-amber-200 bg-amber-50/70";
  }

  return "border-border bg-card";
}

export default async function AlertsPage() {
  const alerts = await getDemoRiskAlerts();

  return (
    <AppLayout>
      <PageShell
        description="A deterministic risk queue for concentration, drawdown, price movement, volatility, and watchlist signals."
        eyebrow="Risk monitoring"
        title="Alerts"
      >
        <Card>
          <CardHeader>
            <CardTitle>Triggered alert queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 py-12 text-center">
                <span className="flex size-11 items-center justify-center rounded-md bg-background">
                  <AlertTriangle className="size-5" />
                </span>
                <div>
                  <p className="font-medium">No active risk alerts.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Seeded portfolio data is inside the configured risk bands.
                  </p>
                </div>
              </div>
            ) : (
              alerts.map((alert) => (
                <Link
                  className={`flex flex-col gap-4 rounded-lg border p-4 transition hover:bg-muted/30 lg:flex-row lg:items-center lg:justify-between ${severityClassName(alert.severity)}`}
                  href={alert.href}
                  key={alert.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(alert.severity)}>
                        {alert.severity.toLowerCase()}
                      </Badge>
                      <Badge variant="outline">{alert.type.toLowerCase()}</Badge>
                      <span className="text-xs font-medium uppercase text-muted-foreground">
                        {alert.ticker}
                      </span>
                    </div>
                    <p className="mt-3 font-medium">{alert.title}</p>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      {alert.message}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-md border bg-background px-3 py-2 text-left lg:text-right">
                    <p className="text-xs text-muted-foreground">
                      {alert.metricLabel}
                    </p>
                    <p className="text-sm font-semibold">
                      {formatPercent(alert.metricValue)}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </PageShell>
    </AppLayout>
  );
}
