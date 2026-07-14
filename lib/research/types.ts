export const SPECIALIST_AGENT_NAMES = [
  "NEWS",
  "FINANCIALS",
  "COMPETITORS",
  "POLITICAL_ACTIVITY",
  "RISK",
] as const;

export type SpecialistAgentName = (typeof SPECIALIST_AGENT_NAMES)[number];
export type ResearchAgentName = SpecialistAgentName | "SYNTHESIS";
export type ResearchRating = "BEARISH" | "NEUTRAL" | "BULLISH" | "MIXED";
export type ResearchRunStatus = "COMPLETED" | "FAILED";

export type ResearchFinding = {
  label: string;
  detail: string;
};

export type ResearchSource = {
  title: string;
  reference: string;
  detail: string;
};

export type AgentResult = {
  agentName: ResearchAgentName;
  status: ResearchRunStatus;
  rating: ResearchRating;
  confidence: number;
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  warnings: string[];
};

export type SynthesisReport = {
  overview: string;
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  missingData: string[];
  confidence: number;
};

export type StockResearch = {
  jobId: string;
  ticker: string;
  companyName: string;
  status: "COMPLETED";
  generatedAt: string;
  expiresAt: string;
  agents: AgentResult[];
  report: SynthesisReport;
};
