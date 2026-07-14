import { AlertTriangle } from "lucide-react";

import { HoldingsTable } from "@/components/holdings/holdings-table";
import { AddHoldingForm } from "@/components/holdings/holding-actions";
import { AppLayout } from "@/components/layout/app-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { getDemoHoldingsPageData } from "@/lib/portfolio/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const data = await getDemoHoldingsPageData();

  return (
    <AppLayout>
      <PageShell
        description="A polished table shell for portfolio positions, allocation, cost basis, and period returns."
        eyebrow="Portfolio"
        title="Holdings"
      >
        {!data ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-md bg-muted">
                <AlertTriangle className="size-5" />
              </span>
              <div>
                <p className="font-medium">Holdings data is unavailable.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Seed the database to load demo portfolio positions.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              {[
                [
                  "Portfolio value",
                  formatCurrency(
                    data.summary.marketValue,
                    data.portfolio.baseCurrency,
                  ),
                  "Current seeded market value",
                ],
                [
                  "Unrealized gain",
                  formatSignedCurrency(
                    data.summary.unrealizedGain,
                    data.portfolio.baseCurrency,
                  ),
                  formatSignedPercent(data.summary.unrealizedGainPercent),
                ],
                [
                  "Positions",
                  String(data.holdings.length),
                  "Seeded demo holdings",
                ],
              ].map(([title, value, detail]) => (
                <Card key={title}>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">
                      {title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-semibold tracking-normal">
                      {value}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {detail}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </section>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Current positions</CardTitle>
                  <AddHoldingForm />
                </div>
              </CardHeader>
              <CardContent>
                <HoldingsTable
                  currency={data.portfolio.baseCurrency}
                  holdings={data.holdings}
                />
              </CardContent>
            </Card>
          </>
        )}
      </PageShell>
    </AppLayout>
  );
}
