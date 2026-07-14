import type { ResearchProviderData } from "@/lib/research/providers/provider";
import type { AgentResult } from "@/lib/research/types";

function percent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function runRiskAgent(data: ResearchProviderData): AgentResult {
  const elevatedMove = data.risk.maxDailyMove >= 0.04;
  const concentrated = (data.risk.portfolioWeight ?? 0) >= 0.2;
  const warnings = [
    ...(elevatedMove
      ? ["Seeded price history includes a daily move of at least 4%."]
      : []),
    ...(concentrated
      ? ["The position exceeds 20% of seeded portfolio cost basis."]
      : []),
    ...data.risk.activeAlerts,
  ];
  return {
    agentName: "RISK",
    status: "COMPLETED",
    rating: warnings.length > 0 ? "MIXED" : "NEUTRAL",
    confidence: 0.84,
    summary:
      warnings.length > 0
        ? `${warnings.length} deterministic risk signal${warnings.length === 1 ? "" : "s"} warrant context, without implying an investment action.`
        : "No elevated deterministic risk threshold is triggered by the seeded inputs.",
    findings: [
      { label: "30-day price move", detail: percent(data.risk.oneMonthReturn) },
      {
        label: "Largest seeded daily move",
        detail: percent(data.risk.maxDailyMove),
      },
      {
        label: "Portfolio cost-basis weight",
        detail:
          data.risk.portfolioWeight === null
            ? "Not held"
            : percent(data.risk.portfolioWeight),
      },
    ],
    sources: [
      {
        title: "PortfolioScope seeded price and portfolio data",
        reference: `seed://research/${data.ticker}/risk`,
        detail:
          "Calculated from visible seeded prices, holdings, and active alerts.",
      },
    ],
    warnings,
  };
}
