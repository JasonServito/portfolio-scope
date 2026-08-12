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

export type ResearchEvidenceRecord = {
  id: string;
  sourceKind:
    | "SEC_FACT"
    | "SEC_FILING"
    | "COMPANY_PROFILE"
    | "PEER_SET"
    | "DETERMINISTIC";
  title: string;
  sourceReference: string;
  sourceUrl: string | null;
  accessionNumber: string | null;
  section: string | null;
  sourceDate: string | null;
  retrievedAt: string | null;
  excerpt: string;
};

export type ResearchEvidenceReference = ResearchEvidenceRecord & {
  role: "SUPPORTING" | "COUNTER";
};

export type ResearchClaim = {
  id: string;
  claimKey: string;
  category: "SUPPORTIVE" | "COUNTERPOINT" | "RISK";
  statement: string;
  confidence: number;
  assumptions: string[];
  sourceDate: string | null;
  asOfDate: string;
  evidence: ResearchEvidenceReference[];
};

export type ResearchModelMetadata = {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  outputSchemaVersion: string | null;
  retrievalVersion: string | null;
  calculationVersion: string | null;
  sourceDataVersion: string | null;
  inputDataVersion: string | null;
  reportVersion: string | null;
  sourceSnapshotSha256: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
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
  claims?: Array<{
    category: "SUPPORTIVE" | "COUNTERPOINT" | "RISK";
    statement: string;
    confidence: number;
    evidenceIds: string[];
    counterEvidenceIds: string[];
    assumptions: string[];
  }>;
  missingData?: string[];
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string | null;
  agentVersion?: string | null;
};

export type SynthesisReport = {
  rating?: ResearchRating;
  overview: string;
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  missingData: string[];
  confidence: number;
  disagreements?: string[];
};

export type StockResearch = {
  jobId: string;
  ticker: string;
  companyName: string;
  status: "COMPLETED";
  generatedAt: string;
  expiresAt: string;
  generationMode?: "DETERMINISTIC" | "RECORDED" | "EXTERNAL";
  agents: AgentResult[];
  report: SynthesisReport;
  claims?: ResearchClaim[];
  evidenceRegistry?: ResearchEvidenceRecord[];
  metadata?: ResearchModelMetadata;
};
