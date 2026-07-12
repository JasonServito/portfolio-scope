import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAlerts } from "./alerts/route";
import { GET as getHoldings } from "./holdings/route";
import { GET as getPortfolio } from "./portfolio/route";
import { GET as getResearch } from "./research/[ticker]/route";

import { getDemoRiskAlerts } from "@/lib/portfolio/alerts-data";
import { getDemoPortfolioAnalytics } from "@/lib/portfolio/analytics";
import type { PortfolioAnalytics } from "@/lib/portfolio/types";

vi.mock("@/lib/portfolio/alerts-data", () => ({
  getDemoRiskAlerts: vi.fn(),
}));

vi.mock("@/lib/portfolio/analytics", () => ({
  getDemoPortfolioAnalytics: vi.fn(),
}));

const mockedGetDemoPortfolioAnalytics = vi.mocked(getDemoPortfolioAnalytics);
const mockedGetDemoRiskAlerts = vi.mocked(getDemoRiskAlerts);

const analyticsResponse: PortfolioAnalytics = {
  portfolio: {
    id: "portfolio-1",
    name: "Demo Growth Portfolio",
    baseCurrency: "USD",
  },
  period: "1M",
  asOf: "2026-06-30T21:00:00.000Z",
  summary: {
    marketValue: 1000,
    costBasis: 900,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.1111,
    periodStartValue: 950,
    periodEndValue: 1000,
    periodReturn: 0.0526,
    periodGainLoss: 50,
  },
  holdings: [
    {
      id: "holding-1",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      sector: "Technology",
      shares: 2,
      averageCost: 400,
      costBasis: 800,
      currentPrice: 500,
      marketValue: 1000,
      allocationPercent: 1,
      periodStartValue: 950,
      periodEndValue: 1000,
      periodReturn: 0.0526,
      dollarContribution: 50,
      portfolioContributionPercent: 1,
      totalGainLoss: 200,
      totalGainLossPercent: 0.25,
    },
  ],
  allocationByHolding: [],
  allocationBySector: [],
  performance: [],
  topWinners: [],
  topLosers: [],
};

describe("API route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns portfolio analytics for valid periods", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(analyticsResponse);

    const response = await getPortfolio(
      new Request("http://localhost/api/portfolio?period=1W"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(analyticsResponse);
    expect(mockedGetDemoPortfolioAnalytics).toHaveBeenCalledWith("1W");
  });

  it("defaults invalid portfolio periods to 1M", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(analyticsResponse);

    await getPortfolio(new Request("http://localhost/api/portfolio?period=YTD"));

    expect(mockedGetDemoPortfolioAnalytics).toHaveBeenCalledWith("1M");
  });

  it("returns a not found response when portfolio analytics are unavailable", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(null);

    const response = await getPortfolio(new Request("http://localhost/api/portfolio"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Demo portfolio analytics are unavailable.",
    });
  });

  it("returns the holdings route shape for a selected period", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(analyticsResponse);

    const response = await getHoldings(
      new Request("http://localhost/api/holdings?period=3M"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      portfolio: analyticsResponse.portfolio,
      period: analyticsResponse.period,
      asOf: analyticsResponse.asOf,
      holdings: analyticsResponse.holdings,
    });
    expect(mockedGetDemoPortfolioAnalytics).toHaveBeenCalledWith("3M");
  });

  it("returns a not found response when holdings analytics are unavailable", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(null);

    const response = await getHoldings(new Request("http://localhost/api/holdings"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Demo holdings analytics are unavailable.",
    });
  });

  it("returns alerts with a count", async () => {
    mockedGetDemoRiskAlerts.mockResolvedValue([
      {
        id: "CONCENTRATION:NVDA",
        ticker: "NVDA",
        companyName: "NVIDIA Corporation",
        type: "CONCENTRATION",
        severity: "HIGH",
        title: "NVDA allocation is above the risk band",
        message: "NVIDIA Corporation represents 28.0% of the demo portfolio.",
        status: "ACTIVE",
        createdAt: "2026-06-30T21:00:00.000Z",
        metricLabel: "Portfolio weight",
        metricValue: 0.28,
        href: "/stocks/nvda",
      },
    ]);

    const response = await getAlerts();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      alerts: [{ id: "CONCENTRATION:NVDA", severity: "HIGH" }],
    });
  });

  it("normalizes research route tickers without running external services", async () => {
    const response = await getResearch(new Request("http://localhost"), {
      params: Promise.resolve({ ticker: "aapl" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "placeholder",
      resource: "research",
      ticker: "AAPL",
    });
  });
});
