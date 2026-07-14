import type { ResearchProviderData } from "@/lib/research/providers/provider";
import type { AgentResult } from "@/lib/research/types";

export function runPoliticalActivityAgent(
  data: ResearchProviderData,
): AgentResult {
  return {
    agentName: "POLITICAL_ACTIVITY",
    status: "COMPLETED",
    rating: "NEUTRAL",
    confidence: data.politicalActivity.disclosed ? 0.65 : 0.3,
    summary: data.politicalActivity.summary,
    findings: data.politicalActivity.disclosed
      ? [{ label: "Disclosure", detail: data.politicalActivity.summary }]
      : [],
    sources: data.politicalActivity.disclosed
      ? [
          {
            title: "Seeded political activity dataset",
            reference: `seed://research/${data.ticker}/political-activity`,
            detail: "Deterministic demo disclosure.",
          },
        ]
      : [],
    warnings: data.politicalActivity.disclosed
      ? []
      : [
          "Missing data is shown explicitly; absence of seeded data is not evidence that no activity occurred.",
        ],
  };
}
