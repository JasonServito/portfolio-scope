import type {
  ResearchEvidence,
  SpecialistModelOutput,
} from "@/lib/research/ai/schemas";
import type { SpecialistAgentName } from "@/lib/research/types";

const agentPurpose: Record<SpecialistAgentName, string> = {
  NEWS: "Report that licensed current-news evidence is unavailable. Do not infer current events from filings.",
  FINANCIALS:
    "Interpret reported financial facts, periods, units, and explicit gaps without inventing valuation inputs.",
  COMPETITORS:
    "Describe the bounded peer context in the supplied catalog evidence without claiming market-share facts.",
  POLITICAL_ACTIVITY:
    "Report that verified political-activity evidence is unavailable unless it is explicitly supplied.",
  RISK: "Identify company-level reporting, balance-sheet, concentration, and evidence-quality risks. Do not use personal portfolio context.",
};

function evidenceRegistry(evidence: ResearchEvidence[]) {
  return evidence.map((item) => ({
    id: item.id,
    kind: item.sourceKind,
    title: item.title,
    section: item.section,
    sourceDate: item.sourceDate,
    accessionNumber: item.accessionNumber,
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
    "State a number only when that exact value and period appear in cited evidence; do not calculate new ratios.",
    "Never recommend or instruct an investment action, including buying, purchasing, acquiring, selling, disposing of, exiting, adding to, trimming, or holding a stock or position.",
    "Never personalize an action using the user's portfolio, holdings, goals, risk tolerance, or time horizon.",
    "Never provide a stock-price target or predict a stock's future price or direction.",
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
  specialists: Array<{
    agentName: SpecialistAgentName;
    output: SpecialistModelOutput;
  }>;
  repairFeedback?: string;
}) {
  const instructions = [
    "You synthesize validated, evidence-grounded company research for a non-advisory educational application.",
    "Use only the supplied evidence and specialist outputs. Specialist prose is interpretation, not a new source.",
    "Every final claim must cite supplied evidence ids directly, surface counter-evidence and disagreements, and preserve missing information.",
    "State a number only when that exact value and period appear in cited evidence; do not calculate new ratios.",
    "Never recommend or instruct an investment action, including buying, purchasing, acquiring, selling, disposing of, exiting, adding to, trimming, or holding a stock or position.",
    "Never personalize an action using the user's portfolio, holdings, goals, risk tolerance, or time horizon.",
    "Never provide a stock-price target or predict a stock's future price or direction.",
  ].join(" ");
  const body = JSON.stringify({
    task: "SYNTHESIS",
    company: { ticker: input.ticker, name: input.companyName },
    asOfDate: input.asOfDate,
    evidence: {
      registry: evidenceRegistry(input.evidence),
      context: input.evidenceContext ?? defaultEvidenceContext(input.evidence),
    },
    specialists: input.specialists.map((specialist) => ({
      agentName: specialist.agentName,
      output: {
        ...specialist.output,
        claims: specialist.output.claims.slice(0, 4),
        warnings: specialist.output.warnings.slice(0, 4),
        missingData: specialist.output.missingData.slice(0, 4),
      },
    })),
    repairFeedback: input.repairFeedback ?? null,
  });
  return { instructions, input: body };
}
