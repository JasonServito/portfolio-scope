import { describe, expect, it } from "vitest";

import { calculatePortfolioSnapshot } from "@/lib/portfolio/snapshot-service";

describe("portfolio snapshot calculation", () => {
  it("reconciles holding values to the portfolio totals", () => {
    const result = calculatePortfolioSnapshot([
      { id: "holding-a", shares: 2, costBasis: 180, latestPrice: 100 },
      { id: "holding-b", shares: 1, costBasis: 120, latestPrice: 150 },
    ]);

    expect(result).toMatchObject({
      available: true,
      totalValue: 350,
      totalCostBasis: 300,
      totalGainLoss: 50,
    });
    if (!result.available) throw new Error("Expected a calculated snapshot.");
    expect(result.totalGainLossPercent).toBeCloseTo(50 / 3);
    expect(
      result.holdingSnapshots.reduce(
        (total, holding) => total + holding.marketValue,
        0,
      ),
    ).toBe(result.totalValue);
  });

  it("refuses to turn missing prices into zero-valued holdings", () => {
    expect(
      calculatePortfolioSnapshot([
        { id: "holding-a", shares: 2, costBasis: 180, latestPrice: null },
      ]),
    ).toEqual({ available: false, missingPriceHoldingIds: ["holding-a"] });
  });
});
