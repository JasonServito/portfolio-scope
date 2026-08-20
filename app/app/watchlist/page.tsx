import { WatchlistManager } from "@/components/watchlist/watchlist-manager";
import { requireUser } from "@/lib/auth/session";
import { getUserWatchlist } from "@/lib/portfolio/management";
import { presentWatchlistPrice } from "@/lib/portfolio/watchlist-prices";

export const dynamic = "force-dynamic";

export default async function PrivateWatchlistPage() {
  const user = await requireUser("/app/watchlist");
  const items = await getUserWatchlist(user.id);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Stocks you follow
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Your watchlist</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
          Add companies, record a target price, and keep short notes about what
          you are monitoring.
        </p>
      </div>
      <WatchlistManager
        items={items.map((item) => ({
          id: item.id,
          ticker: item.stock.ticker,
          companyName: item.stock.companyName,
          sector: item.stock.sector,
          price: presentWatchlistPrice(
            item.stock.prices,
            item.stock.currency,
            now,
          ),
          targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
          notes: item.notes,
        }))}
      />
    </main>
  );
}
