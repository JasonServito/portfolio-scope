import { describe, expect, it } from "vitest";

import {
  calculateAllocationItems,
  calculateAllocationPercent,
  calculateContributionPercent,
  calculateGainLoss,
  calculatePercentChange,
  calculatePortfolioSummary,
  rankWinnersAndLosers,
} from "./calculations";

describe("portfolio calculations", () => {
  it("calculates market value, cost basis, and unrealized gain", () => {
    const summary = calculatePortfolioSummary([
      {
        ticker: "AAPL",
        shares: 10,
        averageCost: 100,
        currentPrice: 125,
      },
      {
        ticker: "MSFT",
        shares: 5,
        averageCost: 200,
        currentPrice: 180,
      },
    ]);

    expect(summary).toEqual({
      marketValue: 2150,
      costBasis: 2000,
      unrealizedGain: 150,
      unrealizedGainPercent: 0.075,
    });
  });

  it("handles gain, loss, and zero-denominator percentages", () => {
    expect(calculateGainLoss(1250, 1000)).toBe(250);
    expect(calculatePercentChange(1000, 1250)).toBe(0.25);
    expect(calculatePercentChange(0, 1250)).toBe(0);
    expect(calculateAllocationPercent(250, 1000)).toBe(0.25);
    expect(calculateAllocationPercent(250, 0)).toBe(0);
    expect(calculateContributionPercent(125, 500)).toBe(0.25);
    expect(calculateContributionPercent(-50, -200)).toBe(0.25);
    expect(calculateContributionPercent(125, 0)).toBe(0);
  });

  it("groups allocation values and sorts largest first", () => {
    const allocation = calculateAllocationItems(
      [
        { sector: "Technology", value: 600 },
        { sector: "Consumer Defensive", value: 200 },
        { sector: "Technology", value: 200 },
      ],
      (item) => item.sector,
      (item) => item.sector,
      (item) => item.value,
    );

    expect(allocation).toEqual([
      {
        key: "Technology",
        label: "Technology",
        value: 800,
        percentage: 0.8,
      },
      {
        key: "Consumer Defensive",
        label: "Consumer Defensive",
        value: 200,
        percentage: 0.2,
      },
    ]);
  });

  it("ranks winners and losers by dollar contribution", () => {
    const ranked = rankWinnersAndLosers(
      [
        {
          id: "a",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          marketValue: 1000,
          periodReturn: 0.08,
          dollarContribution: 80,
          portfolioContributionPercent: 0.08,
        },
        {
          id: "n",
          ticker: "NVDA",
          companyName: "NVIDIA Corporation",
          marketValue: 1000,
          periodReturn: 0.14,
          dollarContribution: 140,
          portfolioContributionPercent: 0.14,
        },
        {
          id: "t",
          ticker: "TSLA",
          companyName: "Tesla, Inc.",
          marketValue: 1000,
          periodReturn: -0.09,
          dollarContribution: -90,
          portfolioContributionPercent: -0.09,
        },
      ],
      2,
    );

    expect(ranked.winners.map((holding) => holding.ticker)).toEqual([
      "NVDA",
      "AAPL",
    ]);
    expect(ranked.losers.map((holding) => holding.ticker)).toEqual([
      "TSLA",
      "AAPL",
    ]);
  });
});
