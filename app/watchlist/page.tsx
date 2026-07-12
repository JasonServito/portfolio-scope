import Link from "next/link";

import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WatchlistPage() {
  return (
    <AppLayout>
      <PageShell
        description="A focused monitoring surface for stocks outside the portfolio, with movement and research readiness."
        eyebrow="Research queue"
        title="Watchlist"
      >
        <section className="grid gap-4 lg:grid-cols-2">
          {[
            ["AMD", "Advanced Micro Devices", "Semiconductors", "+6.4%"],
            ["SHOP", "Shopify", "Software", "-1.8%"],
            ["GOOGL", "Alphabet", "Communication services", "+2.7%"],
            ["AMZN", "Amazon", "Consumer discretionary", "+3.1%"],
          ].map(([ticker, company, sector, move]) => (
            <Link href={`/stocks/${ticker.toLowerCase()}`} key={ticker}>
              <Card className="transition hover:bg-muted/30">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{ticker}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {company}
                      </p>
                    </div>
                    <Badge
                      className={
                        move.startsWith("+")
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }
                    >
                      {move}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {sector}
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      </PageShell>
    </AppLayout>
  );
}
