import type {
  RiskAlertSeverity,
  RiskAlertType,
} from "@/lib/portfolio/risk-alerts";
import { cn } from "@/lib/utils";

const severityDot: Record<RiskAlertSeverity, string> = {
  HIGH: "bg-negative",
  MEDIUM: "bg-caution",
  LOW: "bg-muted-foreground/40",
};

export const severityLabels: Record<RiskAlertSeverity, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const alertTypeLabels: Record<RiskAlertType, string> = {
  CONCENTRATION: "Concentration",
  DRAWDOWN: "Drawdown",
  PRICE_MOVE: "Price move",
  VOLATILITY: "Volatility",
  WATCHLIST_MOVE: "Watchlist move",
};

export function SeverityLabel({
  severity,
  ticker,
  type,
}: {
  severity: RiskAlertSeverity;
  ticker?: string | null;
  type?: RiskAlertType;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "mr-0.5 size-1.5 shrink-0 rounded-full",
          severityDot[severity],
        )}
      />
      {severityLabels[severity]}
      {type ? (
        <>
          <span aria-hidden="true">·</span>
          {alertTypeLabels[type]}
        </>
      ) : null}
      {ticker ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{ticker}</span>
        </>
      ) : null}
    </span>
  );
}
