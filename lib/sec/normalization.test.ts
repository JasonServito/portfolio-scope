import { describe, expect, it } from "vitest";

import companyFactsFixture from "@/tests/fixtures/sec/aapl-companyfacts.json";
import submissionsFixture from "@/tests/fixtures/sec/aapl-submissions.json";
import {
  SEC_NORMALIZATION_VERSION,
  classifyPeriod,
  normalizeCompanyFacts,
  parseRecentFilings,
} from "@/lib/sec/normalization";
import { secCompanyFactsSchema, secSubmissionsSchema } from "@/lib/sec/schemas";

const observedAt = new Date("2026-07-15T18:00:00.000Z");

describe("SEC filing and fact normalization", () => {
  it("validates clipped recorded fixtures and parses source-backed filings", () => {
    const submissions = secSubmissionsSchema.parse(submissionsFixture);
    const filings = parseRecentFilings(submissions, "320193");

    expect(filings).toHaveLength(2);
    expect(filings[0]).toMatchObject({
      accessionNumber: "0000320193-25-000079",
      formType: "10-K",
      isAmendment: false,
    });
    expect(filings[0].sourceUrl).toContain("0000320193-25-000079-index.html");
  });

  it("keeps the 10-K and 10-Q filter unchanged unless current reports are requested", () => {
    const submissions = secSubmissionsSchema.parse(submissionsFixture);
    const filings = parseRecentFilings(submissions, "320193");

    expect(filings.map((filing) => filing.formType)).toEqual(["10-K", "10-Q"]);
    expect(filings.every((filing) => filing.itemCodes.length === 0)).toBe(true);
    expect(
      parseRecentFilings(submissions, "320193", {
        currentReportsFiledOnOrAfter: null,
      }),
    ).toEqual(filings);
  });

  it("retains twelve months of Form 8-K filings with their item codes when requested", () => {
    const submissions = secSubmissionsSchema.parse(submissionsFixture);
    const filings = parseRecentFilings(submissions, "320193", {
      currentReportsFiledOnOrAfter: new Date("2025-07-15T00:00:00.000Z"),
    });

    expect(
      filings.map((filing) => [filing.formType, filing.accessionNumber]),
    ).toEqual([
      ["10-K", "0000320193-25-000079"],
      ["10-Q", "0000320193-25-000057"],
      ["8-K", "0000320193-25-000077"],
      ["8-K", "0000320193-25-000073"],
    ]);
    const results = filings.find(
      (filing) => filing.accessionNumber === "0000320193-25-000073",
    );
    expect(results).toMatchObject({
      formType: "8-K",
      itemCodes: ["2.02", "9.01"],
      filingDate: new Date("2025-07-31T00:00:00.000Z"),
      reportDate: new Date("2025-07-31T00:00:00.000Z"),
      isAmendment: false,
      primaryDocument: "aapl-20250731.htm",
    });
    expect(results?.sourceUrl).toContain("0000320193-25-000073-index.html");
    // The 10-K and 10-Q rows are identical with or without the window.
    expect(filings.filter((filing) => filing.formType !== "8-K")).toEqual(
      parseRecentFilings(submissions, "320193"),
    );
  });

  it("classifies instant, quarterly, year-to-date, and annual periods explicitly", () => {
    expect(
      classifyPeriod({
        periodType: "INSTANT",
        start: null,
        end: new Date("2025-09-27T00:00:00.000Z"),
        formType: "10-K",
        fiscalPeriod: "FY",
      }),
    ).toBe("INSTANT");
    expect(
      classifyPeriod({
        periodType: "DURATION",
        start: new Date("2025-03-30T00:00:00.000Z"),
        end: new Date("2025-06-28T00:00:00.000Z"),
        formType: "10-Q",
        fiscalPeriod: "Q3",
      }),
    ).toBe("QUARTERLY");
    expect(
      classifyPeriod({
        periodType: "DURATION",
        start: new Date("2024-09-29T00:00:00.000Z"),
        end: new Date("2025-06-28T00:00:00.000Z"),
        formType: "10-Q",
        fiscalPeriod: "Q3",
      }),
    ).toBe("YEAR_TO_DATE");
    expect(
      classifyPeriod({
        periodType: "DURATION",
        start: new Date("2024-09-29T00:00:00.000Z"),
        end: new Date("2025-09-27T00:00:00.000Z"),
        formType: "10-K",
        fiscalPeriod: "FY",
      }),
    ).toBe("ANNUAL");
  });

  it("maps known concepts, preserves original units, and ignores unknown concepts canonically", () => {
    const facts = normalizeCompanyFacts(
      secCompanyFactsSchema.parse(companyFactsFixture),
      { cik: "320193", observedAt },
    );

    expect(facts.map(({ canonicalMetric }) => canonicalMetric)).toEqual(
      expect.arrayContaining([
        "REVENUE",
        "NET_INCOME",
        "ASSETS",
        "DILUTED_EPS",
      ]),
    );
    expect(
      facts.some(({ concept }) => concept === "UnknownFutureConcept"),
    ).toBe(false);
    expect(
      facts.find(({ canonicalMetric }) => canonicalMetric === "DILUTED_EPS"),
    ).toMatchObject({
      originalUnit: "USD/shares",
      normalizedUnit: "USD/share",
      normalizationVersion: SEC_NORMALIZATION_VERSION,
      isDerived: false,
    });
  });

  it("prefers the latest amendment and records which filing it amends", () => {
    const submissions = structuredClone(submissionsFixture);
    submissions.filings.recent.accessionNumber.unshift("0000320193-25-000080");
    submissions.filings.recent.filingDate.unshift("2025-11-03");
    submissions.filings.recent.reportDate.unshift("2025-09-27");
    submissions.filings.recent.acceptanceDateTime.unshift("20251103090000");
    submissions.filings.recent.form.unshift("10-K/A");
    submissions.filings.recent.primaryDocument.unshift(
      "aapl-20250927x10ka.htm",
    );
    submissions.filings.recent.primaryDocDescription.unshift("10-K/A");

    const filings = parseRecentFilings(
      secSubmissionsSchema.parse(submissions),
      "320193",
    );
    expect(filings[0]).toMatchObject({
      isAmendment: true,
      amendsAccessionNumber: "0000320193-25-000079",
    });

    const companyFacts = structuredClone(companyFactsFixture);
    const annualRevenue =
      companyFacts.facts["us-gaap"]
        .RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[0];
    companyFacts.facts[
      "us-gaap"
    ].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.unshift({
      ...annualRevenue,
      accn: "0000320193-25-000080",
      form: "10-K/A",
      filed: annualRevenue.filed,
      val: 416162000000,
    });
    const facts = normalizeCompanyFacts(
      secCompanyFactsSchema.parse(companyFacts),
      { cik: "320193", observedAt },
    );
    const annualFacts = facts.filter(
      (fact) =>
        fact.canonicalMetric === "REVENUE" && fact.periodKind === "ANNUAL",
    );
    expect(
      annualFacts.find(({ selection }) => selection === "SELECTED"),
    ).toMatchObject({
      accessionNumber: "0000320193-25-000080",
      formType: "10-K/A",
    });
  });

  it("marks competing latest values ambiguous instead of selecting one", () => {
    const companyFacts = structuredClone(companyFactsFixture);
    const annualRevenue =
      companyFacts.facts["us-gaap"]
        .RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[0];
    companyFacts.facts[
      "us-gaap"
    ].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({
      ...annualRevenue,
      accn: "0000320193-25-999999",
      val: annualRevenue.val + 1,
    });

    const facts = normalizeCompanyFacts(
      secCompanyFactsSchema.parse(companyFacts),
      { cik: "320193", observedAt },
    ).filter(
      (fact) =>
        fact.canonicalMetric === "REVENUE" && fact.periodKind === "ANNUAL",
    );

    expect(
      facts.filter(({ selection }) => selection === "SELECTED"),
    ).toHaveLength(0);
    expect(
      facts.filter(({ selection }) => selection === "AMBIGUOUS"),
    ).toHaveLength(2);
  });

  it("selects one preferred concept when comparable durations have different start dates", () => {
    const companyFacts = structuredClone(companyFactsFixture);
    const preferred =
      companyFacts.facts["us-gaap"]
        .RevenueFromContractWithCustomerExcludingAssessedTax;
    const competingObservation = {
      ...preferred.units.USD[0],
      start: "2024-10-01",
    };
    Object.assign(companyFacts.facts["us-gaap"], {
      Revenues: {
        label: "Revenue",
        description: "A lower-priority compatible revenue concept.",
        units: { USD: [competingObservation] },
      },
    });

    const annualRevenueFacts = normalizeCompanyFacts(
      secCompanyFactsSchema.parse(companyFacts),
      { cik: "320193", observedAt },
    ).filter(
      (fact) =>
        fact.canonicalMetric === "REVENUE" && fact.periodKind === "ANNUAL",
    );

    expect(
      annualRevenueFacts.filter(({ selection }) => selection === "SELECTED"),
    ).toHaveLength(1);
    expect(
      annualRevenueFacts.find(({ selection }) => selection === "SELECTED"),
    ).toMatchObject({
      concept: "RevenueFromContractWithCustomerExcludingAssessedTax",
    });
  });
});
