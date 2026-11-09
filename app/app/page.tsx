import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { PageShell } from "@/components/layout/page-shell";
import { CreatePortfolioForm } from "@/components/portfolios/portfolio-forms";
import { AuthenticatedPageLoading } from "@/components/ui/authenticated-page-loading";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { requireUser } from "@/lib/auth/session";
import { getOwnedDashboardData } from "@/lib/portfolio/dashboard-data";
import { getPrimaryPortfolio } from "@/lib/portfolio/management";
import { getSelectedPeriod } from "@/lib/portfolio/performance";

export const metadata: Metadata = { title: "Dashboard" };

type PrivateWorkspacePageProps = {
  searchParams?: Promise<{ period?: string | string[] }>;
};

export default function PrivateWorkspacePage({
  searchParams,
}: PrivateWorkspacePageProps) {
  return (
    <Suspense fallback={<AuthenticatedPageLoading />}>
      <PrivateDashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PrivateDashboardContent({
  searchParams,
}: PrivateWorkspacePageProps) {
  const user = await requireUser("/app");
  const [portfolio, params] = await Promise.all([
    getPrimaryPortfolio(user.id),
    searchParams,
  ]);
  const data = portfolio
    ? await getOwnedDashboardData(
        user.id,
        portfolio.id,
        getSelectedPeriod(params?.period),
      )
    : null;

  return (
    <PageShell
      actions={
        data?.analytics ? (
          <Link
            className={buttonVariants()}
            href="/app/holdings"
            prefetch={false}
          >
            Inspect holdings
            <ArrowRight className="size-4" />
          </Link>
        ) : undefined
      }
      description="What your portfolio is worth, how it moved, and which positions need a closer look"
      eyebrow={
        portfolio ? `${portfolio.name} · Your portfolio` : "Your account"
      }
      title="Dashboard"
    >
      <AnalyticsEvent name="sign_in_completed" oncePerSession properties={{}} />
      {!portfolio ? (
        <Card>
          <CardContent>
            <DataState
              action={<CreatePortfolioForm />}
              description="Name your portfolio, then add the stocks you own to see its value, returns, and allocation here."
              kind="empty"
              title="Create your portfolio"
            />
          </CardContent>
        </Card>
      ) : !data?.analytics ? (
        <Card>
          <CardContent>
            <DataState
              action={
                <Link
                  className={buttonVariants()}
                  href="/app/holdings"
                  prefetch={false}
                >
                  Add holdings
                  <ArrowRight className="size-4" />
                </Link>
              }
              description="Add the stocks you own, with shares and average cost, to see what the portfolio is worth and how it moved."
              kind="empty"
              title="Your portfolio has no holdings yet"
            />
          </CardContent>
        </Card>
      ) : (
        <DashboardOverview
          activeAlertCount={data.activeAlertCount}
          alerts={data.alerts}
          alertsEmptyMessage="No active alerts for your portfolio."
          alertsHref="/app/alerts"
          analytics={data.analytics}
          asOfNote="Your holdings at cached sample prices"
          periodBasePath="/app"
        />
      )}
    </PageShell>
  );
}
