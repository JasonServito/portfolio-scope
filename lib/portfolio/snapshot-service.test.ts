import { describe, expect, it } from "vitest";

import { calculatePortfolioSnapshot } from "@/lib/portfolio/snapshot-service";

const earlier = new Date("2026-06-25T21:00:00.000Z");
const latest = new Date("2026-06-26T21:00:00.000Z");

describe("portfolio snapshot calculation", () => {
  it("reconciles holding values to the portfolio totals", () => {
    const result = calculatePortfolioSnapshot([
      {
        id: "holding-a",
        shares: 2,
        costBasis: 180,
        latestPrice: { close: 100, timestamp: latest },
      },
      {
        id: "holding-b",
        shares: 1,
        costBasis: 120,
        latestPrice: { close: 150, timestamp: earlier },
      },
    ]);

    expect(result).toMatchObject({
      available: true,
      totalValue: 350,
      totalCostBasis: 300,
      totalGainLoss: 50,
    });
    if (!result.available) throw new Error("Expected a calculated snapshot.");
    expect(
      result.holdingSnapshots.reduce(
        (total, holding) => total + holding.marketValue,
        0,
      ),
    ).toBe(result.totalValue);
  });

  it("stores gains as fractions like the seeded and rebuilt history", () => {
    const result = calculatePortfolioSnapshot([
      {
        id: "holding-a",
        shares: 2,
        costBasis: 180,
        latestPrice: { close: 100, timestamp: latest },
      },
      {
        id: "holding-b",
        shares: 1,
        costBasis: 120,
        latestPrice: { close: 150, timestamp: latest },
      },
    ]);

    if (!result.available) throw new Error("Expected a calculated snapshot.");
    expect(result.totalGainLossPercent).toBeCloseTo(50 / 300);
    expect(result.holdingSnapshots[1].gainLossPercent).toBeCloseTo(30 / 120);
  });

  it("dates the snapshot by its newest price, not by when it ran", () => {
    const result = calculatePortfolioSnapshot([
      {
        id: "holding-a",
        shares: 1,
        costBasis: 90,
        latestPrice: { close: 100, timestamp: earlier },
      },
      {
        id: "holding-b",
        shares: 1,
        costBasis: 90,
        latestPrice: { close: 100, timestamp: latest },
      },
    ]);

    if (!result.available) throw new Error("Expected a calculated snapshot.");
    expect(result.observedAt).toEqual(latest);
  });

  it("refuses to turn missing prices into zero-valued holdings", () => {
    expect(
      calculatePortfolioSnapshot([
        { id: "holding-a", shares: 2, costBasis: 180, latestPrice: null },
      ]),
    ).toEqual({ available: false, missingPriceHoldingIds: ["holding-a"] });
  });
});
