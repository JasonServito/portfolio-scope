import Link from "next/link";

import { SeverityLabel } from "@/components/alerts/severity-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardAlertPreview } from "@/lib/portfolio/dashboard-data";

type AlertsPreviewProps = {
  alerts: DashboardAlertPreview[];
};

export function AlertsPreview({ alerts }: AlertsPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent alerts</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active alerts for this demo portfolio.
          </p>
        ) : (
          <ul className="divide-y">
            {alerts.map((alert) => {
              const href = alert.ticker
                ? `/stocks/${alert.ticker.toLowerCase()}`
                : "/alerts";

              return (
                <li key={alert.id}>
                  <Link
                    className="-mx-2 block rounded-sm px-2 py-3 transition-colors hover:bg-muted"
                    href={href}
                    prefetch={false}
                  >
                    <SeverityLabel
                      severity={alert.severity}
                      ticker={alert.ticker}
                    />
                    <span className="mt-1.5 block text-sm font-medium">
                      {alert.title}
                    </span>
                    <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {alert.message}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
