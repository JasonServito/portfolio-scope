import { describe, expect, it } from "vitest";

import {
  AI_RETRIEVAL_VERSION,
} from "@/lib/research/ai/config";
import {
  AAPL_FIXTURE_PEERS,
  AAPL_FIXTURE_STOCK,
  aaplFixtureFactCandidates,
  buildAaplFixtureSnapshot,
  findFixtureEvidence,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
  assembleResearchEvidenceSnapshot,
  type ResearchEvidenceSnapshot,
} from "@/lib/research/ai/retrieval";
import { researchEvidenceSchema } from "@/lib/research/ai/schemas";
import { SEC_DERIVED_METRICS_VERSION } from "@/lib/sec/derived-metrics";

const snapshot = buildAaplFixtureSnapshot();

function evidenceTypes(value: ResearchEvidenceSnapshot) {
  const counts = new Map<string, number>();
  for (const item of value.evidence) {
    const key = `${item.sourceKind}:${String(item.metadata.evidenceType)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

describe("M29 structured research evidence", () => {
  it("assembles the versioned AAPL snapshot with derived, table, trend, peer, and event evidence", () => {
    expect(snapshot.schemaVersion).toBe("m31-public-evidence-snapshot-v3");
    expect(snapshot.schemaVersion).toBe(RESEARCH_EVIDENCE_SNAPSHOT_VERSION);
    expect(snapshot.retrievalVersion).toBe("m31-structured-lexical-v2");
    expect(snapshot.retrievalVersion).toBe(AI_RETRIEVAL_VERSION);
    expect(evidenceTypes(snapshot)).toEqual({
      "COMPANY_PROFILE:PUBLIC_COMPANY_IDENTITY": 1,
      "DERIVED:DERIVED_METRIC": 17,
      "DERIVED:FINANCIAL_SUMMARY_TABLE": 1,
      "DERIVED:FINANCIAL_TREND_EXCERPT": 1,
      "DERIVED:PEER_COMPARISON_TABLE": 1,
      "DETERMINISTIC:EXPLICIT_MISSING_METRICS": 1,
      "DETERMINISTIC:UPCOMING_EARNINGS_EVENT": 1,
      "PEER_SET:PUBLIC_PEER_SET": 1,
      "SEC_FACT:SELECTED_SEC_FACT": 70,
      "SEC_FILING:SEC_FILING_PASSAGE": 22,
    });
    expect(snapshot.missingMetrics).toEqual([]);
    expect(snapshot.ambiguousMetrics).toEqual([]);
    expect(
      snapshot.evidence.every(
        (item) => researchEvidenceSchema.safeParse(item).success,
      ),
    ).toBe(true);
    expect(snapshot.evidence.every((item) => item.excerpt.length <= 4_000)).toBe(
      true,
    );
    // Filing passages are public disclosure text and may contain words such
    // as "portfolio"; the private-data check excludes their verbatim excerpts.
    const withoutPassages = snapshot.evidence
      .filter((item) => item.sourceKind === "SEC_FILING")
      .reduce(
        (text, item) => text.replaceAll(JSON.stringify(item.excerpt).slice(1, -1), ""),
        JSON.stringify(snapshot),
      );
    expect(withoutPassages).not.toMatch(
      /userId|portfolio|holding|alert|targetPrice/i,
    );
    expect(JSON.stringify(snapshot)).not.toContain(": 0 USD");
  });

  it("records formula, inputs, periods, units, derived marker, and version on every derived item", () => {
    const derivedItems = snapshot.evidence.filter(
      (item) => item.metadata.evidenceType === "DERIVED_METRIC",
    );
    const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
    for (const item of derivedItems) {
      expect(item.sourceKind).toBe("DERIVED");
      expect(item.metadata).toMatchObject({
        isDerived: true,
        calculationVersion: SEC_DERIVED_METRICS_VERSION,
      });
      expect(typeof item.metadata.formula).toBe("string");
      expect(typeof item.metadata.periodEnd).toBe("string");
      expect(["USD", "PERCENT", "RATIO"]).toContain(item.metadata.unit);
      const inputIds = item.metadata.inputEvidenceIds as string[];
      expect(inputIds.length).toBeGreaterThanOrEqual(2);
      expect(inputIds.every((id) => evidenceIds.has(id))).toBe(true);
      expect(item.excerpt).toContain("Formula:");
      expect(item.excerpt).toContain("derived value");
    }

    const growth = findFixtureEvidence(snapshot, {
      evidenceType: "DERIVED_METRIC",
      metricId: "REVENUE_GROWTH_YOY",
      periodKind: "ANNUAL",
    });
    expect(growth.excerpt).toBe(
      "Revenue growth (year over year), annual period 2024-09-29 to 2025-09-27: 6.4 percent. Formula: (REVENUE[current] - REVENUE[prior year]) / |REVENUE[prior year]| x 100. Inputs: current REVENUE 416,161,000,000 USD (2024-09-29 to 2025-09-27); prior year REVENUE 391,035,000,000 USD (2023-10-01 to 2024-09-28). This is a derived value (sec-derived-v1) calculated from the cited SEC facts; the filer did not report it.",
    );
    const inputs = growth.metadata.inputs as Array<Record<string, unknown>>;
    const cited = inputs.map((input) =>
      snapshot.evidence.find((item) => item.id === input.evidenceId),
    );
    expect(cited.map((item) => item?.metadata.normalizedValue)).toEqual([
      "416161000000",
      "391035000000",
    ]);
    expect(
      ((Number(cited[0]!.metadata.normalizedValue) -
        Number(cited[1]!.metadata.normalizedValue)) /
        Number(cited[1]!.metadata.normalizedValue)) *
        100,
    ).toBeCloseTo(growth.metadata.value as number, 9);
  });

  it("keeps unavailable derived metrics explicit in the summary table instead of inventing values", () => {
    const candidates = aaplFixtureFactCandidates().filter(
      (fact) => fact.canonicalMetric !== "OPERATING_INCOME",
    );
    const withoutOperatingIncome = assembleResearchEvidenceSnapshot({
      record: AAPL_FIXTURE_STOCK,
      factCandidates: candidates,
      peerRecords: [],
      peerFactCandidates: [],
      upcomingEarnings: null,
    });
    expect(withoutOperatingIncome.missingMetrics).toEqual(["OPERATING_INCOME"]);
    expect(
      withoutOperatingIncome.evidence.some(
        (item) => item.metadata.metricId === "OPERATING_MARGIN",
      ),
    ).toBe(false);
    const table = findFixtureEvidence(withoutOperatingIncome, {
      evidenceType: "FINANCIAL_SUMMARY_TABLE",
    });
    expect(table.excerpt).toContain(
      "Operating margin: annual unavailable (OPERATING_INCOME has no selected annual period observation.); quarterly unavailable (OPERATING_INCOME has no selected quarterly period observation.).",
    );
    expect(table.excerpt).toContain("Operating income: not in the selected facts.");
    expect(
      withoutOperatingIncome.evidence.some(
        (item) => item.metadata.evidenceType === "UPCOMING_EARNINGS_EVENT",
      ),
    ).toBe(false);
  });

  it("withholds derived values whose latest input is ambiguous", () => {
    const candidates = aaplFixtureFactCandidates();
    const latestAnnualRevenue = candidates.find(
      (fact) =>
        fact.canonicalMetric === "REVENUE" &&
        fact.periodKind === "ANNUAL" &&
        new Date(fact.periodEnd).toISOString().startsWith("2025-09-27"),
    )!;
    const ambiguous = [
      ...candidates.map((fact) =>
        fact === latestAnnualRevenue
          ? { ...fact, selection: "AMBIGUOUS" as const }
          : fact,
      ),
      {
        ...latestAnnualRevenue,
        id: "fact-revenue-ambiguous-twin",
        externalKey: `${latestAnnualRevenue.externalKey}-twin`,
        normalizedValue: "416161000001",
        selection: "AMBIGUOUS" as const,
      },
    ];
    const result = assembleResearchEvidenceSnapshot({
      record: AAPL_FIXTURE_STOCK,
      factCandidates: ambiguous,
      peerRecords: [],
      peerFactCandidates: [],
      upcomingEarnings: null,
    });
    expect(result.ambiguousMetrics).toEqual(["REVENUE"]);
    expect(
      result.evidence.filter(
        (item) =>
          item.metadata.metricId === "REVENUE_GROWTH_YOY" &&
          item.metadata.periodKind === "ANNUAL",
      ),
    ).toHaveLength(0);
    expect(
      findFixtureEvidence(result, { evidenceType: "FINANCIAL_SUMMARY_TABLE" })
        .excerpt,
    ).toContain(
      "annual unavailable (REVENUE is withheld because its latest annual period observation is ambiguous across filings.)",
    );
    expect(
      result.evidence.some(
        (item) =>
          item.metadata.metricId === "REVENUE_GROWTH_YOY" &&
          item.metadata.periodKind === "QUARTERLY",
      ),
    ).toBe(true);
  });

  it("builds the trend excerpt from eight quarters with explicit gaps", () => {
    const trend = findFixtureEvidence(snapshot, {
      evidenceType: "FINANCIAL_TREND_EXCERPT",
    });
    expect(trend.metadata.periods).toHaveLength(8);
    expect(trend.excerpt).toContain(
      "Quarterly Revenue: 2024-03-30: 90,753,000,000 USD;",
    );
    expect(trend.excerpt).toContain("2026-06-27: 109,417,000,000 USD");
    expect(trend.excerpt).toContain("2026-06-27: not available");
    expect(trend.excerpt).toContain("2025-12-27: 51,552,000,000 USD");
    const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
    expect(
      (trend.metadata.inputEvidenceIds as string[]).every((id) =>
        evidenceIds.has(id),
      ),
    ).toBe(true);
    expect((trend.metadata.inputEvidenceIds as string[]).length).toBeGreaterThan(
      16,
    );
  });

  it("compares peers on their own periods with the same derived metrics and provenance", () => {
    const peer = findFixtureEvidence(snapshot, {
      evidenceType: "PEER_COMPARISON_TABLE",
    });
    expect(peer.excerpt).toContain(
      "AAPL (subject): revenue 416,161,000,000 USD (annual period ending 2025-09-27); revenue growth 6.4 percent; operating margin 32.0 percent; net margin 26.9 percent; free cash flow margin 23.7 percent; long-term debt-to-equity 0.66 (at 2026-06-27); current ratio 1.00 (at 2026-06-27).",
    );
    expect(peer.excerpt).toContain(
      "MSFT: revenue 331,839,000,000 USD (annual period ending 2026-06-30); revenue growth 17.8 percent; operating margin 46.8 percent; net margin 40.3 percent; free cash flow margin 20.2 percent; long-term debt-to-equity 0.07 (at 2026-06-30); current ratio 1.23 (at 2026-06-30).",
    );
    expect(peer.excerpt).toContain("NVDA: revenue 215,938,000,000 USD");
    expect(peer.excerpt).toContain("free cash flow margin n/a");
    expect(peer.excerpt).toContain(
      "ORCL: no selected annual SEC facts in this snapshot.",
    );
    const rows = peer.metadata.rows as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.ticker)).toEqual(["AAPL", "MSFT", "NVDA", "ORCL"]);
    const msft = rows[1];
    const msftGrowth = (msft.metrics as Array<Record<string, unknown>>).find(
      (metric) => metric.metricId === "REVENUE_GROWTH_YOY" && metric.periodKind === "ANNUAL",
    )!;
    expect(msftGrowth.value).toBeCloseTo(
      ((331_839_000_000 - 281_724_000_000) / 281_724_000_000) * 100,
      6,
    );
    const inputs = msftGrowth.inputs as Array<Record<string, unknown>>;
    expect(inputs.map((input) => input.value)).toEqual([
      331_839_000_000, 281_724_000_000,
    ]);
    expect(inputs.every((input) => typeof input.accessionNumber === "string")).toBe(
      true,
    );
    expect(peer.excerpt).toContain("no market share or ranking is implied");
    expect(snapshot.peers.map((item) => item.ticker)).toEqual(
      AAPL_FIXTURE_PEERS.map((item) => item.ticker),
    );
  });

  it("includes the stored upcoming earnings event only when a date is present", () => {
    const event = findFixtureEvidence(snapshot, {
      evidenceType: "UPCOMING_EARNINGS_EVENT",
    });
    expect(event).toMatchObject({
      sourceKind: "DETERMINISTIC",
      sourceDate: null,
      retrievedAt: null,
    });
    expect(event.excerpt).toContain("dated 2026-10-29 after market close");
    expect(event.excerpt).toContain("may change");
    expect(event.excerpt).not.toMatch(/EarningsAPI|2026-09-21/);
    expect(event.metadata).not.toHaveProperty("fetchedAt");

    // A calendar refresh that changes only the fetch time must not change the
    // snapshot fingerprint, or fresh reports would stop being reused.
    const refetched = buildAaplFixtureSnapshot({
      upcomingEarnings: {
        eventDate: new Date("2026-10-29T00:00:00.000Z"),
        marketSession: "AFTER_MARKET",
        source: "EarningsAPI.com /v1/earnings",
        fetchedAt: new Date("2026-09-23T09:00:00.000Z"),
      },
    });
    expect(refetched.sourceSnapshotSha256).toBe(snapshot.sourceSnapshotSha256);

    const unknownDate = buildAaplFixtureSnapshot({
      upcomingEarnings: {
        eventDate: null,
        marketSession: null,
        source: "EarningsAPI.com /v1/earnings",
        fetchedAt: new Date("2026-09-21T12:00:00.000Z"),
      },
    });
    expect(
      unknownDate.evidence.some(
        (item) => item.metadata.evidenceType === "UPCOMING_EARNINGS_EVENT",
      ),
    ).toBe(false);
    expect(unknownDate.sourceSnapshotSha256).not.toBe(
      snapshot.sourceSnapshotSha256,
    );
  });

  it("is deterministic across repeated assembly", () => {
    const again = buildAaplFixtureSnapshot();
    expect(again.sourceSnapshotSha256).toBe(snapshot.sourceSnapshotSha256);
    expect(again.evidence.map((item) => item.id)).toEqual(
      snapshot.evidence.map((item) => item.id),
    );
  });
});
