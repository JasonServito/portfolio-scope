import { UpcomingEarnings } from "@/components/earnings/upcoming-earnings";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { getDemoUpcomingEarnings } from "@/lib/earnings/service";

export const dynamic = "force-dynamic";

export default async function EarningsPage() {
  const data = await getDemoUpcomingEarnings();

  return (
    <AppLayout>
      <PageShell
        description="The next expected earnings date for each company in the sample portfolio and watchlist"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Upcoming earnings"
      >
        <UpcomingEarnings data={data} readOnly />
      </PageShell>
    </AppLayout>
  );
}
