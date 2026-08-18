import type { Metadata } from "next";
import { Bell, Binoculars, WalletCards } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { PortfolioManager } from "@/components/portfolios/portfolio-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    listUserAlerts(user.id),
  ]);
  const activeAlertCount = alerts.filter(
    (alert) => alert.status === "ACTIVE",
  ).length;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <AnalyticsEvent name="sign_in_completed" oncePerSession properties={{}} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Your account
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Dashboard</h1>
          <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
            Welcome, {user.name ?? "investor"}. Manage your portfolios, follow
            stocks, and review alerts in one place.
          </p>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          description="Create portfolios and keep their holdings organized."
          detail={`${portfolios.length} portfolio${portfolios.length === 1 ? "" : "s"}`}
          href="/app"
          icon={WalletCards}
          title="Portfolios"
        />
        <StatusCard
          description="Keep a short list of companies you want to follow."
          detail={`${watchlist.length} stock${watchlist.length === 1 ? "" : "s"}`}
          href="/app/watchlist"
          icon={Binoculars}
          title="Watchlist"
        />
        <StatusCard
          description="Review portfolio and stock signals that may need attention."
          detail={`${activeAlertCount} active`}
          href="/app/alerts"
          icon={Bell}
          title="Alerts"
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
    </main>
  );
}

function StatusCard({
  description,
  detail,
  href,
  icon: Icon,
  title,
}: {
  description: string;
  detail: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="size-5 text-muted-foreground" />
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 leading-6 text-muted-foreground">
        <p>{description}</p>
        <Link
          className="inline-flex font-medium text-primary hover:underline"
          href={href}
        >
          {detail}
        </Link>
      </CardContent>
    </Card>
  );
}
