import { describe, expect, it } from "vitest";

import {
  AI_EVIDENCE_COVERAGE_VERSION,
  computeEvidenceCoverage,
  researchEvidenceCoverageSchema,
  upcomingEarningsFromEvidence,
} from "@/lib/research/ai/evidence-coverage";
import { buildAaplFixtureSnapshot } from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import { expectedMetricNames } from "@/lib/sec/normalization";

const snapshot = buildAaplFixtureSnapshot();
const newestFiling = snapshot.evidence
  .filter((item) => item.sourceKind === "SEC_FACT" && item.sourceDate)
  .map((item) => item.sourceDate!)
  .sort()
  .at(-1)!;
const summaryDerived = snapshot.evidence.find(
  (item) => item.metadata.evidenceType === "FINANCIAL_SUMMARY_TABLE",
)!.metadata.derived as Array<{ value: number | null }>;

function daysAfter(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

describe("evidence coverage", () => {
  it("measures the AAPL fixture snapshot from its own contents, not from the model", () => {
    const coverage = computeEvidenceCoverage(snapshot, daysAfter(newestFiling, 10));

    expect(coverage.version).toBe(AI_EVIDENCE_COVERAGE_VERSION);
    expect(coverage.expectedMetrics).toEqual({
      present: expectedMetricNames.length - snapshot.missingMetrics.length,
      total: expectedMetricNames.length,
    });
    expect(coverage.derivedMetrics).toEqual({
      available: summaryDerived.filter((entry) => entry.value !== null).length,
      total: summaryDerived.length,
    });
    expect(coverage.derivedMetrics.total).toBeGreaterThan(0);
    expect(coverage.derivedMetrics.available).toBeLessThanOrEqual(
      coverage.derivedMetrics.total,
    );
    expect(coverage.structuredEvidence).toEqual({
      present: 4,
      total: 4,
      missing: [],
    });
    expect(coverage.newestFilingDate).toBe(newestFiling);
    expect(coverage.newestFilingAgeDays).toBe(10);
    expect(coverage.freshness).toBe(1);
    const expectedScore =
      (coverage.expectedMetrics.present / coverage.expectedMetrics.total +
        coverage.derivedMetrics.available / coverage.derivedMetrics.total +
        1 +
        1) /
      4;
    expect(coverage.score).toBeCloseTo(expectedScore, 3);
    expect(researchEvidenceCoverageSchema.safeParse(coverage).success).toBe(true);
  });

  it("decays freshness after a filing cycle and reaches zero after a year", () => {
    const fresh = computeEvidenceCoverage(snapshot, daysAfter(newestFiling, 120));
    const halfway = computeEvidenceCoverage(
      snapshot,
      daysAfter(newestFiling, 120 + 245 / 2),
    );
    const stale = computeEvidenceCoverage(snapshot, daysAfter(newestFiling, 365));
    const older = computeEvidenceCoverage(snapshot, daysAfter(newestFiling, 900));

    expect(fresh.freshness).toBe(1);
    expect(halfway.freshness).toBeCloseTo(0.5, 2);
    expect(stale.freshness).toBe(0);
    expect(older.freshness).toBe(0);
    expect(older.newestFilingAgeDays).toBe(900);
    expect(stale.score).toBeLessThan(fresh.score);
  });

  it("reports missing structured evidence and an unknown filing date honestly", () => {
    const withoutEvent = buildAaplFixtureSnapshot({ upcomingEarnings: null });
    const coverage = computeEvidenceCoverage(withoutEvent, "2026-09-22");
    expect(coverage.structuredEvidence).toEqual({
      present: 3,
      total: 4,
      missing: ["upcoming earnings event"],
    });
    expect(upcomingEarningsFromEvidence(withoutEvent.evidence)).toBeNull();

    const bare = computeEvidenceCoverage(
      { missingMetrics: [...expectedMetricNames], evidence: [] },
      "2026-09-22",
    );
    expect(bare).toMatchObject({
      score: 0,
      expectedMetrics: { present: 0, total: expectedMetricNames.length },
      derivedMetrics: { available: 0, total: 0 },
      structuredEvidence: { present: 0, total: 4 },
      newestFilingDate: null,
      newestFilingAgeDays: null,
      freshness: 0,
    });
  });

  it("extracts the stored upcoming earnings event for What to Watch", () => {
    expect(upcomingEarningsFromEvidence(snapshot.evidence)).toEqual({
      eventDate: "2026-10-29",
      marketSession: "AFTER_MARKET",
    });
  });
});
