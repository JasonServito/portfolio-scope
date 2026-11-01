import { signTone, StatCard } from "@/components/ui/stat-card";
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function SummaryCards({ alertCount, analytics }: SummaryCardsProps) {
  const currency = analytics.portfolio.baseCurrency;
  const periodStart = analytics.performance[0]?.date;

  return (
    <section
      aria-label="Portfolio summary"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatCard
        change={formatSignedCurrency(analytics.summary.unrealizedGain, currency)}
        changeTone={signTone(analytics.summary.unrealizedGain)}
        detail="vs cost basis"
        label="Total value"
        value={formatCurrency(analytics.summary.marketValue, currency)}
      />
      <StatCard
        detail="What the current shares cost"
        label="Cost basis"
        value={formatCurrency(analytics.summary.costBasis, currency)}
      />
      <StatCard
        change={formatSignedCurrency(analytics.summary.periodGainLoss, currency)}
        changeTone={signTone(analytics.summary.periodGainLoss)}
        detail={
          periodStart ? `since ${formatShortDate(periodStart)}` : "over the period"
        }
        label={`${analytics.period} return`}
        value={formatSignedPercent(analytics.summary.periodReturn)}
      />
      <StatCard
        detail={alertCount === 0 ? "Nothing to review" : "Signals to review"}
        label="Active alerts"
        value={String(alertCount)}
      />
    </section>
  );
}
