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
  const size = (value: unknown) => JSON.stringify(value).length;
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

const agentPurpose: Record<SpecialistAgentName, string> = {
  NEWS: "Report that licensed current-news evidence is unavailable. Do not infer current events from filings.",
  FINANCIALS:
    "Interpret the reported financial facts, the financial summary table, the quarterly trend excerpt, and the derived growth, margin, cash-generation, and leverage values, always with their periods and units, and keep explicit gaps explicit without inventing valuation inputs.",
  COMPETITORS:
    "Compare the company with the supplied peer comparison table and peer set using only the supplied values and periods. Do not claim market share, rankings, or peer facts that are not supplied.",
  POLITICAL_ACTIVITY:
    "Report that verified political-activity evidence is unavailable unless it is explicitly supplied.",
  RISK: "Identify company-level reporting, balance-sheet, leverage, liquidity, trend, concentration, event-timing, and evidence-quality risks from the supplied evidence. Do not use personal portfolio context.",
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
  "State a number only when that exact value, period, and unit appear in cited evidence.",
  "Evidence of kind DERIVED holds values this application calculated deterministically from cited SEC facts; you may quote such a value exactly as supplied with its period and unit and must describe it as derived, but you must never calculate, re-derive, extrapolate, or annualize any ratio, growth rate, difference, or average yourself.",
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
    ...safetyRules,
    agentPurpose[input.agentName],
  ].join(" ");
  const body = JSON.stringify({
    task: input.agentName,
    company: { ticker: input.ticker, name: input.companyName },
    asOfDate: input.asOfDate,
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
    "Every final claim must cite supplied evidence ids directly, surface counter-evidence and disagreements, and preserve missing information.",
    ...numericRules,
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
    specialists: bounded.specialists,
    omittedSpecialistClaims: bounded.omittedClaims,
    repairFeedback: input.repairFeedback ?? null,
  });
  return { instructions, input: body };
}
