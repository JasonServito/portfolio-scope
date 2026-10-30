import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";

import { AnalyticsEvent } from "@/components/analytics/analytics-event";
import {
  severityLabels,
  SeverityLabel,
} from "@/components/alerts/severity-label";
import { DemoJourney } from "@/components/demo/demo-journey";
import { SecFundamentals } from "@/components/stocks/sec-fundamentals";
import { TradingViewWidget } from "@/components/stocks/tradingview-widget";
import { ResearchTabs } from "@/components/research/research-tabs";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signTone, StatCard } from "@/components/ui/stat-card";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { getDemoStockDetail } from "@/lib/portfolio/stock-detail";
import { PERFORMANCE_PERIODS } from "@/lib/portfolio/types";
import { getLatestResearch } from "@/lib/research/orchestrator";
import { secEdgarFundamentalsProvider } from "@/lib/sec/fundamentals-provider";
import { isFeatureEnabled } from "@/lib/operations/feature-flags";
import { cn } from "@/lib/utils";

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
  const alertCount = data.relatedAlerts.length;

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
              prefetch={false}
            >
              <ArrowLeft className="size-4" />
              Holdings
            </Link>
            <a className={buttonVariants()} href="#research">
              View research
              <ArrowRight className="size-4" />
            </a>
          </>
        }
        description={`${stock.companyName} price, position, filings, and research in one place`}
        eyebrow={`${stock.companyName} · ${stock.exchange}`}
        title={stock.ticker}
      >
        <DemoJourney currentStep={3} />

        <nav
          aria-label="Stock detail sections"
          className="scrollbar-none flex gap-1 overflow-x-auto border-b"
        >
          {[
            ["#market-context", "Market context"],
            ["#fundamentals", "Financials"],
            ["#risk", "Risk flags"],
            ["#research", "Research"],
          ].map(([href, label]) => (
            <a
              className="shrink-0 rounded-sm px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
        </nav>

        <Card>
          <CardContent>
            <h2 className="text-lg font-medium">{stock.companyName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {stock.sector} · {stock.industry} · {stock.exchange} ·{" "}
              {stock.currency}
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {stock.description}
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {data.asOf ? (
            <AsOfStamp asOf={data.asOf} note="Sample prices" />
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              No sample price for this ticker
            </p>
          )}
          <section
            aria-label="Stock summary"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              detail={
                data.latestPrice !== null
                  ? "Latest sample close"
                  : "See the market chart below"
              }
              label="Closing price"
              value={
                data.latestPrice !== null
                  ? formatCurrency(data.latestPrice, stock.currency)
                  : "Unavailable"
              }
            />
            <StatCard
              detail="Price change over one month"
              label="1M move"
              value={
                data.periodReturns["1M"] !== null
                  ? formatSignedPercent(data.periodReturns["1M"])
                  : "Unavailable"
              }
            />
            <StatCard
              detail={
                data.position
                  ? "Of the demo portfolio"
                  : data.watchlist
                    ? "On the watchlist"
                    : "Not in the demo portfolio"
              }
              label="Portfolio weight"
              value={
                data.position
                  ? formatPercent(data.position.allocationPercent, 1)
                  : "Not held"
              }
            />
            <StatCard
              detail={`${alertCount} active signal${alertCount === 1 ? "" : "s"}`}
              label="Alert status"
              value={alertCount > 0 ? severityLabels[riskSeverity] : "Clear"}
            />
          </section>
        </div>

        <section
          className="grid scroll-mt-28 gap-4 lg:grid-cols-[1.4fr_1fr]"
          id="market-context"
        >
          <Card>
            <CardHeader>
              <CardTitle>Market chart</CardTitle>
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
            <CardContent>
              {data.position ? (
                <dl className="divide-y text-sm">
                  {[
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
                      signTone(data.position.totalGainLoss),
                    ],
                    [
                      "Total return",
                      formatSignedPercent(data.position.totalGainLossPercent),
                      signTone(data.position.totalGainLossPercent),
                    ],
                  ].map(([label, value, tone]) => (
                    <div
                      className="flex items-center justify-between gap-4 py-2.5 first:pt-0"
                      key={label}
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className={cn("font-medium tabular-nums", tone)}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div>
                  <p className="text-sm font-medium">
                    Not held in the demo portfolio
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Shown for market context
                    {data.watchlist ? " and on the watchlist" : ""}
                  </p>
                </div>
              )}
              {data.watchlist ? (
                <div className="mt-4 border-t pt-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      Watchlist target
                    </span>
                    <span className="font-medium tabular-nums">
                      {data.watchlist.targetPrice
                        ? formatCurrency(
                            data.watchlist.targetPrice,
                            stock.currency,
                          )
                        : "No target"}
                    </span>
                  </div>
                  {data.watchlist.notes ? (
                    <p className="mt-2 text-muted-foreground">
                      {data.watchlist.notes}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Price change by period</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-5 divide-x">
              {PERFORMANCE_PERIODS.map((period) => {
                const value = data.periodReturns[period];

                return (
                  <div className="px-2 first:pl-0 sm:px-4" key={period}>
                    <dt className="font-mono text-xs text-muted-foreground">
                      {period}
                    </dt>
                    <dd
                      className={cn(
                        "mt-1 text-sm font-medium tabular-nums sm:text-lg",
                        value !== null && signTone(value),
                      )}
                    >
                      {value !== null ? formatSignedPercent(value) : "Unavailable"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </CardContent>
        </Card>

        <section className="scroll-mt-28" id="fundamentals">
          <SecFundamentals data={fundamentals} />
        </section>

        <section
          className="grid scroll-mt-28 gap-4 lg:grid-cols-[1fr_1fr] lg:items-start"
          id="risk"
        >
          <Card>
            <CardHeader>
              <CardTitle>Risk flags</CardTitle>
            </CardHeader>
            <CardContent>
              {data.relatedAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active risk signals for this stock
                </p>
              ) : (
                <ul className="divide-y">
                  {data.relatedAlerts.map((alert) => (
                    <li key={alert.id}>
                      <Link
                        className="-mx-2 block rounded-sm px-2 py-3 transition-colors first:pt-0 hover:bg-muted"
                        href="/alerts"
                        prefetch={false}
                      >
                        <SeverityLabel
                          severity={alert.severity}
                          type={alert.type}
                        />
                        <span className="mt-1.5 block text-sm font-medium">
                          {alert.title}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {alert.message}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Company context</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
                {[
                  ["Ticker", stock.ticker],
                  ["Company", stock.companyName],
                  ["Sector", stock.sector],
                  ["Industry", stock.industry],
                  ["Exchange", stock.exchange],
                  ["Currency", stock.currency],
                ].map(([label, value]) => (
                  <div
                    className="flex items-center justify-between gap-4 border-b py-2.5"
                    key={label}
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </section>

        <section className="scroll-mt-28 space-y-4" id="research">
          <div>
            <p className="text-sm text-muted-foreground">Stock research</p>
            <h2 className="mt-1 text-2xl font-medium">
              Explainable stock research
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review the summary, strengths, risks, what to watch, and
              supporting evidence available for this company.
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
