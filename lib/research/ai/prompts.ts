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
 * Synthesis may cite only the evidence its own context supplies, which the
 * character budget keeps smaller than everything the specialists cited. A
 * forwarded claim therefore shows only the cited ids synthesis was given;
 * showing the others invites a citation the grounding check must reject.
 */
export function citingOnlySuppliedEvidence(
  specialists: readonly SpecialistPromptInput[],
  evidence: readonly Pick<ResearchEvidence, "id">[],
): SpecialistPromptInput[] {
  const supplied = new Set(evidence.map((item) => item.id));
  return specialists.map((specialist) => ({
    agentName: specialist.agentName,
    output: {
      ...specialist.output,
      claims: specialist.output.claims.map((claim) => ({
        ...claim,
        evidenceIds: claim.evidenceIds.filter((id) => supplied.has(id)),
        counterEvidenceIds: claim.counterEvidenceIds.filter((id) =>
          supplied.has(id),
        ),
      })),
    },
  }));
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
 * questions. Risk names the company's own disclosed risks (including any
 * regulatory, governance, or political exposure the filings describe) and
 * routes evidence gaps to missingData, never to risk claims.
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
    "Company risks: what are the most important company-specific risks, including any regulatory, governance, or political exposure, that the filings describe in Item 1A Risk Factors (10-K or 10-Q update), plus MD&A or an 8-K where relevant? State each plainly in its own claim citing its passage.",
    "Leverage: does long-term debt exceed cash and equivalents (negative cash minus long-term debt), and what is debt-to-equity at the latest reporting date?",
    "Liquidity: what is the current ratio, and does it indicate strain?",
    "Trend: do the supplied same-quarter changes show revenue, diluted EPS, or free cash flow deteriorating?",
  ],
  NEWS: [
    "For each Form 8-K current report supplied, what was reported: the filing date, the item codes, and, where an item or Exhibit 99.1 passage is supplied, what the company said happened?",
    "What changed compared with the earlier current reports or the periodic filings in the evidence, such as a new result, a dividend or repurchase decision, a leadership change, a shareholder vote, or an agreement?",
    "Why may each event matter for the business, stated as the filing itself frames it, without predicting share prices?",
    "How strong is the evidence for each event: a passage that describes it, or only the item codes of the 8-K cover?",
    "What remains unknown, including items with no passage, and when was the newest current report filed? If no current report is supplied, report availability NOT_AVAILABLE with no claims.",
  ],
  POLITICAL_ACTIVITY: [
    "Is verified political-activity evidence supplied? If not, report availability NOT_AVAILABLE with no claims and state the gap.",
  ],
};

const agentPurpose: Record<SpecialistAgentName, string> = {
  NEWS: "Describe recent company events only from the supplied Form 8-K current reports and their item and Exhibit 99.1 passages. Make one claim per event: state the filing date and items, cite the 8-K current-report item for the date and a passage for what was said, and label a claim FACT when it restates the filing. Never describe an event that no supplied 8-K reports, never treat the absence of a report as evidence that nothing happened, and never use third-party news, memory, or the periodic filings as a source of events.",
  FINANCIALS:
    "Answer from the reported facts, summary table, quarterly trend excerpt, and derived growth, margin, cash-generation, and leverage values, with periods and units; use MD&A passages only for drivers the filing gives. Write \"the diluted share count fell\", never \"shares fell\". Keep gaps explicit; never invent valuation inputs.",
  COMPETITORS:
    "Compare the company with the supplied peer table using only supplied values and periods; use Business passages for how the filing describes competition. Compare metrics (\"NVDA's revenue grew faster\"); never say a company will outperform. Claim no market share, rankings, or unsupplied peer facts.",
  POLITICAL_ACTIVITY:
    "Report that verified political-activity evidence is unavailable unless it is explicitly supplied.",
  RISK: "Name the company's own risks from the supplied evidence, including Risk Factors and MD&A passages, plus leverage and liquidity. Describe each business risk itself, never its effect on the stock or share price. Put missing or ambiguous evidence only in missingData; a data gap is never a risk claim. Do not use personal portfolio context.",
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

const exactNumberRule =
  "State a number only when that exact value, period, unit, and sign appear in cited supporting evidence; a runtime check rejects any number absent from the cited excerpts.";
// The runtime check also accepts a correctly rounded cited value, which the
// reader-facing synthesis uses for readable amounts.
const roundedNumberRule =
  "State a number only when its value, period, unit, and sign appear in cited evidence; you may round it to two or more significant digits.";
const derivedValueRule =
  "Evidence of kind DERIVED holds values this application calculated deterministically from cited SEC facts; you may quote such a value exactly as supplied with its period and unit and must describe it as derived, but you must never calculate, re-derive, extrapolate, or annualize any ratio, growth rate, difference, or average yourself.";
const numericRules = [exactNumberRule, derivedValueRule];

const sourceKindRules = [
  "Evidence of kind SEC_FILING is a passage from the company's own 10-K or 10-Q, a passage of a Form 8-K item or its attached press release, or the cover items of a Form 8-K current report (form, section, and filing date given); attribute it to that filing as the company's disclosure, not independent verification, and read forward-looking language as expectation, not fact.",
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

// The final report is read by beginner investors, so synthesis claims become
// short plain-language bullets. Specialists keep their detail; synthesis is the
// step that writes what the reader sees.
const plainLanguageRule =
  "Write for beginners: each claim is one plain sentence under 25 words; the summary is two short sentences.";

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
  const bounded = boundSpecialistOutputs(
    citingOnlySuppliedEvidence(input.specialists, input.evidence),
  );
  const instructions = [
    "You synthesize validated, evidence-grounded company research for a non-advisory educational application.",
    "Use only the supplied evidence and specialist outputs. Specialist prose is interpretation, not a new source.",
    "Weigh the specialists' claims and their cited evidence, not the specialists' opinions. A specialist whose availability is NOT_AVAILABLE contributed no evidence: report its gap in missingData and never treat it as a neutral view.",
    "Every final claim must cite supplied evidence ids directly, surface counter-evidence and disagreements, and preserve missing information.",
    roundedNumberRule,
    derivedValueRule,
    ...sourceKindRules,
    ...claimKindRules,
    `Keep the kind of any claim you carry forward and label your own conclusions INTERPRETATION. ${ratingRule}`,
    "In whatWouldChange, list up to six short, evidence-grounded developments that would change this analysis, such as a derived metric moving in the next filing or a missing metric arriving. Do not mention share prices.",
    "Recent events come only from the News specialist's claims and the Form 8-K current reports they cite; never describe an event without such a citation, and treat the newest filing date as the limit of what is known.",
    plainLanguageRule,
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
