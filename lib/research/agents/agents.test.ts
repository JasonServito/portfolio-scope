import { describe, expect, it } from "vitest";

import { runCompetitorsAgent } from "./competitors-agent";
import { runFinancialsAgent } from "./financials-agent";
import { runNewsAgent } from "./news-agent";
import { runPoliticalActivityAgent } from "./political-activity-agent";
import { runRiskAgent } from "./risk-agent";
import type { ResearchProviderData } from "../providers/provider";

const providerData: ResearchProviderData = {
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  news: [
    {
      headline: "Seeded demand scenario",
      context: "Demand is strong while valuation sensitivity remains elevated.",
      tone: "mixed",
    },
  ],
  financials: {
    growthProfile: "Seeded above-market growth profile",
    marginProfile: "Strong but investment-sensitive margins",
    balanceSheetProfile: "Seeded balance sheet capacity is resilient",
  },
  competitors: [
    {
      ticker: "AMD",
      companyName: "Advanced Micro Devices, Inc.",
      industry: "Semiconductors",
    },
  ],
  politicalActivity: {
    summary: "No verified political activity is included.",
    disclosed: false,
  },
  risk: {
    oneMonthReturn: 0.12,
    maxDailyMove: 0.05,
    portfolioWeight: 0.24,
    activeAlerts: ["Semiconductor exposure is elevated"],
  },
};

describe("deterministic research agents", () => {
  it("returns structured, sourced outputs for available provider data", () => {
    const results = [
      runNewsAgent(providerData),
      runFinancialsAgent(providerData),
      runCompetitorsAgent(providerData),
      runRiskAgent(providerData),
    ];

    for (const result of results) {
      expect(result.status).toBe("COMPLETED");
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("makes missing political activity explicit instead of inferring facts", () => {
    const result = runPoliticalActivityAgent(providerData);

    expect(result.findings).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.warnings[0]).toContain("not evidence");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("surfaces deterministic volatility and concentration thresholds", () => {
    const result = runRiskAgent(providerData);

    expect(result.rating).toBe("MIXED");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("daily move"),
        expect.stringContaining("20%"),
        "Semiconductor exposure is elevated",
      ]),
    );
  });

  it("does not emit buy, sell, or hold recommendations", () => {
    const outputs = [
      runNewsAgent(providerData),
      runFinancialsAgent(providerData),
      runCompetitorsAgent(providerData),
      runPoliticalActivityAgent(providerData),
      runRiskAgent(providerData),
    ];

    expect(JSON.stringify(outputs).toLowerCase()).not.toMatch(
      /\b(buy|sell|hold)\b/,
    );
  });
});
