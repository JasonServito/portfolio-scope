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
export type ResearchGenerationMode = "DETERMINISTIC" | "RECORDED" | "EXTERNAL";
export type AgentAvailability = "COMPLETE" | "PARTIAL" | "NOT_AVAILABLE";
export type ResearchClaimKind = "FACT" | "DERIVED" | "INTERPRETATION";

/**
 * Specialists scheduled for a new evidence-grounded job. Political activity is
 * no longer scheduled because no verified source exists; the enum value stays
 * so historical runs remain readable. News stays scheduled and reports an
 * explicit not-available state until a licensed source is supplied.
 */
export const EXTERNAL_SPECIALIST_AGENT_NAMES = [
  "NEWS",
  "FINANCIALS",
  "COMPETITORS",
  "RISK",
] as const satisfies readonly SpecialistAgentName[];

/** The prebuilt deterministic path keeps its original five topics. */
export function scheduledSpecialistAgentNames(
  generationMode: ResearchGenerationMode,
): readonly SpecialistAgentName[] {
  return generationMode === "DETERMINISTIC"
    ? SPECIALIST_AGENT_NAMES
    : EXTERNAL_SPECIALIST_AGENT_NAMES;
}

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
    | "DETERMINISTIC"
    | "DERIVED";
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
  /** Null for claims persisted before kinds were recorded. */
  kind: ResearchClaimKind | null;
  statement: string;
  confidence: number;
  assumptions: string[];
  sourceDate: string | null;
  asOfDate: string;
  evidence: ResearchEvidenceReference[];
};

/**
 * Deterministic measure of how much of the expected evidence the snapshot
 * held when the report was generated. It is computed from the snapshot, not
 * reported by the model, and replaces model confidence as the headline number.
 */
export type ResearchEvidenceCoverage = {
  version: string;
  score: number;
  expectedMetrics: { present: number; total: number };
  derivedMetrics: { available: number; total: number };
  structuredEvidence: { present: number; total: number; missing: string[] };
  newestFilingDate: string | null;
  newestFilingAgeDays: number | null;
  freshness: number;
};

export type ResearchUpcomingEarnings = {
  eventDate: string;
  marketSession: string | null;
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
  /** Null for runs persisted before availability was recorded. */
  availability?: AgentAvailability | null;
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  warnings: string[];
  claims?: Array<{
    category: "SUPPORTIVE" | "COUNTERPOINT" | "RISK";
    kind?: ResearchClaimKind;
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
  whatWouldChange?: string[];
  evidenceCoverage?: ResearchEvidenceCoverage | null;
  upcomingEarnings?: ResearchUpcomingEarnings | null;
};

export type StockResearch = {
  jobId: string;
  ticker: string;
  companyName: string;
  status: "COMPLETED";
  generatedAt: string;
  expiresAt: string;
  generationMode?: ResearchGenerationMode;
  agents: AgentResult[];
  report: SynthesisReport;
  claims?: ResearchClaim[];
  evidenceRegistry?: ResearchEvidenceRecord[];
  metadata?: ResearchModelMetadata;
};
