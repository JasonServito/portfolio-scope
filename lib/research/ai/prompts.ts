import { AI_SYNTHESIS_SPECIALIST_CHAR_BUDGET } from "@/lib/research/ai/config";
import type {
  ResearchEvidence,
  SpecialistModelOutput,
} from "@/lib/research/ai/schemas";
import type { SpecialistAgentName } from "@/lib/research/types";

export type SpecialistPromptInput = {
  agentName: SpecialistAgentName;
  output: SpecialistModelOutput;
};

/**
 * Forwards every validated specialist claim to synthesis unless the serialized
 * payload would exceed the character budget that keeps the job inside its
 * token cap. Over budget, claim assumptions are dropped first, then the
 * lowest-confidence claims one at a time; the count is reported in the prompt.
 */
export function boundSpecialistOutputs(
  specialists: readonly SpecialistPromptInput[],
  budget = AI_SYNTHESIS_SPECIALIST_CHAR_BUDGET,
): { specialists: SpecialistPromptInput[]; omittedClaims: number } {
  const size = (value: readonly SpecialistPromptInput[]) =>
    JSON.stringify(value.map(synthesisSpecialistView)).length;
  let current: SpecialistPromptInput[] = specialists.map((specialist) => ({
    agentName: specialist.agentName,
    output: {
      ...specialist.output,
      warnings: specialist.output.warnings.slice(0, 4),
      missingData: specialist.output.missingData.slice(0, 4),
    },
  }));
  if (size(current) <= budget) return { specialists: current, omittedClaims: 0 };

  current = current.map((specialist) => ({
    ...specialist,
    output: {
      ...specialist.output,
      claims: specialist.output.claims.map((claim) => ({
        ...claim,
        assumptions: [],
      })),
    },
  }));
  let omittedClaims = 0;
  while (size(current) > budget) {
    let target: { specialist: number; claim: number } | null = null;
    current.forEach((specialist, specialistIndex) => {
      specialist.output.claims.forEach((claim, claimIndex) => {
        if (
          !target ||
          claim.confidence <
            current[target.specialist].output.claims[target.claim].confidence
        ) {
          target = { specialist: specialistIndex, claim: claimIndex };
        }
      });
    });
    if (!target) break;
    const { specialist: specialistIndex, claim: claimIndex } = target;
    current = current.map((specialist, index) =>
      index === specialistIndex
        ? {
            ...specialist,
            output: {
              ...specialist.output,
              claims: specialist.output.claims.filter(
                (_claim, position) => position !== claimIndex,
              ),
            },
          }
        : specialist,
    );
    omittedClaims += 1;
  }
  return { specialists: current, omittedClaims };
}

/**
 * Synthesis weighs claims, not specialist opinions, so the specialist rating
 * and self-reported confidence are not forwarded. A NOT_AVAILABLE specialist
 * therefore arrives as an availability state with its gaps, never as a
 * neutral opinion.
 */
export function synthesisSpecialistView(specialist: SpecialistPromptInput) {
  return {
    agentName: specialist.agentName,
    availability: specialist.output.availability,
    summary: specialist.output.summary,
    claims: specialist.output.claims,
    warnings: specialist.output.warnings,
    missingData: specialist.output.missingData,
  };
}

/**
 * Each scheduled specialist is a bounded research job with explicit
 * questions. Risk absorbs regulatory, governance, and political exposure as
 * an adaptive question answered only when evidence exists.
 */
export const SPECIALIST_RESEARCH_QUESTIONS: Record<
  SpecialistAgentName,
  readonly string[]
> = {
  FINANCIALS: [
    "How did revenue change year over year in the latest annual and quarterly periods, and do same-quarter changes show growth accelerating, steady, or slowing?",
    "How did diluted EPS change year over year, and do its same-quarter changes agree with revenue's?",
    "What are the latest operating and net margins, and how do they compare with the prior-year period?",
    "How much free cash flow was generated, what is the free-cash-flow margin, and how does operating cash flow compare with net income?",
    "What do debt-to-equity, cash minus long-term debt, and the current ratio at the latest reporting date say about balance-sheet capacity?",
    "Did the diluted share count change year over year, and which expected metrics are missing, ambiguous, or unavailable?",
  ],
  COMPETITORS: [
    "Which peers are supplied, and is each an industry match or a broader sector match?",
    "How does the company's latest annual revenue growth compare with each peer's, stating each company's fiscal period?",
    "How do operating and net margins compare with each peer's?",
    "How do free-cash-flow margin, debt-to-equity, and current ratio compare with each peer's?",
    "Which comparisons cannot be made because a value is unavailable? Compare the rest across each company's latest fiscal year, stating periods.",
  ],
  RISK: [
    "Leverage: does long-term debt exceed cash and equivalents (negative cash minus long-term debt), and what is debt-to-equity at the latest reporting date?",
    "Liquidity: what is the current ratio, and does it indicate strain?",
    "Trend: do same-quarter changes show revenue, diluted EPS, or free cash flow deteriorating, and are quarters missing from the eight-quarter excerpt?",
    "Evidence quality: which expected metrics are missing or ambiguous, on what date was the newest cited filing filed, and how does that limit this analysis?",
    "Event timing: is an earnings event scheduled, and which selected facts could change when the next filing arrives?",
    "Regulatory, governance, and political exposure: answer only if supplied evidence describes such exposure; otherwise state that no such evidence is supplied.",
  ],
  NEWS: [
    "For each Form 8-K current report supplied, what was reported: the filing date, the item codes, and, where an Exhibit 99.1 press-release passage is supplied, the results or announcement the company made?",
    "What changed compared with the earlier current reports or the periodic filings in the evidence, such as a new result, a dividend or repurchase decision, a leadership change, a shareholder vote, or an agreement?",
    "Why may each event matter for the business, stated as the filing itself frames it, without predicting share prices?",
    "How strong is the evidence for each event: a press-release passage that describes it, or only the item codes of the 8-K cover?",
    "What remains unknown, including items with no exhibit text, and how recent is the newest current report? If no current report is supplied, report availability NOT_AVAILABLE with no claims.",
  ],
  POLITICAL_ACTIVITY: [
    "Is verified political-activity evidence supplied? If not, report availability NOT_AVAILABLE with no claims and state the gap.",
  ],
};

const agentPurpose: Record<SpecialistAgentName, string> = {
  NEWS: "Describe recent company events only from the supplied Form 8-K current reports and their Exhibit 99.1 press-release passages. Make one claim per event: state the filing date and items, cite the 8-K current-report item for the date and the press-release passage for what was said, and label a claim FACT when it restates the filing. Never describe an event that no supplied 8-K reports, never treat the absence of a report as evidence that nothing happened, and never use third-party news, memory, or the periodic filings as a source of events.",
  FINANCIALS:
    "Answer from the reported financial facts, the financial summary table, the quarterly trend excerpt, and the derived growth, margin, cash-generation, and leverage values, always with their periods and units; use MD&A passages only for the drivers the filing gives. Keep explicit gaps explicit and never invent valuation inputs.",
  COMPETITORS:
    "Compare the company with the supplied peer comparison table and peer set using only supplied values and periods, and use Business passages for how the filing describes competition. Do not claim market share, rankings, or peer facts that are not supplied.",
  POLITICAL_ACTIVITY:
    "Report that verified political-activity evidence is unavailable unless it is explicitly supplied.",
  RISK: "Identify company-level reporting, balance-sheet, leverage, liquidity, trend, concentration, event-timing, evidence-quality, and disclosed regulatory or governance risks from the supplied evidence, including Risk Factors and MD&A passages. Do not use personal portfolio context.",
};

function evidenceRegistry(evidence: ResearchEvidence[]) {
  return evidence.map((item) => ({
    id: item.id,
    kind: item.sourceKind,
    sourceDate: item.sourceDate,
  }));
}

function defaultEvidenceContext(evidence: ResearchEvidence[]) {
  return evidence
    .map(
      (item) =>
        `[${item.id}] ${item.title}\n${item.excerpt}\nSource: ${item.sourceReference}`,
    )
    .join("\n\n")
    .slice(0, 12_000);
}

const numericRules = [
  "State a number only when that exact value, period, unit, and sign appear in cited supporting evidence; a runtime check rejects any number absent from the cited excerpts.",
  "Evidence of kind DERIVED holds values this application calculated deterministically from cited SEC facts; you may quote such a value exactly as supplied with its period and unit and must describe it as derived, but you must never calculate, re-derive, extrapolate, or annualize any ratio, growth rate, difference, or average yourself.",
];

const sourceKindRules = [
  "Evidence of kind SEC_FILING is a passage from the company's own 10-K or 10-Q, a passage of a press release the company attached to a Form 8-K, or the cover items of a Form 8-K current report (form, section, and filing date given); attribute it to that filing as the company's disclosure, not independent verification, and read forward-looking language as expectation, not fact.",
];

const claimKindRules = [
  "Label every claim with a kind: FACT restates a reported value or filing statement; DERIVED quotes a value this application calculated (evidence of kind DERIVED) and must cite that item; INTERPRETATION is a conclusion, comparison, or judgment. RISK means a potential adverse effect, not a favorable fact.",
];

const ratingRule =
  "Choose the rating from the claim mix: BULLISH needs a SUPPORTIVE claim, BEARISH a COUNTERPOINT or RISK claim, MIXED both, and NEUTRAL is for balanced or thin evidence.";

const specialistContractRules = [
  "Answer the research questions from the supplied evidence. Each claim should answer a question rather than restate an evidence excerpt; when the evidence cannot answer a question, say so in missingData instead of guessing.",
  "Set availability to COMPLETE when the evidence answers most questions, PARTIAL when material questions are unanswered because expected metrics are missing or ambiguous, and NOT_AVAILABLE when no usable evidence is supplied; NOT_AVAILABLE requires zero claims and a NEUTRAL rating.",
  ratingRule,
];

const safetyRules = [
  "Never recommend or instruct an investment action, including buying, purchasing, acquiring, selling, disposing of, exiting, adding to, trimming, or holding a stock or position.",
  "Never personalize an action using the user's portfolio, holdings, goals, risk tolerance, or time horizon.",
  "Never provide a stock-price target or predict a stock's future price or direction.",
];

export function specialistPrompt(input: {
  agentName: SpecialistAgentName;
  ticker: string;
  companyName: string;
  asOfDate: string;
  evidence: ResearchEvidence[];
  evidenceContext?: string;
  repairFeedback?: string;
}) {
  const instructions = [
    "You are a bounded company-research specialist for a non-advisory educational application.",
    "Use only the supplied evidence. Never use unstated memory, browse, or invent missing facts.",
    "Every claim must cite at least one supplied evidence id, and counterEvidenceIds may only identify supplied evidence that weakens the claim.",
    "Keep missing information explicit and preserve contradictory evidence.",
    ...numericRules,
    ...sourceKindRules,
    ...claimKindRules,
    ...specialistContractRules,
    ...safetyRules,
    agentPurpose[input.agentName],
  ].join(" ");
  const body = JSON.stringify({
    task: input.agentName,
    company: { ticker: input.ticker, name: input.companyName },
    asOfDate: input.asOfDate,
    researchQuestions: SPECIALIST_RESEARCH_QUESTIONS[input.agentName],
    evidence: {
      registry: evidenceRegistry(input.evidence),
      context: input.evidenceContext ?? defaultEvidenceContext(input.evidence),
    },
    repairFeedback: input.repairFeedback ?? null,
  });
  return { instructions, input: body };
}

export function synthesisPrompt(input: {
  ticker: string;
  companyName: string;
  asOfDate: string;
  evidence: ResearchEvidence[];
  evidenceContext?: string;
  specialists: readonly SpecialistPromptInput[];
  repairFeedback?: string;
}) {
  const bounded = boundSpecialistOutputs(input.specialists);
  const instructions = [
    "You synthesize validated, evidence-grounded company research for a non-advisory educational application.",
    "Use only the supplied evidence and specialist outputs. Specialist prose is interpretation, not a new source.",
    "Weigh the specialists' claims and their cited evidence, not the specialists' opinions. A specialist whose availability is NOT_AVAILABLE contributed no evidence: report its gap in missingData and never treat it as a neutral view.",
    "Every final claim must cite supplied evidence ids directly, surface counter-evidence and disagreements, and preserve missing information.",
    ...numericRules,
    ...sourceKindRules,
    ...claimKindRules,
    `Keep the kind of any claim you carry forward and label your own conclusions INTERPRETATION. ${ratingRule}`,
    "In whatWouldChange, list up to six concrete developments grounded in the supplied evidence that would change this analysis, such as a specific derived metric moving in the next filing or a missing metric becoming available. Do not mention share prices.",
    "Recent events come only from the News specialist's claims and the Form 8-K current reports they cite; never describe an event without such a citation, and treat the newest filing date as the limit of what is known.",
    ...safetyRules,
  ].join(" ");
  const body = JSON.stringify({
    task: "SYNTHESIS",
    company: { ticker: input.ticker, name: input.companyName },
    asOfDate: input.asOfDate,
    evidence: {
      registry: evidenceRegistry(input.evidence),
      context: input.evidenceContext ?? defaultEvidenceContext(input.evidence),
    },
    specialists: bounded.specialists.map(synthesisSpecialistView),
    omittedSpecialistClaims: bounded.omittedClaims,
    repairFeedback: input.repairFeedback ?? null,
  });
  return { instructions, input: body };
}
