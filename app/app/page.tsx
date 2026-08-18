import type { Metadata } from "next";
import { Bell, Binoculars, WalletCards } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { PortfolioManager } from "@/components/portfolios/portfolio-manager";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { listPortfolios } from "@/lib/portfolio/management";

export const metadata: Metadata = { title: "Private workspace" };

export default async function PrivateWorkspacePage() {
  const user = await requireUser("/app");
  const portfolios = await listPortfolios(user.id);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <AnalyticsEvent name="sign_in_completed" oncePerSession properties={{}} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Your workspace
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            Welcome, {user.name ?? "investor"}
          </h1>
          <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
            Create and manage your portfolios, follow stocks, and review alerts
            in one place.
          </p>
        </div>
        <Badge variant="outline">{user.role}</Badge>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          description="Create portfolios and keep their holdings organized."
          icon={WalletCards}
          title="Portfolios"
        />
        <StatusCard
          description="Keep a short list of companies you want to follow."
          icon={Binoculars}
          title="Watchlist"
        />
        <StatusCard
          description="Review portfolio and stock signals that may need attention."
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
  icon: Icon,
  title,
}: {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="size-5 text-muted-foreground" />
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="leading-6 text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  );
}
