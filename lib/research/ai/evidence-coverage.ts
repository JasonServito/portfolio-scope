import { z } from "zod";

import type { ResearchEvidence } from "@/lib/research/ai/schemas";
import { STRUCTURED_EVIDENCE_TYPES } from "@/lib/research/ai/structured-evidence";
import type { ResearchEvidenceCoverage } from "@/lib/research/types";
import { expectedMetricNames } from "@/lib/sec/normalization";

/**
 * Evidence coverage is computed from the immutable snapshot, never reported
 * by the model. Four equally weighted parts: expected metrics present, derived
 * metrics available, structured evidence present, and newest-filing freshness
 * (full credit within a quarterly filing cycle, none after a year).
 */
export const AI_EVIDENCE_COVERAGE_VERSION = "m30-evidence-coverage-v1";

const FULL_FRESHNESS_DAYS = 120;
const ZERO_FRESHNESS_DAYS = 365;
const DAY_MS = 86_400_000;

export const STRUCTURED_EVIDENCE_LABELS = {
  [STRUCTURED_EVIDENCE_TYPES.financialSummary]: "financial summary table",
  [STRUCTURED_EVIDENCE_TYPES.financialTrend]: "quarterly trend excerpt",
  [STRUCTURED_EVIDENCE_TYPES.peerComparison]: "peer comparison table",
  [STRUCTURED_EVIDENCE_TYPES.upcomingEarnings]: "upcoming earnings event",
} as const;

export const researchEvidenceCoverageSchema = z
  .object({
    version: z.string().min(1),
    score: z.number().min(0).max(1),
    expectedMetrics: z.object({
      present: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    derivedMetrics: z.object({
      available: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    structuredEvidence: z.object({
      present: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      missing: z.array(z.string()),
    }),
    newestFilingDate: z.string().date().nullable(),
    newestFilingAgeDays: z.number().int().nonnegative().nullable(),
    freshness: z.number().min(0).max(1),
  })
  .strict();

type CoverageSnapshot = {
  missingMetrics: readonly string[];
  evidence: readonly ResearchEvidence[];
};

function round(value: number, places = 3) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function findStructured(evidence: readonly ResearchEvidence[], type: string) {
  return evidence.find((item) => item.metadata.evidenceType === type) ?? null;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function derivedMetricCounts(summary: ResearchEvidence | null) {
  const derived = summary?.metadata.derived;
  if (!Array.isArray(derived)) return { available: 0, total: 0 };
  const available = derived.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as { value?: unknown }).value === "number",
  ).length;
  return { available, total: derived.length };
}

function structuredPresence(evidence: readonly ResearchEvidence[]) {
  const summary = findStructured(
    evidence,
    STRUCTURED_EVIDENCE_TYPES.financialSummary,
  );
  const trend = findStructured(
    evidence,
    STRUCTURED_EVIDENCE_TYPES.financialTrend,
  );
  const peers = findStructured(
    evidence,
    STRUCTURED_EVIDENCE_TYPES.peerComparison,
  );
  const event = findStructured(
    evidence,
    STRUCTURED_EVIDENCE_TYPES.upcomingEarnings,
  );
  const items: Array<[string, boolean]> = [
    [STRUCTURED_EVIDENCE_LABELS.FINANCIAL_SUMMARY_TABLE, summary !== null],
    [
      STRUCTURED_EVIDENCE_LABELS.FINANCIAL_TREND_EXCERPT,
      trend !== null && arrayLength(trend.metadata.periods) > 0,
    ],
    [
      STRUCTURED_EVIDENCE_LABELS.PEER_COMPARISON_TABLE,
      // The subject row is always present; a comparison needs a peer row.
      peers !== null && arrayLength(peers.metadata.rows) > 1,
    ],
    [STRUCTURED_EVIDENCE_LABELS.UPCOMING_EARNINGS_EVENT, event !== null],
  ];
  return {
    summary,
    present: items.filter(([, present]) => present).length,
    total: items.length,
    missing: items.filter(([, present]) => !present).map(([label]) => label),
  };
}

// Only a 10-K or 10-Q dates the financial facts; a Form 8-K current report
// (M32) is event evidence and does not refresh them, so it is excluded from
// the newest-filing freshness measure.
function isPeriodicFiling(item: ResearchEvidence) {
  const formType = item.metadata.formType;
  return typeof formType !== "string" || !formType.startsWith("8-K");
}

function newestFilingDate(evidence: readonly ResearchEvidence[]) {
  return (
    evidence
      .filter(
        (item) =>
          (item.sourceKind === "SEC_FACT" || item.sourceKind === "SEC_FILING") &&
          item.sourceDate !== null &&
          isPeriodicFiling(item),
      )
      .map((item) => item.sourceDate!)
      .sort()
      .at(-1) ?? null
  );
}

function ageInDays(date: string, asOfDate: string) {
  const elapsed = Date.parse(`${asOfDate}T00:00:00.000Z`) -
    Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / DAY_MS)) : null;
}

function freshnessFor(ageDays: number | null) {
  if (ageDays === null) return 0;
  if (ageDays <= FULL_FRESHNESS_DAYS) return 1;
  if (ageDays >= ZERO_FRESHNESS_DAYS) return 0;
  return (
    1 -
    (ageDays - FULL_FRESHNESS_DAYS) / (ZERO_FRESHNESS_DAYS - FULL_FRESHNESS_DAYS)
  );
}

export function computeEvidenceCoverage(
  snapshot: CoverageSnapshot,
  asOfDate: string,
): ResearchEvidenceCoverage {
  const expectedTotal = expectedMetricNames.length;
  const expectedPresent = Math.max(
    0,
    expectedTotal - new Set(snapshot.missingMetrics).size,
  );
  const structured = structuredPresence(snapshot.evidence);
  const derived = derivedMetricCounts(structured.summary);
  const newestDate = newestFilingDate(snapshot.evidence);
  const newestAge = newestDate === null ? null : ageInDays(newestDate, asOfDate);
  const freshness = freshnessFor(newestAge);
  const parts = [
    ratio(expectedPresent, expectedTotal),
    ratio(derived.available, derived.total),
    ratio(structured.present, structured.total),
    freshness,
  ];
  return {
    version: AI_EVIDENCE_COVERAGE_VERSION,
    score: round(parts.reduce((sum, part) => sum + part, 0) / parts.length),
    expectedMetrics: { present: expectedPresent, total: expectedTotal },
    derivedMetrics: derived,
    structuredEvidence: {
      present: structured.present,
      total: structured.total,
      missing: structured.missing,
    },
    newestFilingDate: newestDate,
    newestFilingAgeDays: newestAge,
    freshness: round(freshness),
  };
}

/** The stored upcoming earnings event, when the snapshot holds one. */
export function upcomingEarningsFromEvidence(
  evidence: readonly ResearchEvidence[],
) {
  const event = findStructured(
    evidence,
    STRUCTURED_EVIDENCE_TYPES.upcomingEarnings,
  );
  const eventDate = event?.metadata.eventDate;
  if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return null;
  }
  const marketSession = event?.metadata.marketSession;
  return {
    eventDate,
    marketSession: typeof marketSession === "string" ? marketSession : null,
  };
}
