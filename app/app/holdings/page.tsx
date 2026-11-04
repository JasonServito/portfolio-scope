import type { Metadata } from "next";
import Link from "next/link";

import { HoldingsTable } from "@/components/holdings/holdings-table";
import { AddHoldingForm } from "@/components/holdings/holding-actions";
import { PageShell } from "@/components/layout/page-shell";
import { PortfolioNameForm } from "@/components/portfolios/portfolio-forms";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { signTone, StatCard } from "@/components/ui/stat-card";
import { requireUser } from "@/lib/auth/session";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { getOwnedHoldingsPageData } from "@/lib/portfolio/dashboard-data";
import {
  getPrimaryPortfolio,
  listPricedTickers,
} from "@/lib/portfolio/management";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Holdings" };

export default async function PrivateHoldingsPage() {
  const user = await requireUser("/app/holdings");
  const portfolio = await getPrimaryPortfolio(user.id);

  if (!portfolio) {
    return (
      <PageShell
        description="Every position in your portfolio, with its cost, value, and return over each period"
        eyebrow="Your account"
        title="Holdings"
      >
        <Card>
          <CardContent>
            <DataState
              action={
                <Link className={buttonVariants()} href="/app" prefetch={false}>
                  Create your portfolio
                </Link>
              }
              description="Create your portfolio on the dashboard first, then add the stocks you own here."
              kind="empty"
              title="You don't have a portfolio yet"
            />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const [data, tickers] = await Promise.all([
    getOwnedHoldingsPageData(user.id, portfolio.id),
    listPricedTickers(),
  ]);

  return (
    <PageShell
      description="Every position in your portfolio, with its cost, value, and return over each period"
      eyebrow={`${portfolio.name} · Your portfolio`}
      title="Holdings"
    >
      {data ? (
        <div className="space-y-3">
          <AsOfStamp
            asOf={data.asOf}
            note="Your holdings at cached sample prices"
          />
          <section
            aria-label="Holdings summary"
            className="grid gap-4 md:grid-cols-3"
          >
            <StatCard
              detail="Current market value"
              label="Portfolio value"
              value={formatCurrency(
                data.summary.marketValue,
                portfolio.baseCurrency,
              )}
            />
            <StatCard
              change={formatSignedPercent(data.summary.unrealizedGainPercent)}
              changeTone={signTone(data.summary.unrealizedGainPercent)}
              detail="vs cost basis"
              label="Unrealized gain"
              value={formatSignedCurrency(
                data.summary.unrealizedGain,
                portfolio.baseCurrency,
              )}
            />
            <StatCard
              detail={`Across ${
                new Set(data.holdings.map((holding) => holding.sector)).size
              } sectors`}
              label="Positions"
              value={String(data.holdings.length)}
            />
          </section>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Current positions</CardTitle>
            <AddHoldingForm portfolioId={portfolio.id} tickers={tickers} />
          </div>
          {data ? (
            <p className="mt-1 text-xs text-muted-foreground md:hidden">
              Scroll sideways to compare every return period
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {data ? (
            <HoldingsTable
              currency={portfolio.baseCurrency}
              holdings={data.holdings}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No holdings yet. Add the stocks you own, with shares and average
              cost.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <PortfolioNameForm
            initialName={portfolio.name}
            portfolioId={portfolio.id}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
