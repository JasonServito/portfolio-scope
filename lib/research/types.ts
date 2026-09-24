export const SPECIALIST_AGENT_NAMES = [
  "NEWS",
  "FINANCIALS",
  "COMPETITORS",
  "POLITICAL_ACTIVITY",
  "RISK",
] as const;

export type SpecialistAgentName = (typeof SPECIALIST_AGENT_NAMES)[number];
export type ResearchAgentName = SpecialistAgentName | "SYNTHESIS";

/**
 * Product label of the News specialist. It keeps its enum name but reports
 * events taken from SEC current reports (M32), never third-party news, so
 * the label says what it actually covers.
 */
export const RECENT_EVENTS_LABEL = "Recent events from filings";
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

/**
 * Model specialists whose job is queued only after every other scheduled
 * specialist has completed. Three concurrent specialist reservations already
 * fill the per-job token cap, so the News specialist (a model call since
 * M32) runs as a second stage; the prebuilt path makes no model call and
 * queues everything at once.
 */
export const DEFERRED_EXTERNAL_SPECIALIST_AGENT_NAMES = [
  "NEWS",
] as const satisfies readonly SpecialistAgentName[];

export function deferredSpecialistAgentNames(
  generationMode: ResearchGenerationMode,
): readonly SpecialistAgentName[] {
  return generationMode === "DETERMINISTIC"
    ? []
    : DEFERRED_EXTERNAL_SPECIALIST_AGENT_NAMES;
}

/** Specialists queued when the research job is created. */
export function initialSpecialistAgentNames(
  generationMode: ResearchGenerationMode,
): readonly SpecialistAgentName[] {
  const deferred = deferredSpecialistAgentNames(generationMode);
  return scheduledSpecialistAgentNames(generationMode).filter(
    (agentName) => !deferred.includes(agentName),
  );
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
  verificationStatus?:
    | "UNVERIFIED"
    | "SUPPORTED"
    | "PARTIALLY_SUPPORTED"
    | "UNSUPPORTED"
    | "CONTRADICTED";
  contradictingEvidenceIds?: string[];
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

/**
 * A recent company event as described by the News specialist, derived at
 * read time from its validated claims and the 8-K current report each
 * claim cites. An event without a cited 8-K never reaches the report.
 */
export type ResearchRecentEvent = {
  filingDate: string;
  formType: string;
  accessionNumber: string | null;
  statement: string;
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
  verificationCompleted?: boolean;
  contradictedClaims?: ResearchClaim[];
  whatWouldChange?: string[];
  evidenceCoverage?: ResearchEvidenceCoverage | null;
  upcomingEarnings?: ResearchUpcomingEarnings | null;
  recentEvents?: ResearchRecentEvent[];
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
