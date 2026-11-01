import { PageShell } from "@/components/layout/page-shell";
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
    <PageShell
      description="Add companies, record a target price, and keep short notes about what you are monitoring"
      eyebrow="Stocks you follow"
      title="Your watchlist"
    >
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
    </PageShell>
  );
}
