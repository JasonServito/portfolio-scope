import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SecFundamentals } from "@/components/stocks/sec-fundamentals";
import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";

function fact(
  metric: string,
  value: number,
  periodEnd: string,
  options: Partial<CanonicalFundamentalFact> = {},
): CanonicalFundamentalFact {
  return {
    metric,
    label: metric === "DILUTED_EPS" ? "Diluted EPS" : metric,
    value,
    unit: metric === "DILUTED_EPS" ? "USD/share" : "USD",
    originalValue: String(value),
    originalUnit: metric === "DILUTED_EPS" ? "USD/shares" : "USD",
    taxonomy: "us-gaap",
    concept: metric,
    periodStart: "2025-01-01T00:00:00.000Z",
    periodEnd,
    periodKind: "QUARTERLY",
    fiscalYear: 2025,
    fiscalPeriod: "Q1",
    formType: "10-Q",
    filedAt: periodEnd,
    accessionNumber: "0000320193-25-000079",
    sourceUrl: "https://www.sec.gov/Archives/example",
    observedAt: "2026-07-15T00:00:00.000Z",
    normalizationVersion: "sec-xbrl-v1",
    isDerived: false,
    selection: "SELECTED",
    ...options,
  };
}

const base: FundamentalsSnapshot = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  provider: "SEC_EDGAR",
  freshness: "CURRENT",
  retrievedAt: "2026-07-15T00:00:00.000Z",
  facts: [],
  trendPeriods: [],
  trendFacts: [],
  missingMetrics: ["REVENUE"],
  ambiguousMetrics: [],
  lastErrorCode: null,
};

describe("key metrics presentation", () => {
  it("renders ten explained headline metrics and honest missing states", () => {
    const markup = renderToStaticMarkup(<SecFundamentals data={base} />);

    expect(markup).toContain("Key Metrics");
    expect(markup.match(/data-headline-metric=/g)).toHaveLength(10);
    expect(markup.match(/What this means/g)).toHaveLength(10);
    expect(markup).toContain("Financial metrics have not been loaded yet");
    expect(markup).toContain("does not replace them with zero");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("A current programmatic quote");
    expect(markup).toContain("Financial Trends");
    expect(markup.match(/data-financial-trend=/g)).toHaveLength(3);
    expect(markup).toContain("Quarterly values are unavailable");
  });

  it("keeps filing lineage in secondary details with period and refresh context", () => {
    const markup = renderToStaticMarkup(
      <SecFundamentals
        data={{
          ...base,
          freshness: "FAILED",
          facts: [
            fact("REVENUE", 416_161_000_000, "2025-09-27T00:00:00.000Z", {
              label: "Revenue",
              concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
              periodStart: "2024-09-29T00:00:00.000Z",
              periodKind: "ANNUAL",
              fiscalPeriod: "FY",
              formType: "10-K",
              filedAt: "2025-10-31T00:00:00.000Z",
            }),
          ],
          trendPeriods: [
            "2025-03-29T00:00:00.000Z",
            "2025-06-28T00:00:00.000Z",
          ],
          trendFacts: [
            fact("REVENUE", 100_000_000_000, "2025-03-29T00:00:00.000Z"),
            fact("REVENUE", 120_000_000_000, "2025-06-28T00:00:00.000Z"),
            fact("DILUTED_EPS", 1.5, "2025-03-29T00:00:00.000Z"),
            fact("DILUTED_EPS", 1.75, "2025-06-28T00:00:00.000Z"),
            fact(
              "OPERATING_CASH_FLOW",
              30_000_000_000,
              "2025-03-29T00:00:00.000Z",
            ),
            fact(
              "OPERATING_CASH_FLOW",
              35_000_000_000,
              "2025-06-28T00:00:00.000Z",
            ),
            fact(
              "CAPITAL_EXPENDITURES",
              5_000_000_000,
              "2025-03-29T00:00:00.000Z",
            ),
            fact(
              "CAPITAL_EXPENDITURES",
              6_000_000_000,
              "2025-06-28T00:00:00.000Z",
            ),
          ],
          missingMetrics: [],
        }}
      />,
    );

    expect(markup).toContain("$416.16B");
    expect(markup).toContain("Full year");
    expect(markup).toContain("Sep 27, 2025");
    expect(markup).toContain("9/27/2025");
    expect(markup).not.toContain("Sep 26, 2025");
    expect(markup).not.toContain("9/26/2025");
    expect(markup).toContain("View financial data sources and filing details");
    expect(markup).toContain("10-K filing");
    expect(markup).toContain("0000320193-25-000079");
    expect(markup).toContain("latest refresh failed");
    expect(markup).toContain("Quarterly Revenue increased from $100B to $120B");
    expect(markup).toContain("Text alternative for quarterly free cash flow");
    expect(markup.match(/View quarterly values/g)).toHaveLength(3);
    expect(markup).not.toContain("SEC-derived fundamentals");
  });
});
