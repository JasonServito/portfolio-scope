import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SecFundamentals } from "@/components/stocks/sec-fundamentals";
import type { FundamentalsSnapshot } from "@/lib/sec/fundamentals-provider";

const base: FundamentalsSnapshot = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  provider: "SEC_EDGAR",
  freshness: "CURRENT",
  retrievedAt: "2026-07-15T00:00:00.000Z",
  facts: [],
  missingMetrics: ["REVENUE"],
  ambiguousMetrics: [],
  lastErrorCode: null,
};

describe("SEC fundamentals presentation", () => {
  it("renders missing data without substituting zero", () => {
    const markup = renderToStaticMarkup(<SecFundamentals data={base} />);

    expect(markup).toContain("SEC facts have not been ingested yet");
    expect(markup).toContain("does not replace them with zero");
  });

  it("shows filing period, source, accession, and failed-refresh context", () => {
    const markup = renderToStaticMarkup(
      <SecFundamentals
        data={{
          ...base,
          freshness: "FAILED",
          facts: [
            {
              metric: "REVENUE",
              label: "Revenue",
              value: 416_161_000_000,
              unit: "USD",
              originalValue: "416161000000",
              originalUnit: "USD",
              taxonomy: "us-gaap",
              concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
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
            },
          ],
          missingMetrics: [],
        }}
      />,
    );

    expect(markup).toContain("Latest annual period");
    expect(markup).toContain("SEC reported");
    expect(markup).toContain("SEC filing");
    expect(markup).toContain("0000320193-25-000079");
    expect(markup).toContain("latest refresh failed");
  });
});
