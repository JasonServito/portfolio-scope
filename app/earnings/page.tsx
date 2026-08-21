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
        description="See the nearest expected earnings event for each company followed by the sample portfolio. Live updates remain gated until production activation is approved."
        eyebrow="Portfolio calendar"
        title="Upcoming earnings"
      >
        <UpcomingEarnings data={data} readOnly />
      </PageShell>
    </AppLayout>
  );
}
