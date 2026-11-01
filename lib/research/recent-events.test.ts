import { describe, expect, it } from "vitest";

import type { ResearchEvidence } from "@/lib/research/ai/schemas";
import { recentEventsFromResearch } from "@/lib/research/recent-events";
import type { AgentResult } from "@/lib/research/types";

function evidence(
  id: string,
  overrides: Partial<ResearchEvidence> & { metadata?: ResearchEvidence["metadata"] },
): ResearchEvidence {
  return {
    id,
    sourceKind: "SEC_FILING",
    title: id,
    sourceReference: `ref:${id}`,
    sourceUrl: null,
    accessionNumber: null,
    section: null,
    objectKey: null,
    sha256: null,
    sourceDate: null,
    retrievedAt: null,
    excerpt: "Excerpt.",
    passageStart: null,
    passageEnd: null,
    secFilingId: null,
    secRawSourceId: null,
    secFinancialFactId: null,
    metadata: {},
    ...overrides,
  };
}

const july = evidence("ev_00000000000000a1", {
  accessionNumber: "0000320193-26-000019",
  sourceDate: "2026-07-30",
  metadata: { evidenceType: "SEC_CURRENT_REPORT", formType: "8-K", filingDate: "2026-07-30" },
});
const julyPassage = evidence("ev_00000000000000a2", {
  accessionNumber: "0000320193-26-000019",
  sourceDate: "2026-07-30",
  metadata: { evidenceType: "SEC_FILING_PASSAGE", formType: "8-K", filingDate: "2026-07-30" },
});
const february = evidence("ev_00000000000000a3", {
  accessionNumber: "0000320193-26-000004",
  sourceDate: "2026-02-26",
  metadata: { evidenceType: "SEC_CURRENT_REPORT", formType: "8-K/A", filingDate: "2026-02-26" },
});
const tenK = evidence("ev_00000000000000a4", {
  accessionNumber: "0000320193-25-000079",
  sourceDate: "2025-10-31",
  metadata: { evidenceType: "SEC_FILING_PASSAGE", formType: "10-K", filingDate: "2025-10-31" },
});
const derived = evidence("ev_00000000000000a5", {
  sourceKind: "DERIVED",
  metadata: { evidenceType: "DERIVED_METRIC" },
});
const registry = [july, julyPassage, february, tenK, derived];

function newsAgent(
  claims: NonNullable<AgentResult["claims"]>,
  overrides: Partial<AgentResult> = {},
): AgentResult {
  return {
    agentName: "NEWS",
    status: "COMPLETED",
    rating: "NEUTRAL",
    confidence: 0.6,
    availability: "PARTIAL",
    summary: "Events.",
    findings: [],
    sources: [],
    warnings: [],
    claims,
    ...overrides,
  };
}

function claim(statement: string, evidenceIds: string[]) {
  return {
    category: "SUPPORTIVE" as const,
    kind: "FACT" as const,
    statement,
    confidence: 0.8,
    evidenceIds,
    counterEvidenceIds: [],
    assumptions: [],
  };
}

describe("recent events from the News specialist", () => {
  it("dates each News claim by the newest cited Form 8-K and orders events newest first", () => {
    const events = recentEventsFromResearch(
      [
        newsAgent([
          claim("Annual meeting vote reported.", [february.id, derived.id]),
          claim("Third quarter results announced.", [julyPassage.id, tenK.id]),
        ]),
      ],
      registry,
    );

    expect(events).toEqual([
      {
        filingDate: "2026-07-30",
        formType: "8-K",
        accessionNumber: "0000320193-26-000019",
        statement: "Third quarter results announced.",
      },
      {
        filingDate: "2026-02-26",
        formType: "8-K/A",
        accessionNumber: "0000320193-26-000004",
        statement: "Annual meeting vote reported.",
      },
    ]);
  });

  it("drops a claim that cites no Form 8-K, so no event appears without a dated current report", () => {
    expect(
      recentEventsFromResearch(
        [newsAgent([claim("Risk factors mention tariffs.", [tenK.id, derived.id])])],
        registry,
      ),
    ).toEqual([]);
    expect(
      recentEventsFromResearch(
        [newsAgent([claim("Unknown evidence.", ["ev_ffffffffffffffff"])])],
        registry,
      ),
    ).toEqual([]);
  });

  it("returns nothing for a not-available, failed, or missing News specialist", () => {
    const claims = [claim("Results announced.", [july.id])];
    expect(
      recentEventsFromResearch(
        [newsAgent([], { availability: "NOT_AVAILABLE" })],
        registry,
      ),
    ).toEqual([]);
    expect(
      recentEventsFromResearch([newsAgent(claims, { status: "FAILED" })], registry),
    ).toEqual([]);
    expect(
      recentEventsFromResearch(
        [{ ...newsAgent(claims), agentName: "RISK" }],
        registry,
      ),
    ).toEqual([]);
    expect(recentEventsFromResearch([], registry)).toEqual([]);
  });

  it("keeps at most six events", () => {
    const claims = Array.from({ length: 8 }, (_, index) =>
      claim(`Event ${index}.`, [july.id]),
    );
    expect(recentEventsFromResearch([newsAgent(claims)], registry)).toHaveLength(6);
  });
});
