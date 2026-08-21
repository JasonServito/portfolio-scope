import { UpcomingEarnings } from "@/components/earnings/upcoming-earnings";
import { requireUser } from "@/lib/auth/session";
import { getUserUpcomingEarnings } from "@/lib/earnings/service";

export const dynamic = "force-dynamic";

export default async function PrivateEarningsPage() {
  const user = await requireUser("/app/earnings");
  const data = await getUserUpcomingEarnings(user.id);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Portfolio calendar
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Upcoming earnings</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          The nearest expected earnings event for companies in your holdings and
          watchlist, with one shared daily observation per supported ticker.
        </p>
      </div>
      <UpcomingEarnings data={data} />
    </main>
  );
}
