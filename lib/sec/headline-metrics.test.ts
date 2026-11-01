import { describe, expect, it } from "vitest";

import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";
import { buildHeadlineMetrics } from "@/lib/sec/headline-metrics";

function fact(
  metric: string,
  value: number,
  options: Partial<CanonicalFundamentalFact> = {},
): CanonicalFundamentalFact {
  return {
    metric,
    label: metric,
    value,
    unit: "USD",
    originalValue: String(value),
    originalUnit: "USD",
    taxonomy: "us-gaap",
    concept: metric,
    periodStart: "2024-09-29T00:00:00.000Z",
    periodEnd: "2025-09-27T00:00:00.000Z",
    periodKind: "ANNUAL",
    fiscalYear: 2025,
    fiscalPeriod: "FY",
    formType: "10-K",
    filedAt: "2025-10-31T00:00:00.000Z",
    accessionNumber: "0000320193-25-000079",
    sourceUrl: "https://www.sec.gov/Archives/example",
    observedAt: "2026-07-15T00:00:00.000Z",
    normalizationVersion: "sec-xbrl-v1",
    isDerived: false,
    selection: "SELECTED",
    ...options,
  };
}

const snapshot: FundamentalsSnapshot = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  provider: "SEC_EDGAR",
  freshness: "CURRENT",
  retrievedAt: "2026-07-15T00:00:00.000Z",
  facts: [
    fact("REVENUE", 1_000),
    fact("DILUTED_EPS", 5, { unit: "USD/share" }),
    fact("OPERATING_CASH_FLOW", 200),
    fact("CAPITAL_EXPENDITURES", 50),
    fact("OPERATING_INCOME", 250),
    fact("LONG_TERM_DEBT", 300, {
      periodStart: null,
      periodKind: "INSTANT",
    }),
    fact("STOCKHOLDERS_EQUITY", 600, {
      periodStart: null,
      periodKind: "INSTANT",
    }),
  ],
  trendPeriods: [],
  trendFacts: [],
  missingMetrics: [],
  ambiguousMetrics: [],
  lastErrorCode: null,
};

describe("headline financial metrics", () => {
  it("uses matching SEC periods for reported and calculated values", () => {
    const metrics = buildHeadlineMetrics(snapshot);

    expect(metrics).toHaveLength(10);
    expect(metrics.find(({ id }) => id === "REVENUE")).toMatchObject({
      value: 1_000,
      unit: "USD",
      periodKind: "ANNUAL",
      periodEnd: "2025-09-27T00:00:00.000Z",
    });
    expect(metrics.find(({ id }) => id === "EPS")).toMatchObject({
      value: 5,
      unit: "USD_PER_SHARE",
    });
    expect(metrics.find(({ id }) => id === "FREE_CASH_FLOW")).toMatchObject({
      value: 150,
      unit: "USD",
    });
    expect(metrics.find(({ id }) => id === "OPERATING_MARGIN")).toMatchObject({
      value: 25,
      unit: "PERCENT",
    });
    expect(metrics.find(({ id }) => id === "DEBT_TO_EQUITY")).toMatchObject({
      value: 0.5,
      unit: "RATIO",
      periodKind: "INSTANT",
    });
  });

  it("does not invent values when facts are missing, ambiguous, or mismatched", () => {
    const metrics = buildHeadlineMetrics({
      ...snapshot,
      facts: [
        fact("OPERATING_CASH_FLOW", 200),
        fact("CAPITAL_EXPENDITURES", 50, {
          periodEnd: "2024-09-28T00:00:00.000Z",
        }),
        fact("LONG_TERM_DEBT", 300, {
          periodStart: null,
          periodKind: "INSTANT",
          unit: "shares",
        }),
        fact("STOCKHOLDERS_EQUITY", 600, {
          periodStart: null,
          periodKind: "INSTANT",
        }),
      ],
      ambiguousMetrics: ["REVENUE"],
    });

    expect(metrics.find(({ id }) => id === "REVENUE")).toMatchObject({
      value: null,
      unavailableReason: "Conflicting filing observations were withheld.",
    });
    expect(metrics.find(({ id }) => id === "FREE_CASH_FLOW")).toMatchObject({
      value: null,
      unavailableReason: "The required filing data is not available.",
    });
    expect(metrics.find(({ id }) => id === "DEBT_TO_EQUITY")?.value).toBeNull();
    expect(
      metrics.find(({ id }) => id === "MARKET_CAPITALIZATION")?.value,
    ).toBeNull();
    expect(metrics.find(({ id }) => id === "PE_RATIO")?.value).toBeNull();
    expect(metrics.find(({ id }) => id === "ROIC")?.value).toBeNull();
  });
});
