import { UpcomingEarnings } from "@/components/earnings/upcoming-earnings";
import { PageShell } from "@/components/layout/page-shell";
import { requireUser } from "@/lib/auth/session";
import { getUserUpcomingEarnings } from "@/lib/earnings/service";

export const dynamic = "force-dynamic";

export default async function PrivateEarningsPage() {
  const user = await requireUser("/app/earnings");
  const data = await getUserUpcomingEarnings(user.id);

  return (
    <PageShell
      description="The next expected earnings date for companies in your holdings and watchlist, checked once a day per company"
      eyebrow="Portfolio calendar"
      title="Upcoming earnings"
    >
      <UpcomingEarnings data={data} />
    </PageShell>
  );
}
