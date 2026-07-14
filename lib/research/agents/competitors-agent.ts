import type { ResearchProviderData } from "@/lib/research/providers/provider";
import type { AgentResult } from "@/lib/research/types";

export function runCompetitorsAgent(data: ResearchProviderData): AgentResult {
  const findings = data.competitors.map((peer) => ({
    label: peer.ticker,
    detail: `${peer.companyName} — ${peer.industry}`,
  }));
  return {
    agentName: "COMPETITORS",
    status: "COMPLETED",
    rating: "NEUTRAL",
    confidence: findings.length > 0 ? 0.7 : 0.4,
    summary:
      findings.length > 0
        ? `${data.companyName} is compared with ${findings.length} seeded peer${findings.length === 1 ? "" : "s"} selected by sector or industry.`
        : "No comparable company is available in the seeded universe.",
    findings,
    sources:
      findings.length > 0
        ? [
            {
              title: "PortfolioScope seeded stock universe",
              reference: `seed://research/${data.ticker}/peers`,
              detail:
                "Peers are selected deterministically from matching industries and sectors.",
            },
          ]
        : [],
    warnings:
      findings.length > 0
        ? ["Peer selection is limited to the ten-stock demo universe."]
        : ["Competitor coverage is missing for this stock."],
  };
}
