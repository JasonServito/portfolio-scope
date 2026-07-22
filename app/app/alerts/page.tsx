import { PrivateAlerts } from "@/components/alerts/private-alerts";
import { requireUser } from "@/lib/auth/session";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";

export const dynamic = "force-dynamic";

export default async function PrivateAlertsPage() {
  const user = await requireUser("/app/alerts");
  const alerts = await listUserAlerts(user.id);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Private risk state
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Your alerts</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Status changes require both an authenticated session and alert
          ownership. Admin role alone does not bypass this boundary.
        </p>
      </div>
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
    </main>
  );
}
