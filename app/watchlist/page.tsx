import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { WatchlistManager } from "@/components/watchlist/watchlist-manager";
import { getDemoWatchlist } from "@/lib/portfolio/management";
import { presentWatchlistPrice } from "@/lib/portfolio/watchlist-prices";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const items = await getDemoWatchlist();
  const now = new Date();
  return (
    <AppLayout>
      <PageShell
        description="Companies the sample investor follows, with the latest sample price and the target they set"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Watchlist"
      >
        {!items ? (
          <Card>
            <CardContent>
              <DataState
                description="The sample watchlist could not be loaded. No prices have been made up."
                kind="missing"
                title="Watchlist data is unavailable"
              />
            </CardContent>
          </Card>
        ) : (
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
            readOnly
          />
        )}
      </PageShell>
    </AppLayout>
  );
}
