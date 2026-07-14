import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAlerts } from "./alerts/route";
import { GET as getHoldings } from "./holdings/route";
import { GET as getPortfolio } from "./portfolio/route";
import {
  GET as getResearch,
  POST as postResearch,
} from "./research/[ticker]/route";

import { getDemoRiskAlerts } from "@/lib/portfolio/alerts-data";
import { getDemoPortfolioAnalytics } from "@/lib/portfolio/analytics";
import type { PortfolioAnalytics } from "@/lib/portfolio/types";
import { getLatestResearch, runResearch } from "@/lib/research/orchestrator";
import type { StockResearch } from "@/lib/research/types";

vi.mock("@/lib/portfolio/alerts-data", () => ({
  getDemoRiskAlerts: vi.fn(),
}));

vi.mock("@/lib/portfolio/analytics", () => ({
  getDemoPortfolioAnalytics: vi.fn(),
}));

vi.mock("@/lib/research/orchestrator", () => ({
  getLatestResearch: vi.fn(),
  runResearch: vi.fn(),
}));

const mockedGetDemoPortfolioAnalytics = vi.mocked(getDemoPortfolioAnalytics);
const mockedGetDemoRiskAlerts = vi.mocked(getDemoRiskAlerts);
const mockedGetLatestResearch = vi.mocked(getLatestResearch);
const mockedRunResearch = vi.mocked(runResearch);

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

const researchResponse: StockResearch = {
  jobId: "research-1",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  status: "COMPLETED",
  generatedAt: "2026-06-30T21:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
  agents: [],
  report: {
    overview: "Deterministic overview.",
    bullCase: [],
    bearCase: [],
    risks: [],
    missingData: [],
    confidence: 0.7,
  },
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

    await getPortfolio(
      new Request("http://localhost/api/portfolio?period=YTD"),
    );

    expect(mockedGetDemoPortfolioAnalytics).toHaveBeenCalledWith("1M");
  });

  it("returns a not found response when portfolio analytics are unavailable", async () => {
    mockedGetDemoPortfolioAnalytics.mockResolvedValue(null);

    const response = await getPortfolio(
      new Request("http://localhost/api/portfolio"),
    );

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

    const response = await getHoldings(
      new Request("http://localhost/api/holdings"),
    );

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

  it("returns the latest deterministic research for a normalized ticker", async () => {
    mockedGetLatestResearch.mockResolvedValue(researchResponse);

    const response = await getResearch(new Request("http://localhost"), {
      params: Promise.resolve({ ticker: "aapl" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(researchResponse);
    expect(mockedGetLatestResearch).toHaveBeenCalledWith("AAPL");
  });

  it("rejects invalid research tickers before querying data", async () => {
    const response = await getResearch(new Request("http://localhost"), {
      params: Promise.resolve({ ticker: "AAPL<script>" }),
    });

    expect(response.status).toBe(400);
    expect(mockedGetLatestResearch).not.toHaveBeenCalled();
  });

  it("persists a deterministic research run", async () => {
    mockedRunResearch.mockResolvedValue(researchResponse);

    const response = await postResearch(new Request("http://localhost"), {
      params: Promise.resolve({ ticker: "aapl" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(researchResponse);
    expect(mockedRunResearch).toHaveBeenCalledWith("AAPL");
  });

  it("returns a stable JSON error when research generation fails", async () => {
    mockedRunResearch.mockRejectedValue(new Error("provider failure"));

    const response = await postResearch(new Request("http://localhost"), {
      params: Promise.resolve({ ticker: "NVDA" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The deterministic research pipeline could not complete.",
    });
  });
});
