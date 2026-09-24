import {
  AAPL_GROUNDED_SYNTHESIS,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_RESEARCH_EVIDENCE,
} from "./curated-evaluation";
import {
  claimKey,
  evidenceId,
  type ModelClaim,
  type ResearchEvidence,
  type SpecialistModelOutput,
  type SynthesisModelOutput,
} from "../schemas";
import type { ClaimVerification } from "../verification";

export type VerificationEvaluationCase = {
  id: string;
  reviewNotes: string;
  output: SynthesisModelOutput;
  evidence: ResearchEvidence[];
  recording: ClaimVerification;
  expectedStatuses: ClaimVerification["results"][number]["status"][];
  rejectBeforeVerification?: boolean;
  specialist?: SpecialistModelOutput;
};

function report(
  claims: ModelClaim[],
  missingData: string[] = [],
): SynthesisModelOutput {
  return {
    rating: "NEUTRAL",
    confidence: 0.7,
    summary: "Recorded company evidence for source review.",
    claims,
    warnings: [],
    missingData,
    disagreements: [],
    whatWouldChange: [],
  };
}

function recording(
  output: SynthesisModelOutput,
  status: ClaimVerification["results"][number]["status"],
): ClaimVerification {
  return {
    results: output.claims.map((claim) => ({
      claimKey: claimKey(claim),
      status,
      contradictingEvidenceIds:
        status === "CONTRADICTED" ? claim.evidenceIds : [],
    })),
  };
}

const numerical = report([AAPL_GROUNDED_SYNTHESIS.claims[0]]);
const narrative = report([
  { ...AAPL_GROUNDED_SYNTHESIS.claims[6], category: "COUNTERPOINT" },
]);
const event = report([AAPL_RECORDED_SPECIALIST_OUTPUTS.NEWS.claims[0]]);
const partial = report([
  {
    ...narrative.claims[0],
    statement: `${narrative.claims[0].statement} These risks will worsen.`,
  },
]);
const unsupported = report([
  {
    ...AAPL_GROUNDED_SYNTHESIS.claims[3],
    statement: "The company has eliminated all competition.",
  },
]);
const amendmentExcerpt =
  "This amendment corrects the cover page only. It does not amend or restate the financial statements in the original annual report.";
const amendment: ResearchEvidence = {
  ...CURATED_RESEARCH_EVIDENCE.find(
    (item) => item.metadata.evidenceType === "SEC_FILING_PASSAGE",
  )!,
  id: evidenceId({
    accession: "0000320193-26-999999",
    excerpt: amendmentExcerpt,
  }),
  title: "Synthetic annual report amendment scope",
  sourceReference: "synthetic:10-K/A:cover-page-only",
  sourceUrl: null,
  accessionNumber: "0000320193-26-999999",
  section: "Explanatory note",
  excerpt: amendmentExcerpt,
  objectKey: null,
  sha256: null,
  secFilingId: null,
  secRawSourceId: null,
  passageStart: null,
  passageEnd: null,
  metadata: {
    formType: "10-K/A",
    evidenceType: "SEC_FILING_PASSAGE",
    synthetic: true,
  },
};
const amendmentOutput = report([
  {
    ...narrative.claims[0],
    statement: "The amendment restates the financial statements.",
    evidenceIds: [amendment.id],
    counterEvidenceIds: [],
  },
]);
const unavailableSpecialist: SpecialistModelOutput = {
  rating: "NEUTRAL",
  confidence: 0,
  availability: "NOT_AVAILABLE",
  summary: "Political activity is not assessed because no source is supplied.",
  claims: [],
  warnings: [],
  missingData: ["No political-activity evidence is supplied."],
};
const unavailable = report([], unavailableSpecialist.missingData);
const nearRecommendation = report([
  {
    ...numerical.claims[0],
    statement: "It may be prudent to add to your position in the stock.",
  },
]);

/** Agent-curated public/synthetic regression cases. Human activation review remains mandatory. */
export const M33_EVALUATION_CASES: VerificationEvaluationCase[] = [
  {
    id: "supported-numerical",
    reviewNotes:
      "M29 annual and quarterly growth retain their exact units and periods; the peer counter-citation is preserved.",
    output: numerical,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(numerical, "SUPPORTED"),
    expectedStatuses: ["SUPPORTED"],
  },
  {
    id: "narrative-counterpoint",
    reviewNotes:
      "M31 Risk Factors supports an attributed disclosure of regulatory exposure, not an independent exposure assessment.",
    output: narrative,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(narrative, "SUPPORTED"),
    expectedStatuses: ["SUPPORTED"],
  },
  {
    id: "current-report-event",
    reviewNotes:
      "M32 dated 8-K and its press-release passage jointly establish the announcement and figures; both citations are required.",
    output: event,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(event, "SUPPORTED"),
    expectedStatuses: ["SUPPORTED"],
  },
  {
    id: "not-available-specialist",
    reviewNotes:
      "The unavailable M30 specialist contributes no claims or negative findings. Its explicit source gap survives.",
    output: unavailable,
    specialist: unavailableSpecialist,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: { results: [] },
    expectedStatuses: [],
  },
  {
    id: "amendment-scope",
    reviewNotes:
      "Synthetic amendment uses the M31 passage shape. A cover-page correction explicitly does not restate the financials; preserve the false draft and exact conflicting passage as a disagreement.",
    output: amendmentOutput,
    evidence: [amendment],
    recording: recording(amendmentOutput, "CONTRADICTED"),
    expectedStatuses: ["CONTRADICTED"],
  },
  {
    id: "partial-narrative",
    reviewNotes:
      "The disclosure is supported, but predicting worsening is not. Retain the original claim only with a partial-support label.",
    output: partial,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(partial, "PARTIALLY_SUPPORTED"),
    expectedStatuses: ["PARTIALLY_SUPPORTED"],
  },
  {
    id: "unsupported-competitive-claim",
    reviewNotes:
      "The M29 peer table does not establish elimination of competition. Existing valid citation ids cannot make this claim supported.",
    output: unsupported,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(unsupported, "UNSUPPORTED"),
    expectedStatuses: ["UNSUPPORTED"],
  },
  {
    id: "near-recommendation",
    reviewNotes:
      "Hedged position advice remains prohibited and must be rejected before verification; a supported verdict cannot authorize it.",
    output: nearRecommendation,
    evidence: CURATED_RESEARCH_EVIDENCE,
    recording: recording(nearRecommendation, "SUPPORTED"),
    expectedStatuses: [],
    rejectBeforeVerification: true,
  },
];
