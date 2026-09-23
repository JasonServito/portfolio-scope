import type { ResearchEvaluationCase } from "@/lib/research/ai/evaluation";
import {
  AAPL_FIXTURE_CURRENT_REPORTS,
  aaplFixtureCurrentReports,
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
 * SEC fixtures, re-recorded for the M30 specialist contract (claim kinds,
 * availability, and "what would change"), extended for M31 with claims that
 * cite filing passages from the synthetic recorded-shape 10-K and 10-Q
 * fixtures, and for M32 with a News specialist output that describes dated
 * events from synthetic Form 8-K current reports and a press-release
 * passage. The evidence is the exact deterministic snapshot the runtime
 * would build; the outputs are reviewed recorded responses (a grounded report
 * and a deliberately flawed one). Usage and latency are recorded estimates
 * for the m29 context and output limits, not provider-billed measurements.
 */

export const CURATED_AAPL_SNAPSHOT = buildAaplFixtureSnapshot({
  currentReports: aaplFixtureCurrentReports(),
});
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
// Filing passages each specialist actually receives from the fixture 10-K:
// the Risk Factors summary and the MD&A net-sales-by-category passage.
const riskFactorsSummaryPassage = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "SEC_FILING_PASSAGE",
  formType: "10-K",
  sectionKind: "RISK_FACTORS",
  chunkOrdinal: 1,
});
const salesByCategoryPassage = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "SEC_FILING_PASSAGE",
  formType: "10-K",
  sectionKind: "MDA",
  chunkOrdinal: 1,
});
// Current reports the News specialist receives: the dated 8-K items and the
// opening passage of the results press release.
const resultsReport = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "SEC_CURRENT_REPORT",
  accessionNumber: AAPL_FIXTURE_CURRENT_REPORTS.results.accessionNumber,
});
const resultsReportWithoutExhibit = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "SEC_CURRENT_REPORT",
  accessionNumber:
    AAPL_FIXTURE_CURRENT_REPORTS.resultsWithoutExhibit.accessionNumber,
});
const pressReleaseOpening = findFixtureEvidence(CURATED_AAPL_SNAPSHOT, {
  evidenceType: "SEC_FILING_PASSAGE",
  sectionKind: "PRESS_RELEASE",
  chunkOrdinal: 0,
});

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

const regulatoryDisclosureClaim: ModelClaim = {
  category: "RISK",
  kind: "FACT",
  statement:
    "The 10-K risk factors summary discloses legal and regulatory compliance risks, including antitrust and digital-market regulation affecting the Company's app distribution and payment practices, evolving data protection laws, and unfavorable outcomes of legal proceedings and government investigations.",
  confidence: 0.8,
  evidenceIds: [riskFactorsSummaryPassage.id],
  counterEvidenceIds: [],
  assumptions: [
    "The passage is the company's own disclosure, not an independent assessment of the exposure.",
  ],
};

const salesDriverClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "FACT",
  statement:
    "Management attributes the 2025 increase in smartphone net sales primarily to higher net sales of the latest models, partially offset by lower net sales of prior-generation models, and the increase in services net sales primarily to advertising, the digital content store and cloud services.",
  confidence: 0.78,
  evidenceIds: [salesByCategoryPassage.id],
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

// Every event claim cites the dated 8-K item; the press-release passage
// supplies what was announced.
const resultsEventClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "FACT",
  statement:
    "In a Form 8-K filed 2026-07-30 under Item 2.02, the Company announced fiscal 2026 third quarter results: quarterly revenue of $94.0 billion, up 10 percent year over year, and diluted earnings per share of $1.57, up 12 percent year over year, with Services revenue at a June quarter record of $27.4 billion.",
  confidence: 0.84,
  evidenceIds: [resultsReport.id, pressReleaseOpening.id],
  counterEvidenceIds: [],
  assumptions: [
    "The press release is the company's own announcement and is not independently verified.",
  ],
};

// Synthesis carries the event forward with the dated 8-K citation alone; the
// figures stay in the News specialist's passage-backed claim, because its
// context holds the small current-report item but not the press release.
const resultsFilingClaim: ModelClaim = {
  category: "SUPPORTIVE",
  kind: "FACT",
  statement:
    "The newest current report in the window is a Form 8-K filed 2026-07-30 under Item 2.02, in which the Company announced its fiscal 2026 third quarter results by press release; the News specialist describes revenue and diluted earnings per share growth from that release.",
  confidence: 0.78,
  evidenceIds: [resultsReport.id],
  counterEvidenceIds: [],
  assumptions: [],
};

const unavailableExhibitClaim: ModelClaim = {
  category: "RISK",
  kind: "FACT",
  statement:
    "A Form 8-K filed 2026-04-30 under Item 2.02 reported results for an earlier quarter, but its Exhibit 99.1 press release is not available because the filing index lists no press-release exhibit, so what it reported is unknown beyond its item codes.",
  confidence: 0.72,
  evidenceIds: [resultsReportWithoutExhibit.id],
  counterEvidenceIds: [],
  assumptions: [],
};

export const AAPL_GROUNDED_SYNTHESIS: SynthesisModelOutput = {
  rating: "MIXED",
  confidence: 0.74,
  summary:
    "Derived growth, margins, and cash generation from the selected SEC facts are strong, while derived net cash is negative and peer operating margins are higher. The 10-K risk factors disclose antitrust and digital-market regulation affecting app distribution and payments. The latest Form 8-K press release announces third quarter revenue and earnings growth, while quarterly cash-flow coverage is incomplete and one earlier results filing has no extracted press release. This is educational research, not financial advice.",
  claims: [
    growthClaim,
    cashGenerationClaim,
    leverageClaim,
    peerClaim,
    trendCoverageClaim,
    eventClaim,
    regulatoryDisclosureClaim,
    resultsFilingClaim,
  ],
  warnings: [
    "Derived values are calculated from cited SEC facts and are not reported by the filer.",
  ],
  missingData: [
    "The Form 8-K filed 2026-04-30 has no extracted press release, so the results it reported are unknown beyond its item codes.",
  ],
  disagreements: [
    "Positive derived revenue and cash-flow growth contrasts with negative derived net cash and lower operating margin than the compared peers.",
  ],
  whatWouldChange: [
    "The next annual filing showing derived revenue growth below the current annual rate would weaken the growth case.",
    "Derived net cash turning positive, with cash and equivalents exceeding long-term debt at the next reporting date.",
    "Quarterly free cash flow becoming available for every quarter in the eight-quarter trend excerpt.",
    "A new Form 8-K current report filed after 2026-07-30 describing a material event or the next quarter's results.",
    "The results reported at the stored earnings event replacing the selected annual and quarterly facts.",
  ],
};

/**
 * The same grounded report for a snapshot with no stored current report, the
 * state before M32 is enabled: no event claim, and the gap stated instead.
 */
export const AAPL_GROUNDED_SYNTHESIS_WITHOUT_CURRENT_REPORTS: SynthesisModelOutput = {
  ...AAPL_GROUNDED_SYNTHESIS,
  summary:
    "Derived growth, margins, and cash generation from the selected SEC facts are strong, while derived net cash is negative and peer operating margins are higher. The 10-K risk factors disclose antitrust and digital-market regulation affecting app distribution and payments. Quarterly cash-flow coverage is incomplete and no Form 8-K current report is stored, so recent events are not assessed. This is educational research, not financial advice.",
  claims: AAPL_GROUNDED_SYNTHESIS.claims.filter(
    (claim) => claim !== resultsFilingClaim,
  ),
  missingData: [
    "No Form 8-K current report from the last twelve months is stored, so recent events are not assessed.",
  ],
  whatWouldChange: AAPL_GROUNDED_SYNTHESIS.whatWouldChange.map((item) =>
    item.startsWith("A new Form 8-K")
      ? "A Form 8-K current report becoming available so recent events can be assessed."
      : item,
  ),
};

export const AAPL_RECORDED_SPECIALIST_OUTPUTS: Record<
  "FINANCIALS" | "COMPETITORS" | "RISK" | "NEWS",
  SpecialistModelOutput
> = {
  FINANCIALS: {
    rating: "BULLISH",
    confidence: 0.82,
    availability: "COMPLETE",
    summary:
      "Selected SEC facts and derived metrics show growing revenue, expanding margins, and strong cash generation for the latest annual and quarterly periods, with the 10-K attributing the sales increase to the latest smartphone models and services, and quarterly cash-flow data available only for some quarters.",
    claims: [
      financialsGrowthClaim,
      financialsCashGenerationClaim,
      salesDriverClaim,
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
      "Balance-sheet evidence shows negative derived net cash and a current ratio near one, quarterly cash-flow coverage is incomplete, an upcoming earnings event is scheduled, and the 10-K risk factors disclose antitrust and digital-market regulatory exposure.",
    claims: [
      riskLeverageClaim,
      liquidityClaim,
      eventClaim,
      regulatoryDisclosureClaim,
    ],
    warnings: [],
    missingData: [
      "No political-activity evidence beyond the company's own risk factor disclosure is supplied.",
    ],
  },
  NEWS: {
    rating: "NEUTRAL",
    confidence: 0.7,
    availability: "PARTIAL",
    summary:
      "Three Form 8-K current reports are stored for the last twelve months. The newest, filed 2026-07-30, announces fiscal 2026 third quarter results in an attached press release; an earlier results filing has no extracted press release, and a shareholder-vote filing carries no exhibit, so those events are known only by their item codes.",
    claims: [resultsEventClaim, unavailableExhibitClaim],
    warnings: [
      "Events come only from the company's own Form 8-K filings; no third-party news is used.",
    ],
    missingData: [
      "The Form 8-K filed 2026-02-26 reports a shareholder vote (Item 5.07) with no exhibit text, so the outcome is unknown.",
      "Nothing after the newest current report filed 2026-07-30 is known.",
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
