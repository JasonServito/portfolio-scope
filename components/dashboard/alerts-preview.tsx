import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardAlertPreview } from "@/lib/portfolio/dashboard-data";

type AlertsPreviewProps = {
  alerts: DashboardAlertPreview[];
};

function severityVariant(severity: DashboardAlertPreview["severity"]) {
  return severity === "HIGH" ? "destructive" : "outline";
}

export function AlertsPreview({ alerts }: AlertsPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            No active alerts for this demo portfolio.
          </div>
        ) : (
          alerts.map((alert) => {
            const href = alert.ticker
              ? `/stocks/${alert.ticker.toLowerCase()}`
              : "/alerts";

            return (
              <Link
                className="block rounded-lg border px-3 py-3 transition hover:bg-muted/40"
                href={href}
                key={alert.id}
                prefetch={false}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={severityVariant(alert.severity)}>
                    {alert.severity.toLowerCase()}
                  </Badge>
                  {alert.ticker ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      {alert.ticker}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-medium">{alert.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {alert.message}
                </p>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
