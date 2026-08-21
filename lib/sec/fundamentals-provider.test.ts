import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  companyFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    company: { findFirst: mocks.companyFindFirst },
  },
}));

import {
  CachedFundamentalsProvider,
  SecEdgarFundamentalsProvider,
  classifyFundamentalsFreshness,
} from "@/lib/sec/fundamentals-provider";

describe("SEC fundamentals provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies data-type-specific freshness boundaries", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    expect(classifyFundamentalsFreshness(null, now)).toBe("MISSING");
    expect(
      classifyFundamentalsFreshness(new Date("2026-07-13T00:00:00.000Z"), now),
    ).toBe("CURRENT");
    expect(
      classifyFundamentalsFreshness(new Date("2026-07-05T00:00:00.000Z"), now),
    ).toBe("RECENT");
    expect(
      classifyFundamentalsFreshness(new Date("2026-06-15T00:00:00.000Z"), now),
    ).toBe("DELAYED");
    expect(
      classifyFundamentalsFreshness(new Date("2026-01-01T00:00:00.000Z"), now),
    ).toBe("STALE");
  });

  it("returns unsupported without touching persistence", async () => {
    const provider = new SecEdgarFundamentalsProvider();

    await expect(provider.getFundamentals("SHOP")).resolves.toMatchObject({
      freshness: "UNSUPPORTED",
      facts: [],
    });
    expect(mocks.companyFindFirst).not.toHaveBeenCalled();
  });

  it("returns explicit missing state before the first controlled ingestion", async () => {
    mocks.companyFindFirst.mockResolvedValue(null);
    const provider = new SecEdgarFundamentalsProvider();

    await expect(provider.getFundamentals("AAPL")).resolves.toMatchObject({
      cik: "0000320193",
      freshness: "MISSING",
      facts: [],
    });
  });

  it("shapes selected facts with provenance and withholds ambiguous values", async () => {
    const companyRecord = {
      name: "Apple Inc.",
      secEntity: {
        cik: "0000320193",
        rawSources: [{ lastRetrievedAt: new Date("2026-07-15T00:00:00.000Z") }],
        ingestionRuns: [
          { status: "COMPLETED", errorCode: null, completedAt: new Date() },
        ],
        financialFacts: [
          {
            canonicalMetric: "REVENUE",
            label: "Revenue",
            normalizedValue: { toNumber: () => 416_161_000_000 },
            normalizedUnit: "USD",
            originalValue: { toString: () => "416161000000" },
            originalUnit: "USD",
            taxonomy: "us-gaap",
            concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
            periodStart: new Date("2024-09-29T00:00:00.000Z"),
            periodEnd: new Date("2025-09-27T00:00:00.000Z"),
            periodKind: "ANNUAL",
            fiscalYear: 2025,
            fiscalPeriod: "FY",
            formType: "10-K",
            filedAt: new Date("2025-10-31T00:00:00.000Z"),
            accessionNumber: "0000320193-25-000079",
            sourceUrl: "https://www.sec.gov/Archives/example",
            observedAt: new Date("2026-07-15T00:00:00.000Z"),
            normalizationVersion: "sec-xbrl-v1",
            isDerived: false,
            selection: "SELECTED",
          },
          {
            canonicalMetric: "NET_INCOME",
            label: "Net income",
            normalizedValue: { toNumber: () => 1 },
            normalizedUnit: "USD",
            originalValue: { toString: () => "1" },
            originalUnit: "USD",
            taxonomy: "us-gaap",
            concept: "NetIncomeLoss",
            periodStart: new Date("2024-09-29T00:00:00.000Z"),
            periodEnd: new Date("2025-09-27T00:00:00.000Z"),
            periodKind: "ANNUAL",
            fiscalYear: 2025,
            fiscalPeriod: "FY",
            formType: "10-K",
            filedAt: new Date("2025-10-31T00:00:00.000Z"),
            accessionNumber: "0000320193-25-000079",
            sourceUrl: "https://www.sec.gov/Archives/example",
            observedAt: new Date("2026-07-15T00:00:00.000Z"),
            normalizationVersion: "sec-xbrl-v1",
            isDerived: false,
            selection: "AMBIGUOUS",
          },
        ],
      },
    };
    companyRecord.secEntity.financialFacts.push({
      ...companyRecord.secEntity.financialFacts[1],
      periodStart: new Date("2023-09-30T00:00:00.000Z"),
      periodEnd: new Date("2024-09-28T00:00:00.000Z"),
      filedAt: new Date("2024-11-01T00:00:00.000Z"),
      accessionNumber: "0000320193-24-000123",
      selection: "SELECTED",
    });
    companyRecord.secEntity.financialFacts.push({
      ...companyRecord.secEntity.financialFacts[0],
      periodStart: new Date("2025-06-29T00:00:00.000Z"),
      periodEnd: new Date("2025-09-27T00:00:00.000Z"),
      periodKind: "QUARTERLY",
      fiscalPeriod: "FY",
    });
    companyRecord.secEntity.financialFacts.unshift({
      ...companyRecord.secEntity.financialFacts[0],
      periodStart: new Date("2025-09-28T00:00:00.000Z"),
      periodEnd: new Date("2025-12-27T00:00:00.000Z"),
      periodKind: "QUARTERLY",
      fiscalYear: 2026,
      fiscalPeriod: "Q1",
      formType: "10-Q",
      selection: "AMBIGUOUS",
    });
    mocks.companyFindFirst.mockResolvedValue(companyRecord);
    const provider = new SecEdgarFundamentalsProvider();

    const result = await provider.getFundamentals("AAPL");

    expect(result.facts).toHaveLength(1);
    expect(result.trendPeriods).toEqual([
      "2025-12-27T00:00:00.000Z",
      "2025-09-27T00:00:00.000Z",
    ]);
    expect(result.trendFacts).toHaveLength(1);
    expect(result.trendFacts[0]).toMatchObject({
      metric: "REVENUE",
      periodKind: "QUARTERLY",
      periodEnd: "2025-09-27T00:00:00.000Z",
    });
    expect(result.facts[0]).toMatchObject({
      metric: "REVENUE",
      periodKind: "ANNUAL",
      accessionNumber: "0000320193-25-000079",
      isDerived: false,
    });
    expect(result.ambiguousMetrics).toEqual(["NET_INCOME", "REVENUE"]);
    expect(result.missingMetrics).toContain("NET_INCOME");
  });

  it("caches only a shaped fundamentals snapshot", async () => {
    const snapshot = {
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      provider: "SEC_EDGAR" as const,
      freshness: "CURRENT" as const,
      retrievedAt: "2026-07-21T00:00:00.000Z",
      facts: [],
      trendPeriods: [],
      trendFacts: [],
      missingMetrics: [],
      ambiguousMetrics: [],
      lastErrorCode: null,
    };
    const source = { getFundamentals: vi.fn().mockResolvedValue(snapshot) };
    const cache = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(true),
    };
    const provider = new CachedFundamentalsProvider(source, cache);

    await expect(provider.getFundamentals("aapl")).resolves.toEqual(snapshot);
    expect(cache.setJson).toHaveBeenCalledWith(
      "fundamentals",
      "AAPL",
      snapshot,
      300,
    );
  });

  it("rejects malformed nested facts from the ephemeral cache", async () => {
    const snapshot = {
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      provider: "SEC_EDGAR" as const,
      freshness: "CURRENT" as const,
      retrievedAt: "2026-07-21T00:00:00.000Z",
      facts: [],
      trendPeriods: [],
      trendFacts: [],
      missingMetrics: [],
      ambiguousMetrics: [],
      lastErrorCode: null,
    };
    const source = { getFundamentals: vi.fn().mockResolvedValue(snapshot) };
    const cache = {
      getJson: vi.fn().mockResolvedValue({
        ...snapshot,
        facts: [{ sourceUrl: "javascript:alert(1)" }],
      }),
      setJson: vi.fn().mockResolvedValue(true),
    };
    const provider = new CachedFundamentalsProvider(source, cache);

    await expect(provider.getFundamentals("AAPL")).resolves.toEqual(snapshot);
    expect(source.getFundamentals).toHaveBeenCalledWith("AAPL");
  });
});
