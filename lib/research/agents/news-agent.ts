import type { ResearchProviderData } from "@/lib/research/providers/provider";
import type { AgentResult } from "@/lib/research/types";

export function runNewsAgent(data: ResearchProviderData): AgentResult {
  const item = data.news[0];
  if (!item) {
    return {
      agentName: "NEWS",
      status: "COMPLETED",
      rating: "NEUTRAL",
      confidence: 0.35,
      summary: "No seeded news scenario is available for this stock.",
      findings: [],
      sources: [],
      warnings: ["News coverage is missing from the deterministic dataset."],
    };
  }

  return {
    agentName: "NEWS",
    status: "COMPLETED",
    rating:
      item.tone === "positive"
        ? "BULLISH"
        : item.tone === "mixed"
          ? "MIXED"
          : "NEUTRAL",
    confidence: 0.76,
    summary: item.context,
    findings: [{ label: "Seeded research scenario", detail: item.headline }],
    sources: [
      {
        title: "PortfolioScope seeded news scenario",
        reference: `seed://research/${data.ticker}/news`,
        detail: "Deterministic demo input; not a live news feed.",
      },
    ],
    warnings: [
      "This scenario is illustrative and may not reflect current events.",
    ],
  };
}
