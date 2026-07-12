import { Activity, Bell, WalletCards } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import type { PortfolioAnalytics } from "@/lib/portfolio/types";

type SummaryCardsProps = {
  analytics: PortfolioAnalytics;
  alertCount: number;
};

export function SummaryCards({ alertCount, analytics }: SummaryCardsProps) {
  const currency = analytics.portfolio.baseCurrency;
  const cards = [
    {
      label: "Total value",
      value: formatCurrency(analytics.summary.marketValue, currency),
      detail: `${formatSignedCurrency(
        analytics.summary.unrealizedGain,
        currency,
      )} all-time unrealized`,
      icon: WalletCards,
    },
    {
      label: `${analytics.period} return`,
      value: formatSignedPercent(analytics.summary.periodReturn),
      detail: `${formatSignedCurrency(
        analytics.summary.periodGainLoss,
        currency,
      )} over selected period`,
      icon: Activity,
    },
    {
      label: "Active alerts",
      value: String(alertCount),
      detail: alertCount === 1 ? "1 item needs review" : `${alertCount} items need review`,
      icon: Bell,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map(({ detail, icon: Icon, label, value }) => (
        <Card key={label}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
            <span className="flex size-9 items-center justify-center rounded-md bg-muted">
              <Icon className="size-4" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-normal">{value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
