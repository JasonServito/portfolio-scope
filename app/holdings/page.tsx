import { DemoJourney } from "@/components/demo/demo-journey";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { AddHoldingForm } from "@/components/holdings/holding-actions";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { AsOfStamp } from "@/components/ui/as-of-stamp";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { signTone, StatCard } from "@/components/ui/stat-card";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { getDemoHoldingsPageData } from "@/lib/portfolio/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const data = await getDemoHoldingsPageData();
  const readOnly = true;

  return (
    <AppLayout>
      <PageShell
        description="Every position in the sample portfolio, with its cost, value, and return over each period"
        eyebrow="North Star Portfolio · Read-only demo"
        title="Holdings"
      >
        <DemoJourney currentStep={2} />
        {!data ? (
          <Card>
            <CardContent>
              <DataState
                description="The sample portfolio could not be loaded. No positions have been made up."
                kind="missing"
                title="Holdings data is unavailable"
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              <AsOfStamp asOf={data.asOf} note="Sample portfolio and prices" />
              <section
                aria-label="Holdings summary"
                className="grid gap-4 md:grid-cols-3"
              >
                <StatCard
                  detail="Current market value"
                  label="Portfolio value"
                  value={formatCurrency(
                    data.summary.marketValue,
                    data.portfolio.baseCurrency,
                  )}
                />
                <StatCard
                  change={formatSignedPercent(data.summary.unrealizedGainPercent)}
                  changeTone={signTone(data.summary.unrealizedGainPercent)}
                  detail="vs cost basis"
                  label="Unrealized gain"
                  value={formatSignedCurrency(
                    data.summary.unrealizedGain,
                    data.portfolio.baseCurrency,
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

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Current positions</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Read-only demo</Badge>
                    <AddHoldingForm readOnly={readOnly} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground md:hidden">
                  Scroll sideways to compare every return period
                </p>
              </CardHeader>
              <CardContent>
                <HoldingsTable
                  currency={data.portfolio.baseCurrency}
                  holdings={data.holdings}
                  readOnly={readOnly}
                />
              </CardContent>
            </Card>
          </>
        )}
      </PageShell>
    </AppLayout>
  );
}
