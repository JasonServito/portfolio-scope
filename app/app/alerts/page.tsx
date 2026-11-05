import { PrivateAlerts } from "@/components/alerts/private-alerts";
import { RiskAlertList } from "@/components/alerts/risk-alert-list";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { requireUser } from "@/lib/auth/session";
import { getOwnedRiskAlerts } from "@/lib/portfolio/alerts-data";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";
import { getPrimaryPortfolio } from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

export default async function PrivateAlertsPage() {
  const user = await requireUser("/app/alerts");
  const portfolio = await getPrimaryPortfolio(user.id);
  const [signals, savedAlerts] = await Promise.all([
    portfolio ? getOwnedRiskAlerts(user.id, portfolio.id) : [],
    listUserAlerts(user.id),
  ]);

  return (
    <PageShell
      description="Your positions and watchlist stocks that crossed a concentration, drawdown, price move, volatility, or target check"
      eyebrow={
        portfolio ? `${portfolio.name} · Your portfolio` : "Your account"
      }
      title="Alerts"
    >
      <div className="space-y-3">
        {signals[0] ? (
          <AsOfStamp
            asOf={signals[0].createdAt}
            note="Checked against cached sample prices"
          />
        ) : null}
        <RiskAlertList alerts={signals} />
      </div>
      {savedAlerts.length > 0 ? (
        <PrivateAlerts
          alerts={savedAlerts.map((alert) => ({
            id: alert.id,
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            status: alert.status,
            ticker: alert.stock?.ticker ?? null,
            portfolioName: alert.portfolio?.name ?? null,
          }))}
        />
      ) : null}
    </PageShell>
  );
}
