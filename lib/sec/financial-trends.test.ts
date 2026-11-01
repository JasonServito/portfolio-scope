import { describe, expect, it } from "vitest";

import type { CanonicalFundamentalFact } from "@/lib/sec/fundamentals-provider";
import { buildFinancialTrends } from "@/lib/sec/financial-trends";

function fact(
  metric: string,
  periodEnd: string,
  value: number,
  options: Partial<CanonicalFundamentalFact> = {},
): CanonicalFundamentalFact {
  return {
    metric,
    label: metric,
    value,
    unit: metric === "DILUTED_EPS" ? "USD/share" : "USD",
    originalValue: String(value),
    originalUnit: metric === "DILUTED_EPS" ? "USD/shares" : "USD",
    taxonomy: "us-gaap",
    concept: metric,
    periodStart: `${periodEnd.slice(0, 4)}-01-01T00:00:00.000Z`,
    periodEnd,
    periodKind: "QUARTERLY",
    fiscalYear: Number(periodEnd.slice(0, 4)),
    fiscalPeriod: "Q1",
    formType: "10-Q",
    filedAt: periodEnd,
    accessionNumber: "0000320193-26-000001",
    sourceUrl: "https://www.sec.gov/Archives/example",
    observedAt: "2026-08-20T00:00:00.000Z",
    normalizationVersion: "sec-xbrl-v1",
    isDerived: false,
    selection: "SELECTED",
    ...options,
  };
}

describe("financial trends", () => {
  it("orders quarterly values, preserves negative signs, and derives matching free cash flow", () => {
    const trends = buildFinancialTrends({
      trendPeriods: ["2026-03-31T00:00:00.000Z", "2026-06-30T00:00:00.000Z"],
      trendFacts: [
        fact("REVENUE", "2026-06-30T00:00:00.000Z", 120),
        fact("DILUTED_EPS", "2026-06-30T00:00:00.000Z", -0.25),
        fact("OPERATING_CASH_FLOW", "2026-06-30T00:00:00.000Z", 30),
        fact("CAPITAL_EXPENDITURES", "2026-06-30T00:00:00.000Z", 8),
        fact("REVENUE", "2026-03-31T00:00:00.000Z", 100),
        fact("DILUTED_EPS", "2026-03-31T00:00:00.000Z", 0.5),
        fact("OPERATING_CASH_FLOW", "2026-03-31T00:00:00.000Z", 20),
        fact("CAPITAL_EXPENDITURES", "2026-03-31T00:00:00.000Z", 5),
      ],
    });

    expect(trends.map(({ id }) => id)).toEqual([
      "REVENUE",
      "DILUTED_EPS",
      "FREE_CASH_FLOW",
    ]);
    expect(
      trends[0].points.map(({ periodEnd, value }) => [periodEnd, value]),
    ).toEqual([
      ["2026-03-31T00:00:00.000Z", 100],
      ["2026-06-30T00:00:00.000Z", 120],
    ]);
    expect(trends[1].points.map(({ value }) => value)).toEqual([0.5, -0.25]);
    expect(trends[2].points.map(({ value }) => value)).toEqual([15, 22]);
    expect(trends.every(({ status }) => status === "AVAILABLE")).toBe(true);
  });

  it("keeps missing periods null and does not derive cash flow across mismatched periods", () => {
    const trends = buildFinancialTrends({
      trendPeriods: ["2026-03-31T00:00:00.000Z", "2026-06-30T00:00:00.000Z"],
      trendFacts: [
        fact("REVENUE", "2026-03-31T00:00:00.000Z", 100),
        fact("DILUTED_EPS", "2026-06-30T00:00:00.000Z", 1.25),
        fact("OPERATING_CASH_FLOW", "2026-06-30T00:00:00.000Z", 30, {
          periodStart: "2026-04-01T00:00:00.000Z",
        }),
        fact("CAPITAL_EXPENDITURES", "2026-06-30T00:00:00.000Z", 8, {
          periodStart: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(trends[0]).toMatchObject({
      status: "PARTIAL",
      points: [{ value: 100 }, { value: null }],
      missingPeriods: ["Quarter ended Jun 30, 2026"],
    });
    expect(trends[1]).toMatchObject({
      status: "PARTIAL",
      points: [{ value: null }, { value: 1.25 }],
    });
    expect(trends[2]).toMatchObject({
      status: "MISSING",
      points: [{ value: null }, { value: null }],
    });
    expect(trends[2].summary).toContain("No selected quarterly");
  });

  it("keeps an ambiguous period as an explicit gap without exposing its value", () => {
    const trends = buildFinancialTrends({
      trendPeriods: [
        "2026-03-31T00:00:00.000Z",
        "2026-06-30T00:00:00.000Z",
        "2026-09-30T00:00:00.000Z",
      ],
      trendFacts: [
        fact("REVENUE", "2026-03-31T00:00:00.000Z", 100),
        fact("REVENUE", "2026-09-30T00:00:00.000Z", 140),
      ],
    });

    expect(trends[0]).toMatchObject({
      status: "PARTIAL",
      points: [{ value: 100 }, { value: null }, { value: 140 }],
      missingPeriods: ["Quarter ended Jun 30, 2026"],
    });
  });

  it("returns three explicit missing series without inventing periods or zeroes", () => {
    const trends = buildFinancialTrends({ trendPeriods: [], trendFacts: [] });

    expect(trends).toHaveLength(3);
    expect(trends.every(({ status }) => status === "MISSING")).toBe(true);
    expect(trends.every(({ points }) => points.length === 0)).toBe(true);
  });
});
