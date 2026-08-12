import {
  claimKey,
  type ModelClaim,
  type ResearchEvidence,
  type SynthesisModelOutput,
} from "@/lib/research/ai/schemas";
import type { ResearchEvaluationCase } from "@/lib/research/ai/evaluation";

const revenueEvidence: ResearchEvidence = {
  id: "ev_aaaaaaaaaaaaaaaa",
  sourceKind: "SEC_FILING",
  title: "Example Corp annual filing",
  sourceReference: "sec://example/annual/revenue",
  sourceUrl: "https://www.sec.gov/Archives/example-annual.htm",
  accessionNumber: "0000000000-26-000001",
  section: "Results of operations",
  objectKey: "sec/example/annual.htm",
  sha256: "a".repeat(64),
  sourceDate: "2026-01-31",
  retrievedAt: "2026-02-02T12:00:00.000Z",
  excerpt: "Revenue increased 12% year over year to $112 million.",
  passageStart: 100,
  passageEnd: 158,
  secFilingId: "filing-example-annual",
  secRawSourceId: "raw-example-annual",
  secFinancialFactId: null,
  metadata: { formType: "10-K" },
};

const marginCounterEvidence: ResearchEvidence = {
  id: "ev_bbbbbbbbbbbbbbbb",
  sourceKind: "SEC_FACT",
  title: "Example Corp margin fact",
  sourceReference: "sec-fact://example/operating-margin",
  sourceUrl: "https://www.sec.gov/Archives/example-annual.htm",
  accessionNumber: "0000000000-26-000001",
  section: "Results of operations",
  objectKey: "sec/example/company-facts.json",
  sha256: "b".repeat(64),
  sourceDate: "2026-01-31",
  retrievedAt: "2026-02-02T12:00:00.000Z",
  excerpt: "Operating margin declined 3% as investment spending increased.",
  passageStart: 200,
  passageEnd: 264,
  secFilingId: "filing-example-annual",
  secRawSourceId: "raw-example-facts",
  secFinancialFactId: "fact-example-margin",
  metadata: { canonicalMetric: "operating_margin" },
};

const concentrationEvidence: ResearchEvidence = {
  id: "ev_cccccccccccccccc",
  sourceKind: "SEC_FILING",
  title: "Example Corp customer concentration disclosure",
  sourceReference: "sec://example/annual/concentration",
  sourceUrl: "https://www.sec.gov/Archives/example-annual.htm",
  accessionNumber: "0000000000-26-000001",
  section: "Risk factors",
  objectKey: "sec/example/annual.htm",
  sha256: "a".repeat(64),
  sourceDate: "2026-01-31",
  retrievedAt: "2026-02-02T12:00:00.000Z",
  excerpt: "The largest customer represented 42% of annual revenue.",
  passageStart: 300,
  passageEnd: 356,
  secFilingId: "filing-example-annual",
  secRawSourceId: "raw-example-annual",
  secFinancialFactId: null,
  metadata: { formType: "10-K" },
};

const revenueClaim: ModelClaim = {
  category: "SUPPORTIVE",
  statement: "Revenue increased 12% year over year.",
  confidence: 0.9,
  evidenceIds: [revenueEvidence.id],
  counterEvidenceIds: [marginCounterEvidence.id],
  assumptions: [],
};

const concentrationClaim: ModelClaim = {
  category: "RISK",
  statement: "The largest customer represented 42% of annual revenue.",
  confidence: 0.95,
  evidenceIds: [concentrationEvidence.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const groundedOutput: SynthesisModelOutput = {
  rating: "MIXED",
  confidence: 0.82,
  summary:
    "Revenue growth is supported by the filing, while margin pressure and customer concentration remain visible risks.",
  claims: [revenueClaim, concentrationClaim],
  warnings: ["The research is educational and not financial advice."],
  missingData: ["No licensed current news source was available."],
  disagreements: [
    "Revenue growth was offset by weaker operating-margin evidence.",
  ],
};

const unsupportedClaim: ModelClaim = {
  category: "SUPPORTIVE",
  statement: "Revenue increased 30% year over year.",
  confidence: 0.98,
  evidenceIds: [marginCounterEvidence.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const unsafeOutput: SynthesisModelOutput = {
  rating: "BULLISH",
  confidence: 0.99,
  summary: "Sell alternatives and concentrate on Example Corp.",
  claims: [unsupportedClaim],
  warnings: [],
  missingData: [],
  disagreements: [],
};

export const CURATED_RESEARCH_EVIDENCE = [
  revenueEvidence,
  marginCounterEvidence,
  concentrationEvidence,
] as const;

export const CURATED_EVALUATION_CASES: ResearchEvaluationCase[] = [
  {
    id: "grounded-example",
    output: groundedOutput,
    evidence: [...CURATED_RESEARCH_EVIDENCE],
    expectations: {
      citationsByClaimKey: {
        [claimKey(revenueClaim)]: {
          acceptableSupportingEvidenceIds: [revenueEvidence.id],
          acceptableCounterEvidenceIds: [marginCounterEvidence.id],
          requiredSupportingEvidenceIds: [revenueEvidence.id],
          requiredCounterEvidenceIds: [marginCounterEvidence.id],
        },
        [claimKey(concentrationClaim)]: {
          acceptableSupportingEvidenceIds: [concentrationEvidence.id],
          requiredSupportingEvidenceIds: [concentrationEvidence.id],
        },
      },
      missingData: ["No licensed current news source was available."],
      contradictionEvidencePairs: [
        {
          supportingEvidenceId: revenueEvidence.id,
          counterEvidenceId: marginCounterEvidence.id,
        },
      ],
    },
    latencyMs: 840,
    usage: {
      inputTokens: 1_200,
      cachedInputTokens: 200,
      outputTokens: 320,
      estimatedCostUsd: 0.0011,
    },
  },
  {
    id: "unsupported-unsafe-example",
    output: unsafeOutput,
    evidence: [...CURATED_RESEARCH_EVIDENCE],
    expectations: {
      citationsByClaimKey: {
        [claimKey(unsupportedClaim)]: {
          acceptableSupportingEvidenceIds: [revenueEvidence.id],
          requiredSupportingEvidenceIds: [revenueEvidence.id],
        },
      },
      missingData: ["No licensed current news source was available."],
      contradictionEvidencePairs: [
        {
          supportingEvidenceId: revenueEvidence.id,
          counterEvidenceId: marginCounterEvidence.id,
        },
      ],
    },
    latencyMs: 620,
    usage: {
      inputTokens: 900,
      cachedInputTokens: 0,
      outputTokens: 180,
      estimatedCostUsd: 0.0006,
    },
  },
];
