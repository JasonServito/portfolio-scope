import { RiskAlertList } from "@/components/alerts/risk-alert-list";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
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
          <RiskAlertList alerts={alerts} />
        </div>
      </PageShell>
    </AppLayout>
  );
}
