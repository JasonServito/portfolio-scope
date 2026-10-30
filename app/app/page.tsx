import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { PageShell } from "@/components/layout/page-shell";
import { PortfolioManager } from "@/components/portfolios/portfolio-manager";
import { Card, CardContent } from "@/components/ui/card";
import { AuthenticatedPageLoading } from "@/components/ui/authenticated-page-loading";
import { requireUser } from "@/lib/auth/session";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";
import { getUserWatchlist, listPortfolios } from "@/lib/portfolio/management";

export const metadata: Metadata = { title: "Dashboard" };

export default function PrivateWorkspacePage() {
  return (
    <Suspense fallback={<AuthenticatedPageLoading />}>
      <PrivateDashboardContent />
    </Suspense>
  );
}

async function PrivateDashboardContent() {
  const user = await requireUser("/app");
  const [portfolios, watchlist, alerts] = await Promise.all([
    listPortfolios(user.id),
    getUserWatchlist(user.id),
    listUserAlerts(user.id, { reconcileTargetCrossings: false }),
  ]);
  const activeAlertCount = alerts.filter(
    (alert) => alert.status === "ACTIVE",
  ).length;

  return (
    <PageShell
      description="Manage your portfolios, follow stocks, and review alerts in one place"
      eyebrow={user.name ? `${user.name} · Your account` : "Your account"}
      title="Dashboard"
    >
      <AnalyticsEvent name="sign_in_completed" oncePerSession properties={{}} />
      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          count={portfolios.length}
          description="Create portfolios and keep their holdings organized"
          title="Portfolios"
        />
        <StatusCard
          count={watchlist.length}
          description="A short list of companies you want to follow"
          href="/app/watchlist"
          linkLabel="Open watchlist"
          title="Watchlist"
        />
        <StatusCard
          count={activeAlertCount}
          description="Portfolio and stock signals that may need attention"
          href="/app/alerts"
          linkLabel="Review alerts"
          title="Active alerts"
        />
      </section>

      <PortfolioManager
        portfolios={portfolios.map((portfolio) => ({
          id: portfolio.id,
          name: portfolio.name,
          baseCurrency: portfolio.baseCurrency,
          holdingCount: portfolio._count.holdings,
          updatedAt: portfolio.updatedAt.toISOString(),
        }))}
      />
    </PageShell>
  );
}

function StatusCard({
  count,
  description,
  href,
  linkLabel,
  title,
}: {
  count: number;
  description: string;
  href?: string;
  linkLabel?: string;
  title: string;
}) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-[28px] leading-none font-medium tabular-nums">
          {count}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        {href && linkLabel ? (
          <Link
            className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
            href={href}
            prefetch={false}
          >
            {linkLabel}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
