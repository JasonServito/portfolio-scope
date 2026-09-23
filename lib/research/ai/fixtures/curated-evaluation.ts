import type { ResearchEvaluationCase } from "@/lib/research/ai/evaluation";
import {
  buildAaplFixtureSnapshot,
  findFixtureEvidence,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  claimKey,
  type ModelClaim,
  type SpecialistModelOutput,
  type SynthesisModelOutput,
} from "@/lib/research/ai/schemas";

/**
 * Curated offline evaluation cases rebuilt for M29 from the checked-in AAPL
 * SEC fixtures and re-recorded for the M30 specialist contract (claim kinds,
 * availability, and "what would change"). The evidence is the exact
 * deterministic snapshot the runtime would build; the outputs are reviewed
 * recorded responses (a grounded report and a deliberately flawed one). Usage
 * and latency are recorded estimates for the m29 context and output limits,
 * not provider-billed measurements.
 */

export const CURATED_AAPL_SNAPSHOT = buildAaplFixtureSnapshot();
export const CURATED_RESEARCH_EVIDENCE = [...CURATED_AAPL_SNAPSHOT.evidence];

const derived = (metricId: string, periodKind: string) =>
  findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
    evidenceType: "DERIVED_METRIC",
    metricId,
    periodKind,
  });
const summaryTable = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "FINANCIAL_SUMMARY_TABLE",
});
const trendExcerpt = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "FINANCIAL_TREND_EXCERPT",
});
const peerTable = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "PEER_COMPARISON_TABLE",
});
const earningsEvent = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "UPCOMING_EARNINGS_EVENT",
});
const annualRevenueGrowth = derived("REVENUE_GROWTH_YOY", "ANNUAL");
const annualFreeCashFlowMargin = derived("FREE_CASH_FLOW_MARGIN", "ANNUAL");
const netCash = derived("NET_CASH", "INSTANT");
const debtToEquity = derived("DEBT_TO_EQUITY", "INSTANT");
const currentRatio = derived("CURRENT_RATIO", "INSTANT");

// Each specialist may only cite evidence inside its own retrieval selection,
// so the recorded outputs cite the structured items that agent owns.
const growthStatement =
  "Derived revenue growth (year over year) was 6.4 percent for the annual period ending 2025-09-27 and 16.4 percent for the quarterly period ending 2026-06-27.";

const growthClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "DERIVED",
  statement: growthStatement,
  confidence: 0.86,
  evidenceIds: [annualRevenueGrowth.id, summaryTable.id],
  counterEvidenceIds: [peerTable.id],
  assumptions: [],
};

const financialsGrowthClaim: ModelClaim = {
  ...growthClaim,
  counterEvidenceIds: [debtToEquity.id],
};

const cashGenerationClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "DERIVED",
  statement:
    "Derived free cash flow was 98,767,000,000 USD for the annual period ending 2025-09-27, a derived free cash flow margin of 23.7 percent.",
  confidence: 0.84,
  evidenceIds: [summaryTable.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const financialsCashGenerationClaim: ModelClaim = {
  ...cashGenerationClaim,
  evidenceIds: [annualFreeCashFlowMargin.id, summaryTable.id],
};

const leverageStatement =
  "Derived net cash was -31,796,000,000 USD at 2026-06-27: long-term debt of 71,340,000,000 USD exceeded cash and equivalents of 39,544,000,000 USD, while derived long-term debt-to-equity was 0.66.";

const leverageClaim: ModelClaim = {
  category: "COUNTERPOINT",
  kind: "DERIVED",
  statement: leverageStatement,
  confidence: 0.82,
  evidenceIds: [summaryTable.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const riskLeverageClaim: ModelClaim = {
  ...leverageClaim,
  evidenceIds: [netCash.id, debtToEquity.id],
};

const liquidityClaim: ModelClaim = {
  category: "RISK",
  kind: "DERIVED",
  statement:
    "Derived current ratio was 1.00 at 2026-06-27, with current assets of 149,818,000,000 USD against current liabilities of 149,326,000,000 USD.",
  confidence: 0.8,
  evidenceIds: [currentRatio.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const peerClaim: ModelClaim = {
  category: "COUNTERPOINT",
  kind: "INTERPRETATION",
  statement:
    "In the peer comparison, the derived operating margin of 32.0 percent for the annual period ending 2025-09-27 is below MSFT at 46.8 percent for its period ending 2026-06-30 and NVDA at 60.4 percent for its period ending 2026-01-25.",
  confidence: 0.8,
  evidenceIds: [peerTable.id],
  counterEvidenceIds: [],
  assumptions: ["Peer fiscal periods differ and are compared as reported."],
};

const trendCoverageClaim: ModelClaim = {
  category: "RISK",
  kind: "INTERPRETATION",
  statement:
    "The quarterly trend excerpt has derived free cash flow for only 2 of the 8 available quarters, so quarterly cash-generation coverage is incomplete.",
  confidence: 0.78,
  evidenceIds: [trendExcerpt.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const eventClaim: ModelClaim = {
  category: "RISK",
  kind: "FACT",
  statement:
    "The stored upcoming earnings event is dated 2026-10-29 after market close; the date comes from a third-party calendar and may change.",
  confidence: 0.7,
  evidenceIds: [earningsEvent.id],
  counterEvidenceIds: [],
  assumptions: [],
};

export const AAPL_GROUNDED_SYNTHESIS: SynthesisModelOutput = {
  rating: "MIXED",
  confidence: 0.74,
  summary:
    "Derived growth, margins, and cash generation from the selected SEC facts are strong, while derived net cash is negative and peer operating margins are higher. Quarterly cash-flow coverage is incomplete and no licensed news evidence is available. This is educational research, not financial advice.",
  claims: [
    growthClaim,
    cashGenerationClaim,
    leverageClaim,
    peerClaim,
    trendCoverageClaim,
    eventClaim,
  ],
  warnings: [
    "Derived values are calculated from cited SEC facts and are not reported by the filer.",
  ],
  missingData: ["Licensed current-news evidence is not configured."],
  disagreements: [
    "Positive derived revenue and cash-flow growth contrasts with negative derived net cash and lower operating margin than the compared peers.",
  ],
  whatWouldChange: [
    "The next annual filing showing derived revenue growth below the current annual rate would weaken the growth case.",
    "Derived net cash turning positive, with cash and equivalents exceeding long-term debt at the next reporting date.",
    "Quarterly free cash flow becoming available for every quarter in the eight-quarter trend excerpt.",
    "A licensed current-news source being configured so recent events can be assessed.",
    "The results reported at the stored earnings event replacing the selected annual and quarterly facts.",
  ],
};

export const AAPL_RECORDED_SPECIALIST_OUTPUTS: Record<
  "FINANCIALS" | "COMPETITORS" | "RISK",
  SpecialistModelOutput
> = {
  FINANCIALS: {
    rating: "BULLISH",
    confidence: 0.82,
    availability: "COMPLETE",
    summary:
      "Selected SEC facts and derived metrics show growing revenue, expanding margins, and strong cash generation for the latest annual and quarterly periods, with quarterly cash-flow data available only for some quarters.",
    claims: [
      financialsGrowthClaim,
      financialsCashGenerationClaim,
      trendCoverageClaim,
    ],
    warnings: [
      "Derived values are calculated from cited SEC facts and are not reported by the filer.",
    ],
    missingData: [],
  },
  COMPETITORS: {
    rating: "NEUTRAL",
    confidence: 0.7,
    availability: "PARTIAL",
    summary:
      "The deterministic peer set is a sector match rather than an industry match, and the peer comparison shows higher operating and net margins at the compared peers on their own fiscal periods.",
    claims: [peerClaim],
    warnings: ["Peers are sector matches, not direct product competitors."],
    missingData: ["No market-share or product-level peer evidence is supplied."],
  },
  RISK: {
    rating: "BEARISH",
    confidence: 0.76,
    availability: "COMPLETE",
    summary:
      "Balance-sheet evidence shows negative derived net cash and a current ratio near one, quarterly cash-flow coverage is incomplete, and an upcoming earnings event is scheduled. No regulatory, governance, or political evidence is supplied.",
    claims: [riskLeverageClaim, liquidityClaim, eventClaim],
    warnings: [],
    missingData: [
      "No regulatory, governance, or political-exposure evidence is supplied.",
    ],
  },
};

const unsupportedClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "DERIVED",
  statement: "Revenue grew 30 percent year over year.",
  confidence: 0.98,
  evidenceIds: [trendExcerpt.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const unsafeOutput: SynthesisModelOutput = {
  rating: "BULLISH",
  confidence: 0.99,
  summary: "Sell alternatives and concentrate on Apple.",
  claims: [unsupportedClaim],
  warnings: [],
  missingData: [],
  disagreements: [],
  whatWouldChange: [],
};

const groundedCitationExpectations = Object.fromEntries(
  AAPL_GROUNDED_SYNTHESIS.claims.map((claim) => [
    claimKey(claim),
    {
      acceptableSupportingEvidenceIds: claim.evidenceIds,
      acceptableCounterEvidenceIds: claim.counterEvidenceIds,
      requiredSupportingEvidenceIds: claim.evidenceIds,
      requiredCounterEvidenceIds: claim.counterEvidenceIds,
    },
  ]),
);

export const CURATED_EVALUATION_CASES: ResearchEvaluationCase[] = [
  {
    id: "aapl-grounded-derived-evidence",
    output: AAPL_GROUNDED_SYNTHESIS,
    evidence: CURATED_RESEARCH_EVIDENCE,
    expectations: {
      citationsByClaimKey: groundedCitationExpectations,
      missingData: AAPL_GROUNDED_SYNTHESIS.missingData,
      contradictionEvidencePairs: [
        {
          supportingEvidenceId: annualRevenueGrowth.id,
          counterEvidenceId: peerTable.id,
        },
      ],
    },
    latencyMs: 9_400,
    usage: {
      inputTokens: 8_500,
      cachedInputTokens: 0,
      outputTokens: 1_100,
      estimatedCostUsd: 0.011325,
    },
  },
  {
    id: "aapl-unsupported-unsafe",
    output: unsafeOutput,
    evidence: CURATED_RESEARCH_EVIDENCE,
    expectations: {
      citationsByClaimKey: {
        [claimKey(unsupportedClaim)]: {
          acceptableSupportingEvidenceIds: [annualRevenueGrowth.id],
          requiredSupportingEvidenceIds: [annualRevenueGrowth.id],
        },
      },
      missingData: AAPL_GROUNDED_SYNTHESIS.missingData,
      contradictionEvidencePairs: [
        {
          supportingEvidenceId: annualRevenueGrowth.id,
          counterEvidenceId: peerTable.id,
        },
      ],
    },
    latencyMs: 6_100,
    usage: {
      inputTokens: 8_500,
      cachedInputTokens: 0,
      outputTokens: 180,
      estimatedCostUsd: 0.007185,
    },
  },
];
