import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  portfolioFindFirst: vi.fn(),
  watchlistFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    portfolio: { findFirst: mocks.portfolioFindFirst },
    watchlistItem: { findMany: mocks.watchlistFindMany },
  },
}));

import { getDemoPortfolioAnalyticsByPeriods } from "@/lib/portfolio/analytics";
import { getDemoRiskAlertsWithAnalytics } from "@/lib/portfolio/alerts-data";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const decimal = (value: number) => new Prisma.Decimal(value);

describe("portfolio analytics query reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.watchlistFindMany.mockResolvedValue([]);
    mocks.portfolioFindFirst.mockResolvedValue({
      id: "portfolio-a",
      name: "North Star Portfolio",
      baseCurrency: "USD",
      holdings: [
        {
          id: "holding-a",
          shares: decimal(2),
          averageCost: decimal(100),
          costBasis: decimal(200),
          stock: {
            ticker: "AAPL",
            companyName: "Apple Inc.",
            sector: "Technology",
          },
          snapshots: [
            {
              timestamp: date("2026-07-01"),
              price: decimal(100),
              marketValue: decimal(200),
            },
            {
              timestamp: date("2026-08-01"),
              price: decimal(120),
              marketValue: decimal(240),
            },
          ],
        },
      ],
      snapshots: [
        {
          timestamp: date("2026-07-01"),
          totalValue: decimal(200),
          totalCostBasis: decimal(200),
          totalGainLoss: decimal(0),
          totalGainLossPercent: decimal(0),
        },
        {
          timestamp: date("2026-08-01"),
          totalValue: decimal(240),
          totalCostBasis: decimal(200),
          totalGainLoss: decimal(40),
          totalGainLossPercent: decimal(0.2),
        },
      ],
    });
  });

  it("builds multiple periods from one portfolio load", async () => {
    const analytics = await getDemoPortfolioAnalyticsByPeriods(["1D", "1M"]);

    expect(mocks.portfolioFindFirst).toHaveBeenCalledOnce();
    expect(analytics.map((item) => item?.period)).toEqual(["1D", "1M"]);
    expect(analytics[0]?.summary.periodEndValue).toBe(240);
    expect(analytics[1]?.summary.periodReturn).toBe(0.2);
    expect(analytics[1]?.holdings[0]?.periodReturn).toBe(0.2);
  });

  it("preserves missing data for every requested period", async () => {
    mocks.portfolioFindFirst.mockResolvedValue(null);

    await expect(
      getDemoPortfolioAnalyticsByPeriods(["1D", "1W", "1M"]),
    ).resolves.toEqual([null, null, null]);
    expect(mocks.portfolioFindFirst).toHaveBeenCalledOnce();
  });

  it("reuses the same analytics load for stock and alert derivation", async () => {
    const analyticsPromise = getDemoPortfolioAnalyticsByPeriods(["1M", "1D"]);
    const [analytics, alerts] = await Promise.all([
      analyticsPromise,
      getDemoRiskAlertsWithAnalytics(analyticsPromise),
    ]);

    expect(analytics).toHaveLength(2);
    expect(alerts).toEqual(expect.any(Array));
    expect(mocks.portfolioFindFirst).toHaveBeenCalledOnce();
    expect(mocks.watchlistFindMany).toHaveBeenCalledOnce();
  });
});
