import { describe, expect, it } from "vitest";

import {
  diffResearchReports,
  type ReportDiffClaim,
} from "@/lib/research/ai/report-diff";
import type { ResearchEvidence } from "@/lib/research/ai/schemas";

function evidence(
  id: string,
  overrides: Partial<ResearchEvidence> = {},
): ResearchEvidence {
  return {
    id,
    sourceKind: "SEC_FILING",
    title: "Annual filing",
    sourceReference: "sec://example/annual/results",
    sourceUrl: "https://www.sec.gov/Archives/example.htm",
    accessionNumber: "0000000000-26-000001",
    section: "Results of operations",
    objectKey: "sec/example/annual.htm",
    sha256: "a".repeat(64),
    sourceDate: "2026-01-31",
    retrievedAt: "2026-02-02T12:00:00.000Z",
    excerpt: "Revenue increased 12% year over year.",
    passageStart: 100,
    passageEnd: 139,
    secFilingId: "filing-example",
    secRawSourceId: "raw-example",
    secFinancialFactId: null,
    metadata: {},
    ...overrides,
  };
}

function claim(
  statement: string,
  evidenceIds: string[],
  overrides: Partial<ReportDiffClaim> = {},
): ReportDiffClaim {
  return {
    category: "SUPPORTIVE",
    kind: "INTERPRETATION",
    statement,
    confidence: 0.8,
    evidenceIds,
    counterEvidenceIds: [],
    assumptions: [],
    ...overrides,
  };
}

describe("research report diff", () => {
  it("returns no material change for the same structured report", () => {
    const source = evidence("ev_aaaaaaaaaaaaaaaa");
    const report = {
      rating: "NEUTRAL" as const,
      confidence: 0.8,
      claims: [claim("Revenue increased 12% year over year.", [source.id])],
      evidence: [source],
      sourceSnapshotSha256: "1".repeat(64),
      sourceDataVersion: "source-v1",
    };

    expect(diffResearchReports(report, report)).toEqual(
      expect.objectContaining({
        newClaims: [],
        removedClaims: [],
        changedClaims: [],
        evidenceChanges: [],
        hasMaterialChanges: false,
      }),
    );
  });

  it("distinguishes rewritten, new, and removed claims and source evidence", () => {
    const oldRevenue = evidence("ev_aaaaaaaaaaaaaaaa");
    const newRevenue = evidence("ev_dddddddddddddddd", {
      sha256: "d".repeat(64),
      excerpt: "Revenue increased 15% year over year.",
    });
    const marginCounter = evidence("ev_bbbbbbbbbbbbbbbb", {
      sourceKind: "SEC_FACT",
      sourceReference: "sec-fact://example/margin",
      objectKey: "sec/example/company-facts.json",
      sha256: "b".repeat(64),
      excerpt: "Operating margin declined 3%.",
      passageStart: 200,
      passageEnd: 229,
      secRawSourceId: "raw-facts",
      secFinancialFactId: "fact-margin",
    });
    const concentration = evidence("ev_cccccccccccccccc", {
      sourceReference: "sec://example/annual/concentration",
      section: "Risk factors",
      excerpt: "The largest customer represented 42% of revenue.",
      passageStart: 300,
      passageEnd: 350,
    });
    const cashFlow = evidence("ev_eeeeeeeeeeeeeeee", {
      sourceReference: "sec://example/annual/cash-flow",
      section: "Liquidity",
      excerpt: "Free cash flow remained positive.",
      passageStart: 400,
      passageEnd: 433,
    });

    const previous = {
      rating: "NEUTRAL" as const,
      confidence: 0.68,
      claims: [
        claim("Revenue increased 12% year over year.", [oldRevenue.id], {
          counterEvidenceIds: [marginCounter.id],
        }),
        claim(
          "The largest customer represented 42% of revenue.",
          [concentration.id],
          { category: "RISK", confidence: 0.9 },
        ),
      ],
      evidence: [oldRevenue, marginCounter, concentration],
      sourceSnapshotSha256: "1".repeat(64),
      sourceDataVersion: "source-v1",
    };
    const current = {
      rating: "BULLISH" as const,
      confidence: 0.82,
      claims: [
        claim("Revenue increased 15% year over year.", [newRevenue.id], {
          confidence: 0.91,
        }),
        claim("Free cash flow remained positive.", [cashFlow.id], {
          confidence: 0.76,
        }),
      ],
      evidence: [newRevenue, cashFlow],
      sourceSnapshotSha256: "2".repeat(64),
      sourceDataVersion: "source-v2",
    };

    const result = diffResearchReports(previous, current);

    expect(result.rating).toEqual({
      previous: "NEUTRAL",
      current: "BULLISH",
      changed: true,
    });
    expect(result.confidence).toEqual({
      previous: 0.68,
      current: 0.82,
      delta: 0.14,
      materiallyChanged: true,
    });
    expect(result.newClaims).toHaveLength(1);
    expect(result.newClaims[0].claim.statement).toContain("Free cash flow");
    expect(result.removedClaims).toHaveLength(1);
    expect(result.removedClaims[0].claim.category).toBe("RISK");
    expect(result.changedClaims).toHaveLength(1);
    expect(result.changedClaims[0].reasons).toEqual(
      expect.arrayContaining([
        "statement",
        "confidence",
        "supporting-evidence",
        "counter-evidence",
      ]),
    );
    expect(result.evidenceChanges).toHaveLength(1);
    expect(result.evidenceChanges[0].supporting.modified).toEqual([
      { previousId: oldRevenue.id, currentId: newRevenue.id },
    ]);
    expect(result.evidenceChanges[0].counter.removedIds).toEqual([
      marginCounter.id,
    ]);
    expect(result.source).toMatchObject({
      snapshotChanged: true,
      dataChanged: true,
    });
    expect(result.hasMaterialChanges).toBe(true);
  });

  it("reports a small confidence delta without calling it material", () => {
    const source = evidence("ev_aaaaaaaaaaaaaaaa");
    const previous = {
      rating: "NEUTRAL" as const,
      confidence: 0.7,
      claims: [claim("Revenue increased 12% year over year.", [source.id])],
      evidence: [source],
      sourceSnapshotSha256: null,
      sourceDataVersion: null,
    };
    const current = { ...previous, confidence: 0.75 };

    const result = diffResearchReports(previous, current, {
      confidenceThreshold: 0.1,
    });

    expect(result.confidence).toEqual({
      previous: 0.7,
      current: 0.75,
      delta: 0.05,
      materiallyChanged: false,
    });
    expect(result.hasMaterialChanges).toBe(false);
  });
});
