import { describe, expect, it } from "vitest";

import { generateRiskAlerts, type RiskAlertInput } from "./risk-alerts";

const baseHolding = {
  id: "h1",
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  shares: 10,
  averageCost: 100,
  costBasis: 1000,
  currentPrice: 140,
  marketValue: 1400,
  allocationPercent: 0.12,
  periodStartValue: 1300,
  periodEndValue: 1400,
  periodReturn: 0.02,
  dollarContribution: 100,
  portfolioContributionPercent: 0.1,
  totalGainLoss: 400,
  totalGainLossPercent: 0.4,
};

function createInput(overrides: Partial<RiskAlertInput> = {}): RiskAlertInput {
  return {
    asOf: "2026-06-26T21:00:00.000Z",
    holdings: [baseHolding],
    oneDayHoldings: [baseHolding],
    oneMonthHoldings: [baseHolding],
    watchlistItems: [],
    ...overrides,
  };
}

describe("risk alert rules", () => {
  it("creates a high concentration alert when a holding exceeds 25%", () => {
    const alerts = generateRiskAlerts(
      createInput({
        holdings: [{ ...baseHolding, allocationPercent: 0.28 }],
      }),
    );

    expect(alerts).toMatchObject([
      {
        ticker: "NVDA",
        type: "CONCENTRATION",
        severity: "HIGH",
        metricValue: 0.28,
      },
    ]);
  });

  it("creates drawdown and price movement alerts from period returns", () => {
    const alerts = generateRiskAlerts(
      createInput({
        oneDayHoldings: [{ ...baseHolding, periodReturn: -0.045 }],
        oneMonthHoldings: [{ ...baseHolding, periodReturn: -0.09 }],
      }),
    );

    expect(alerts.map((alert) => alert.type)).toEqual([
      "DRAWDOWN",
      "PRICE_MOVE",
    ]);
    expect(alerts.map((alert) => alert.severity)).toEqual(["HIGH", "HIGH"]);
  });

  it("creates watchlist alerts near target prices and for volatility", () => {
    const alerts = generateRiskAlerts(
      createInput({
        holdings: [],
        oneDayHoldings: [],
        oneMonthHoldings: [],
        watchlistItems: [
          {
            ticker: "AMD",
            companyName: "Advanced Micro Devices, Inc.",
            latestPrice: 134,
            targetPrice: 138,
            oneWeekReturn: 0.02,
            maxDailyMove: 0.052,
          },
        ],
      }),
    );

    expect(alerts.map((alert) => alert.type).sort()).toEqual([
      "VOLATILITY",
      "WATCHLIST_MOVE",
    ]);
    expect(alerts.find((alert) => alert.type === "VOLATILITY")?.severity).toBe(
      "HIGH",
    );
  });
});
