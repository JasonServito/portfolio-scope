import { Activity, Landmark, TrendingUp, WalletCards } from "lucide-react";

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
      label: "Cost basis",
      value: formatCurrency(analytics.summary.costBasis, currency),
      detail: "Current seeded position basis",
      icon: Landmark,
    },
    {
      label: `${analytics.period} return`,
      value: formatSignedPercent(analytics.summary.periodReturn),
      detail: `${formatSignedCurrency(
        analytics.summary.periodGainLoss,
        currency,
      )} over selected period`,
      icon: TrendingUp,
    },
    {
      label: "Active alerts",
      value: String(alertCount),
      detail: alertCount === 1 ? "1 item needs review" : `${alertCount} items need review`,
      icon: Activity,
    },
  ];

  return (
    <section aria-label="Portfolio summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ detail, icon: Icon, label, value }, index) => (
        <Card className={index === 0 ? "bg-foreground text-background" : undefined} key={label}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className={index === 0 ? "text-sm text-background/55" : "text-sm text-muted-foreground"}>{label}</CardTitle>
            <span className={index === 0 ? "flex size-9 items-center justify-center rounded-lg bg-background/10 text-[#6ee7b7]" : "flex size-9 items-center justify-center rounded-lg bg-muted text-primary"}>
              <Icon className="size-4" />
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-normal">{value}</p>
            <p className={index === 0 ? "mt-2 text-sm text-background/55" : "mt-2 text-sm text-muted-foreground"}>{detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
