import { describe, expect, it } from "vitest";

import {
  buildDerivedMetrics,
  formatDerivedValue,
  SEC_DERIVED_METRICS_VERSION,
  type DerivedMetricInputFact,
} from "@/lib/sec/derived-metrics";
import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";
import { buildHeadlineMetrics } from "@/lib/sec/headline-metrics";
import { normalizeCompanyFacts } from "@/lib/sec/normalization";
import { secCompanyFactsSchema } from "@/lib/sec/schemas";
import companyFactsHistory from "@/tests/fixtures/sec/aapl-companyfacts-history.json";

function fact(
  metric: string,
  value: number,
  overrides: Partial<DerivedMetricInputFact> = {},
): DerivedMetricInputFact {
  const instant = [
    "ASSETS",
    "LIABILITIES",
    "STOCKHOLDERS_EQUITY",
    "CASH_AND_EQUIVALENTS",
    "LONG_TERM_DEBT",
    "CURRENT_ASSETS",
    "CURRENT_LIABILITIES",
  ].includes(metric);
  return {
    referenceId: `${metric}:${overrides.periodEnd ?? "2025-09-27"}`,
    metric,
    value,
    unit: metric === "DILUTED_EPS" ? "USD/share" : metric === "DILUTED_SHARES" ? "shares" : "USD",
    periodKind: instant ? "INSTANT" : "ANNUAL",
    periodStart: instant ? null : "2024-09-29",
    periodEnd: "2025-09-27",
    filedAt: "2025-10-31",
    selection: "SELECTED",
    ...overrides,
  };
}

function priorYear(
  metric: string,
  value: number,
  overrides: Partial<DerivedMetricInputFact> = {},
) {
  return fact(metric, value, {
    periodStart: "2023-10-01",
    periodEnd: "2024-09-28",
    filedAt: "2024-11-01",
    ...overrides,
  });
}

function metric(
  metrics: ReturnType<typeof buildDerivedMetrics>,
  id: string,
  periodKind: string,
) {
  const found = metrics.find(
    (candidate) => candidate.id === id && candidate.periodKind === periodKind,
  );
  if (!found) throw new Error(`Missing derived metric ${id} ${periodKind}`);
  return found;
}

const fixtureFacts: DerivedMetricInputFact[] = normalizeCompanyFacts(
  secCompanyFactsSchema.parse(companyFactsHistory),
  { cik: "320193", observedAt: new Date("2026-09-22T00:00:00.000Z") },
).map((normalized) => ({
  referenceId: normalized.externalKey,
  metric: normalized.canonicalMetric,
  value: Number(normalized.normalizedValue),
  unit: normalized.normalizedUnit,
  periodKind: normalized.periodKind,
  periodStart: normalized.periodStart?.toISOString() ?? null,
  periodEnd: normalized.periodEnd.toISOString(),
  filedAt: normalized.filedAt.toISOString(),
  selection: normalized.selection,
}));

describe("derived SEC metrics", () => {
  it("computes growth, margins, cash generation, and leverage from the AAPL fixture with matching periods", () => {
    const metrics = buildDerivedMetrics(fixtureFacts);

    expect(metrics).toHaveLength(17);
    expect(
      metrics.every(
        (item) => item.calculationVersion === SEC_DERIVED_METRICS_VERSION,
      ),
    ).toBe(true);

    const annualRevenueGrowth = metric(metrics, "REVENUE_GROWTH_YOY", "ANNUAL");
    expect(annualRevenueGrowth.value).toBeCloseTo(
      ((416_161_000_000 - 391_035_000_000) / 391_035_000_000) * 100,
      6,
    );
    expect(annualRevenueGrowth).toMatchObject({
      periodStart: "2024-09-29",
      periodEnd: "2025-09-27",
      unavailableReason: null,
    });
    expect(annualRevenueGrowth.inputs.map((input) => input.periodEnd)).toEqual([
      "2025-09-27",
      "2024-09-28",
    ]);

    const quarterlyRevenueGrowth = metric(
      metrics,
      "REVENUE_GROWTH_YOY",
      "QUARTERLY",
    );
    expect(quarterlyRevenueGrowth).toMatchObject({
      periodStart: "2026-03-29",
      periodEnd: "2026-06-27",
    });
    expect(quarterlyRevenueGrowth.value).toBeCloseTo(
      ((109_417_000_000 - 94_036_000_000) / 94_036_000_000) * 100,
      6,
    );

    expect(metric(metrics, "OPERATING_MARGIN", "ANNUAL").value).toBeCloseTo(
      (133_050_000_000 / 416_161_000_000) * 100,
      6,
    );
    expect(metric(metrics, "NET_MARGIN", "QUARTERLY").value).toBeCloseTo(
      (29_789_000_000 / 109_417_000_000) * 100,
      6,
    );
    expect(metric(metrics, "FREE_CASH_FLOW", "ANNUAL")).toMatchObject({
      value: 111_482_000_000 - 12_715_000_000,
      periodEnd: "2025-09-27",
    });

    // Apple reports quarterly cash flows only for its first fiscal quarter, so
    // the latest matching quarter differs from the latest revenue quarter.
    const quarterlyFreeCashFlow = metric(metrics, "FREE_CASH_FLOW", "QUARTERLY");
    expect(quarterlyFreeCashFlow).toMatchObject({
      value: 53_925_000_000 - 2_373_000_000,
      periodStart: "2025-09-28",
      periodEnd: "2025-12-27",
    });
    expect(
      metric(metrics, "FREE_CASH_FLOW_MARGIN", "QUARTERLY").value,
    ).toBeCloseTo(((53_925_000_000 - 2_373_000_000) / 143_756_000_000) * 100, 6);

    expect(metric(metrics, "DEBT_TO_EQUITY", "INSTANT")).toMatchObject({
      periodEnd: "2026-06-27",
    });
    expect(metric(metrics, "DEBT_TO_EQUITY", "INSTANT").value).toBeCloseTo(
      71_340_000_000 / 107_520_000_000,
      6,
    );
    expect(metric(metrics, "CURRENT_RATIO", "INSTANT").value).toBeCloseTo(
      149_818_000_000 / 149_326_000_000,
      6,
    );
    expect(metric(metrics, "NET_CASH", "INSTANT").value).toBe(
      39_544_000_000 - 71_340_000_000,
    );
    expect(
      metric(metrics, "DILUTED_SHARE_CHANGE_YOY", "ANNUAL").value,
    ).toBeCloseTo(
      ((15_004_697_000 - 15_408_095_000) / 15_408_095_000) * 100,
      6,
    );
    for (const item of metrics) {
      if (item.value === null) continue;
      // Bounded precision so the value is identical after a 16-digit JSON store.
      expect(Number(item.value.toPrecision(12))).toBe(item.value);
      expect(Number(item.value.toPrecision(16))).toBe(item.value);
      expect(item.inputs.length).toBeGreaterThanOrEqual(2);
      expect(item.inputs.every((input) => input.referenceId.length > 0)).toBe(
        true,
      );
    }
  });

  it("matches the stock-page headline calculators for shared formulas", () => {
    const shared: CanonicalFundamentalFact[] = fixtureFacts
      .filter(
        (item) =>
          item.selection === "SELECTED" &&
          ["ANNUAL", "INSTANT"].includes(item.periodKind),
      )
      .map((item) => ({
        metric: item.metric,
        label: item.metric,
        value: item.value,
        unit: item.unit,
        originalValue: String(item.value),
        originalUnit: item.unit,
        taxonomy: "us-gaap",
        concept: item.metric,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        periodKind: item.periodKind,
        fiscalYear: null,
        fiscalPeriod: null,
        formType: "10-K",
        filedAt: item.filedAt,
        accessionNumber: "0000320193-25-000079",
        sourceUrl: "https://www.sec.gov/Archives/example",
        observedAt: "2026-09-22T00:00:00.000Z",
        normalizationVersion: "sec-xbrl-v1",
        isDerived: false,
        selection: "SELECTED" as const,
      }))
      .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd));
    const snapshot: FundamentalsSnapshot = {
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      provider: "SEEDED_FIXTURE",
      freshness: "CURRENT",
      retrievedAt: null,
      facts: shared,
      trendPeriods: [],
      trendFacts: [],
      missingMetrics: [],
      ambiguousMetrics: [],
      lastErrorCode: null,
    };
    const headline = new Map(
      buildHeadlineMetrics(snapshot).map((item) => [item.id, item.value]),
    );
    const derived = buildDerivedMetrics(fixtureFacts);

    expect(metric(derived, "FREE_CASH_FLOW", "ANNUAL").value).toBe(
      headline.get("FREE_CASH_FLOW"),
    );
    expect(metric(derived, "OPERATING_MARGIN", "ANNUAL").value).toBeCloseTo(
      headline.get("OPERATING_MARGIN")!,
      9,
    );
    expect(metric(derived, "DEBT_TO_EQUITY", "INSTANT").value).toBeCloseTo(
      headline.get("DEBT_TO_EQUITY")!,
      9,
    );
  });

  it("keeps a metric unavailable with a stated reason when periods do not match", () => {
    const metrics = buildDerivedMetrics([
      fact("OPERATING_INCOME", 250),
      fact("REVENUE", 1_000, {
        periodStart: "2024-10-01",
        periodEnd: "2025-09-27",
      }),
      fact("NET_INCOME", 200, { periodEnd: "2025-06-28" }),
    ]);

    expect(metric(metrics, "OPERATING_MARGIN", "ANNUAL")).toMatchObject({
      value: null,
      periodEnd: "2025-09-27",
      unavailableReason:
        "REVENUE for the annual period 2024-09-29 through 2025-09-27 is not in the selected facts.",
    });
    expect(metric(metrics, "NET_MARGIN", "ANNUAL")).toMatchObject({
      value: null,
      unavailableReason: expect.stringContaining("2025-06-28 is not in the"),
    });
    expect(metric(metrics, "OPERATING_MARGIN", "QUARTERLY")).toMatchObject({
      value: null,
      unavailableReason:
        "OPERATING_INCOME has no selected quarterly period observation.",
    });
  });

  it("rejects unit mismatches, zero denominators, and non-positive equity explicitly", () => {
    const metrics = buildDerivedMetrics([
      fact("OPERATING_INCOME", 250),
      fact("REVENUE", 1_000, { unit: "EUR" }),
      fact("NET_INCOME", 200),
      fact("LONG_TERM_DEBT", 300),
      fact("STOCKHOLDERS_EQUITY", -50),
      fact("CURRENT_ASSETS", 120),
      fact("CURRENT_LIABILITIES", 0),
      fact("DILUTED_EPS", 5, { unit: "USD/share" }),
      priorYear("DILUTED_EPS", 0, { unit: "USD/share" }),
    ]);

    expect(metric(metrics, "OPERATING_MARGIN", "ANNUAL").unavailableReason).toBe(
      "REVENUE for the annual period 2024-09-29 through 2025-09-27 is reported in EUR, not USD.",
    );
    expect(metric(metrics, "DEBT_TO_EQUITY", "INSTANT").unavailableReason).toBe(
      "STOCKHOLDERS_EQUITY for the reporting date ending 2025-09-27 is negative, so the ratio is not meaningful.",
    );
    expect(metric(metrics, "CURRENT_RATIO", "INSTANT").unavailableReason).toBe(
      "CURRENT_LIABILITIES for the reporting date ending 2025-09-27 is zero, so the ratio cannot be computed.",
    );
    expect(
      metric(metrics, "DILUTED_EPS_GROWTH_YOY", "ANNUAL").unavailableReason,
    ).toBe(
      "DILUTED_EPS for the prior-year annual period 2023-10-01 through 2024-09-28 is zero, so growth cannot be computed.",
    );
    expect(metrics.every((item) => item.value !== 0 || item.value === null)).toBe(
      true,
    );
  });

  it("subtracts reported capital expenditures and refuses an unexpected negative sign", () => {
    const positive = buildDerivedMetrics([
      fact("OPERATING_CASH_FLOW", 200),
      fact("CAPITAL_EXPENDITURES", 50),
      fact("REVENUE", 1_000),
    ]);
    expect(metric(positive, "FREE_CASH_FLOW", "ANNUAL").value).toBe(150);
    expect(metric(positive, "FREE_CASH_FLOW_MARGIN", "ANNUAL").value).toBe(15);

    const negative = buildDerivedMetrics([
      fact("OPERATING_CASH_FLOW", 200),
      fact("CAPITAL_EXPENDITURES", -50),
      fact("REVENUE", 1_000),
    ]);
    expect(metric(negative, "FREE_CASH_FLOW", "ANNUAL")).toMatchObject({
      value: null,
      unavailableReason: expect.stringContaining("negative sign"),
    });
    expect(metric(negative, "FREE_CASH_FLOW_MARGIN", "ANNUAL").value).toBeNull();
  });

  it("requires an unambiguous prior-year comparable of similar length for growth", () => {
    const missingPrior = buildDerivedMetrics([fact("REVENUE", 1_000)]);
    expect(metric(missingPrior, "REVENUE_GROWTH_YOY", "ANNUAL")).toMatchObject({
      value: null,
      periodEnd: "2025-09-27",
      unavailableReason:
        "REVENUE for the prior-year annual period comparable to 2024-09-29 through 2025-09-27 is not in the selected facts.",
    });

    const mismatchedSpan = buildDerivedMetrics([
      fact("REVENUE", 1_000),
      priorYear("REVENUE", 900, { periodStart: "2024-06-30" }),
    ]);
    expect(
      metric(mismatchedSpan, "REVENUE_GROWTH_YOY", "ANNUAL").value,
    ).toBeNull();

    const ambiguousPrior = buildDerivedMetrics([
      fact("REVENUE", 1_000),
      priorYear("REVENUE", 900, { selection: "AMBIGUOUS" }),
      priorYear("REVENUE", 910, {
        selection: "AMBIGUOUS",
        referenceId: "REVENUE:2024-09-28:b",
      }),
    ]);
    expect(
      metric(ambiguousPrior, "REVENUE_GROWTH_YOY", "ANNUAL").unavailableReason,
    ).toBe(
      "REVENUE for the prior-year annual period 2023-10-01 through 2024-09-28 is ambiguous across filings.",
    );

    const ambiguousLatest = buildDerivedMetrics([
      fact("REVENUE", 1_000, { selection: "AMBIGUOUS" }),
      fact("REVENUE", 1_001, {
        selection: "AMBIGUOUS",
        referenceId: "REVENUE:2025-09-27:b",
      }),
      priorYear("REVENUE", 900),
    ]);
    expect(
      metric(ambiguousLatest, "REVENUE_GROWTH_YOY", "ANNUAL").unavailableReason,
    ).toBe(
      "REVENUE for the annual period 2024-09-29 through 2025-09-27 is ambiguous across filings.",
    );

    const negativePrior = buildDerivedMetrics([
      fact("DILUTED_EPS", 1, { unit: "USD/share" }),
      priorYear("DILUTED_EPS", -2, { unit: "USD/share" }),
    ]);
    expect(metric(negativePrior, "DILUTED_EPS_GROWTH_YOY", "ANNUAL").value).toBe(
      150,
    );
  });

  it("names withheld ambiguity as the reason when the caller excluded the metric", () => {
    const metrics = buildDerivedMetrics([fact("OPERATING_INCOME", 250)], {
      ambiguousMetrics: ["REVENUE"],
    });

    expect(metric(metrics, "OPERATING_MARGIN", "ANNUAL").unavailableReason).toBe(
      "REVENUE is withheld because its latest annual period observation is ambiguous across filings.",
    );
    expect(metric(metrics, "REVENUE_GROWTH_YOY", "ANNUAL").unavailableReason).toBe(
      "REVENUE is withheld because its latest annual period observation is ambiguous across filings.",
    );
  });

  it("formats derived values with their unit", () => {
    expect(formatDerivedValue(6.42531, "PERCENT")).toBe("6.4 percent");
    expect(formatDerivedValue(0.66351, "RATIO")).toBe("0.66");
    expect(formatDerivedValue(98_767_000_000, "USD")).toBe("98,767,000,000 USD");
    expect(formatDerivedValue(-31_796_000_000, "USD")).toBe(
      "-31,796,000,000 USD",
    );
  });
});
