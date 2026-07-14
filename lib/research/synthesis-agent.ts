import type { AgentResult, SynthesisReport } from "@/lib/research/types";

export function synthesizeResearch(
  companyName: string,
  agents: AgentResult[],
): SynthesisReport {
  const completed = agents.filter((agent) => agent.status === "COMPLETED");
  if (completed.length === 0) {
    return {
      overview: `No specialist research is available for ${companyName}.`,
      bullCase: [],
      bearCase: [],
      risks: [],
      missingData: ["All specialist agent outputs are missing."],
      confidence: 0,
    };
  }
  const positive = completed.filter((agent) => agent.rating === "BULLISH");
  const risk = completed.find((agent) => agent.agentName === "RISK");
  const missingData = completed.flatMap((agent) =>
    agent.sources.length === 0
      ? [
          `${agent.agentName.toLowerCase().replaceAll("_", " ")} sources are unavailable.`,
        ]
      : [],
  );
  const confidence =
    completed.reduce((sum, agent) => sum + agent.confidence, 0) /
    completed.length;
  return {
    overview: `${companyName} has ${completed.length} deterministic specialist views. The synthesis balances seeded operating context, peer coverage, and visible risk inputs; it is research context, not financial advice.`,
    bullCase: positive.flatMap((agent) =>
      agent.findings.slice(0, 1).map((finding) => finding.detail),
    ),
    bearCase: risk?.warnings.length
      ? risk.warnings.slice(0, 2)
      : [
          "The demo dataset does not include live valuation or estimate revisions.",
        ],
    risks: risk?.warnings.length
      ? risk.warnings
      : ["No elevated rule-based threshold is currently triggered."],
    missingData,
    confidence: Number(confidence.toFixed(3)),
  };
}
