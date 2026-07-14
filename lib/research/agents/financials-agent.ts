import type { ResearchProviderData } from "@/lib/research/providers/provider";
import type { AgentResult } from "@/lib/research/types";

export function runFinancialsAgent(data: ResearchProviderData): AgentResult {
  return {
    agentName: "FINANCIALS",
    status: "COMPLETED",
    rating: "NEUTRAL",
    confidence: 0.72,
    summary: `${data.companyName} is modeled with a ${data.financials.growthProfile.toLowerCase()} and ${data.financials.marginProfile.toLowerCase()}.`,
    findings: [
      { label: "Growth", detail: data.financials.growthProfile },
      { label: "Margins", detail: data.financials.marginProfile },
      { label: "Balance sheet", detail: data.financials.balanceSheetProfile },
    ],
    sources: [
      {
        title: "PortfolioScope seeded financial profile",
        reference: `seed://research/${data.ticker}/financials`,
        detail:
          "Normalized qualitative demo inputs; not reported financial statements.",
      },
    ],
    warnings: [
      "The MVP does not include live filings, estimates, or valuation data.",
    ],
  };
}
