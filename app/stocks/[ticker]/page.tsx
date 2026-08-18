import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Database,
  LineChart,
} from "lucide-react";
import { notFound } from "next/navigation";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import { DemoJourney } from "@/components/demo/demo-journey";
import { SecFundamentals } from "@/components/stocks/sec-fundamentals";
import { TradingViewWidget } from "@/components/stocks/tradingview-widget";
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
import { secEdgarFundamentalsProvider } from "@/lib/sec/fundamentals-provider";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";

export const dynamic = "force-dynamic";

type StockPageProps = {
  params: Promise<{
    ticker: string;
  }>;
};

export default async function StockPage({ params }: StockPageProps) {
  if (!isFeatureEnabled("PUBLIC_STOCK_PAGES_ENABLED")) {
    notFound();
  }

  const { ticker } = await params;
  const [data, research, fundamentals] = await Promise.all([
    getDemoStockDetail(ticker),
    getLatestResearch(ticker),
    secEdgarFundamentalsProvider.getFundamentals(ticker),
  ]);

  if (!data) {
    notFound();
  }

  const { stock } = data;
  const riskSeverity = data.relatedAlerts[0]?.severity ?? "LOW";

  return (
    <AppLayout>
      <AnalyticsEvent
        name="stock_page_viewed"
        properties={{ ticker: stock.ticker }}
      />
      {research ? (
        <AnalyticsEvent
          name="research_report_viewed"
          properties={{ reportMode: "demo", ticker: stock.ticker }}
        />
      ) : null}
      <PageShell
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "ghost" })}
              href="/holdings"
            >
              <ArrowLeft className="size-4" />
              Holdings
            </Link>
            <Link className={buttonVariants()} href="#research">
              View research
              <ArrowRight className="size-4" />
            </Link>
          </>
        }
        description={`${stock.companyName} market context, financial fundamentals, demo position exposure, and risk signals.`}
        eyebrow="Stock detail"
        title={stock.ticker}
      >
        <DemoJourney currentStep={3} />

        <nav
          aria-label="Stock detail sections"
          className="scrollbar-none flex gap-2 overflow-x-auto rounded-xl border bg-card p-2"
        >
          {[
            ["#market-context", "Market context"],
            ["#fundamentals", "SEC fundamentals"],
            ["#risk", "Risk flags"],
            ["#research", "Research"],
          ].map(([href, label]) => (
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>

        <section className="flex flex-col gap-5 rounded-2xl border bg-foreground p-6 text-background md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-[-0.025em]">
                {stock.companyName}
              </h2>
              <Badge
                className="border-background/20 text-background"
                variant="outline"
              >
                {stock.exchange}
              </Badge>
              <Badge
                className="border-background/20 text-background"
                variant="outline"
              >
                {stock.currency}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-background/55">
              {stock.sector} / {stock.industry}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-background/60">
              <span className="flex items-center gap-1.5 rounded-full border border-background/15 px-2.5 py-1">
                <LineChart className="size-3 text-[#6ee7b7]" />
                Market context: TradingView
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-background/15 px-2.5 py-1">
                <Database className="size-3 text-[#6ee7b7]" />
                Fundamentals: SEC EDGAR
              </span>
            </div>
          </div>
          <div className="md:text-right">
            <p className="text-3xl font-semibold tracking-normal">
              {data.latestPrice !== null
                ? formatCurrency(data.latestPrice, stock.currency)
                : "Market widget below"}
            </p>
            <p className="mt-1 text-sm text-background/55">
              {data.asOf
                ? `Seeded portfolio fixture as of ${new Date(data.asOf).toLocaleDateString("en-US")}`
                : "No PortfolioScope-owned price fixture for this ticker"}
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            [
              "Last price",
              data.latestPrice !== null
                ? formatCurrency(data.latestPrice, stock.currency)
                : "Unavailable",
              "Seeded fixture; TradingView is separate",
            ],
            [
              "1M move",
              data.periodReturns["1M"] !== null
                ? formatSignedPercent(data.periodReturns["1M"])
                : "Unavailable",
              "Seeded fixture performance",
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

        <section
          className="grid scroll-mt-28 gap-4 lg:grid-cols-[1.4fr_1fr]"
          id="market-context"
        >
          <Card>
            <CardHeader>
              <CardTitle>Public market chart</CardTitle>
            </CardHeader>
            <CardContent>
              <TradingViewWidget
                exchange={stock.exchange}
                ticker={stock.ticker}
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
                  {data.periodReturns[period] !== null
                    ? formatSignedPercent(data.periodReturns[period])
                    : "Unavailable"}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section
          aria-labelledby="sec-fundamentals-heading"
          className="scroll-mt-28"
          id="fundamentals"
        >
          <h2 className="sr-only" id="sec-fundamentals-heading">
            SEC fundamentals and provenance
          </h2>
          <SecFundamentals data={fundamentals} />
        </section>

        <section
          className="grid scroll-mt-28 gap-4 lg:grid-cols-[1fr_1fr]"
          id="risk"
        >
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

        <section className="scroll-mt-28 space-y-4" id="research">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Stock research
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              Explainable stock research
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review the available findings, risks, counterpoints, missing
              information, and supporting sources for this company.
            </p>
          </div>
          <ResearchTabs
            initialResearch={research}
            readOnly
            ticker={stock.ticker}
          />
        </section>
      </PageShell>
    </AppLayout>
  );
}
