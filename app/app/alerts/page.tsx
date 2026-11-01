import { PrivateAlerts } from "@/components/alerts/private-alerts";
import { PageShell } from "@/components/layout/page-shell";
import { requireUser } from "@/lib/auth/session";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";

export const dynamic = "force-dynamic";

export default async function PrivateAlertsPage() {
  const user = await requireUser("/app/alerts");
  const alerts = await listUserAlerts(user.id);

  return (
    <PageShell
      description="Review active alerts and resolve items once you have assessed them"
      eyebrow="Portfolio updates"
      title="Your alerts"
    >
      <PrivateAlerts
        alerts={alerts.map((alert) => ({
          id: alert.id,
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          status: alert.status,
          ticker: alert.stock?.ticker ?? null,
          portfolioName: alert.portfolio?.name ?? null,
        }))}
      />
    </PageShell>
  );
}
