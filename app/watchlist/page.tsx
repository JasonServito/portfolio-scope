import { AlertTriangle } from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { WatchlistManager } from "@/components/watchlist/watchlist-manager";
import { getDemoWatchlist } from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const items = await getDemoWatchlist();
  return (
    <AppLayout>
      <PageShell
        description="Track seeded companies you want to research without changing your portfolio."
        eyebrow="Research queue"
        title="Watchlist"
      >
        {!items ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-md bg-muted">
                <AlertTriangle className="size-5" />
              </span>
              <div>
                <p className="font-medium">Watchlist data is unavailable.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Seed the database to manage the demo investor watchlist.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
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
        )}
      </PageShell>
    </AppLayout>
  );
}
