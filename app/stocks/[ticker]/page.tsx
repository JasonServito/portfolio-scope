import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { StockPriceChart } from "@/components/stocks/stock-price-chart";
import { ResearchTabs } from "@/components/research/research-tabs";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { getDemoStockDetail } from "@/lib/portfolio/stock-detail";
import { PERFORMANCE_PERIODS } from "@/lib/portfolio/types";
import { getLatestResearch } from "@/lib/research/orchestrator";

export const dynamic = "force-dynamic";

type StockPageProps = {
  params: Promise<{
    ticker: string;
  }>;
};

export default async function StockPage({ params }: StockPageProps) {
  const { ticker } = await params;
  const [data, research] = await Promise.all([
    getDemoStockDetail(ticker),
    getLatestResearch(ticker),
  ]);

  if (!data) {
    notFound();
  }

  const { stock } = data;
  const riskSeverity = data.relatedAlerts[0]?.severity ?? "LOW";

  return (
    <AppLayout>
      <PageShell
        actions={
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/watchlist"
          >
            <ArrowLeft className="size-4" />
            Watchlist
          </Link>
        }
        description={`${stock.companyName} stock context, seeded price history, position exposure, and deterministic risk signals.`}
        eyebrow="Stock detail"
        title={stock.ticker}
      >
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-normal">
                {stock.companyName}
              </h2>
              <Badge variant="outline">{stock.exchange}</Badge>
              <Badge variant="outline">{stock.currency}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {stock.sector} / {stock.industry}
            </p>
          </div>
          <div className="md:text-right">
            <p className="text-3xl font-semibold tracking-normal">
              {formatCurrency(data.latestPrice, stock.currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Seeded as of {new Date(data.asOf).toLocaleDateString("en-US")}
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            [
              "Last price",
              formatCurrency(data.latestPrice, stock.currency),
              "Latest seeded close",
            ],
            [
              "1M move",
              formatSignedPercent(data.periodReturns["1M"]),
              "Price performance",
            ],
            [
              "Portfolio weight",
              data.position
                ? formatSignedPercent(data.position.allocationPercent).replace(
                    "+",
                    "",
                  )
                : "Not held",
              data.position ? "Demo portfolio exposure" : "Watchlist context",
            ],
            [
              "Alert status",
              data.relatedAlerts.length > 0 ? riskSeverity : "Clear",
              `${data.relatedAlerts.length} active signal${data.relatedAlerts.length === 1 ? "" : "s"}`,
            ],
          ].map(([label, value, detail]) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Seeded price history</CardTitle>
            </CardHeader>
            <CardContent>
              <StockPriceChart
                currency={stock.currency}
                data={data.priceChart}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Position summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.position ? (
                [
                  ["Shares", data.position.shares.toLocaleString("en-US")],
                  [
                    "Average cost",
                    formatCurrency(data.position.averageCost, stock.currency),
                  ],
                  [
                    "Market value",
                    formatCurrency(data.position.marketValue, stock.currency),
                  ],
                  [
                    "Unrealized gain",
                    formatSignedCurrency(
                      data.position.totalGainLoss,
                      stock.currency,
                    ),
                  ],
                  [
                    "Total return",
                    formatSignedPercent(data.position.totalGainLossPercent),
                  ],
                ].map(([label, value]) => (
                  <div
                    className="flex items-center justify-between gap-4"
                    key={label}
                  >
                    <span className="text-sm text-muted-foreground">
                      {label}
                    </span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="font-medium">No current demo position.</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This stock is available as seeded market context
                    {data.watchlist ? " and appears on the watchlist." : "."}
                  </p>
                </div>
              )}
              {data.watchlist ? (
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">
                      Watchlist target
                    </span>
                    <span className="text-sm font-medium">
                      {data.watchlist.targetPrice
                        ? formatCurrency(
                            data.watchlist.targetPrice,
                            stock.currency,
                          )
                        : "No target"}
                    </span>
                  </div>
                  {data.watchlist.notes ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {data.watchlist.notes}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          {PERFORMANCE_PERIODS.map((period) => (
            <Card key={period}>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  {period}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">
                  {formatSignedPercent(data.periodReturns[period])}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Risk flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.relatedAlerts.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                  <AlertTriangle className="size-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No active deterministic risk signals for this stock.
                  </p>
                </div>
              ) : (
                data.relatedAlerts.map((alert) => (
                  <Link
                    className="block rounded-lg border p-4 transition hover:bg-muted/30"
                    href="/alerts"
                    key={alert.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          alert.severity === "HIGH" ? "destructive" : "outline"
                        }
                      >
                        {alert.severity.toLowerCase()}
                      </Badge>
                      <Badge variant="outline">
                        {alert.type.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-3 font-medium">{alert.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {alert.message}
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Company context</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                ["Ticker", stock.ticker],
                ["Company", stock.companyName],
                ["Sector", stock.sector],
                ["Industry", stock.industry],
                ["Exchange", stock.exchange],
                ["Currency", stock.currency],
              ].map(([label, value]) => (
                <div className="rounded-lg border p-3" key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-medium">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              AI research layer
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Explainable stock research
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Deterministic specialist agents interpret seeded facts, surface
              missing data, and preserve their evidence alongside the synthesis.
            </p>
          </div>
          <ResearchTabs initialResearch={research} ticker={stock.ticker} />
        </section>
      </PageShell>
    </AppLayout>
  );
}
