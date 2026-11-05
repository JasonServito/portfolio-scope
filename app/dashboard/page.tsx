import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { DemoJourney } from "@/components/demo/demo-journey";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { getDemoDashboardData } from "@/lib/portfolio/dashboard-data";
import { getSelectedPeriod } from "@/lib/portfolio/performance";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    period?: string | string[];
  }>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const selectedPeriod = getSelectedPeriod((await searchParams)?.period);
  const { activeAlertCount, alerts, analytics } =
    await getDemoDashboardData(selectedPeriod);

  return (
    <AppLayout>
      <AnalyticsEvent
        name="demo_opened"
        oncePerSession
        properties={{ entryPoint: "direct" }}
      />
      <PageShell
        actions={
          <Link className={buttonVariants()} href="/holdings" prefetch={false}>
            Inspect holdings
            <ArrowRight className="size-4" />
          </Link>
        }
        description="What the sample portfolio is worth, how it moved, and which positions need a closer look"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Dashboard"
      >
        <DemoJourney currentStep={1} />
        {!analytics ? (
          <Card>
            <CardContent>
              <DataState
                description="The sample portfolio could not be loaded. No portfolio values have been made up."
                kind="missing"
                title="Demo portfolio data is unavailable"
              />
            </CardContent>
          </Card>
        ) : (
          <DashboardOverview
            activeAlertCount={activeAlertCount}
            alerts={alerts}
            analytics={analytics}
            asOfNote="Sample portfolio and prices"
          />
        )}
      </PageShell>
    </AppLayout>
  );
}
