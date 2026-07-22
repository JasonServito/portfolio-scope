import { WatchlistManager } from "@/components/watchlist/watchlist-manager";
import { requireUser } from "@/lib/auth/session";
import { getUserWatchlist } from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

export default async function PrivateWatchlistPage() {
  const user = await requireUser("/app/watchlist");
  const items = await getUserWatchlist(user.id);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Private research queue
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Your watchlist</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Watchlist reads and mutations are keyed to your authenticated user ID.
        </p>
      </div>
      <WatchlistManager
        items={items.map((item) => ({
          id: item.id,
          ticker: item.stock.ticker,
          companyName: item.stock.companyName,
          sector: item.stock.sector,
          targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
          notes: item.notes,
        }))}
      />
    </main>
  );
}
