import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLatestResearch: vi.fn(),
  getOwnedPortfolioAnalytics: vi.fn(),
  getOwnedResearchJob: vi.fn(),
  getPortfolio: vi.fn(),
  getUserWatchlist: vi.fn(),
  listHoldings: vi.fn(),
  listPortfolios: vi.fn(),
  listResearchJobs: vi.fn(),
  listUserAlerts: vi.fn(),
  requireApiUser: vi.fn(),
  requireMutableUser: vi.fn(),
  runResearch: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...original,
    requireApiUser: mocks.requireApiUser,
    requireMutableUser: mocks.requireMutableUser,
  };
});

vi.mock("@/lib/portfolio/analytics", () => ({
  getOwnedPortfolioAnalytics: mocks.getOwnedPortfolioAnalytics,
}));

vi.mock("@/lib/portfolio/alerts-service", () => ({
  listUserAlerts: mocks.listUserAlerts,
}));

vi.mock("@/lib/portfolio/management", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/portfolio/management")>();
  return {
    ...original,
    getPortfolio: mocks.getPortfolio,
    getUserWatchlist: mocks.getUserWatchlist,
    listHoldings: mocks.listHoldings,
    listPortfolios: mocks.listPortfolios,
  };
});

vi.mock("@/lib/research/orchestrator", () => ({
  getLatestResearch: mocks.getLatestResearch,
  getOwnedResearchJob: mocks.getOwnedResearchJob,
  listResearchJobs: mocks.listResearchJobs,
  runResearch: mocks.runResearch,
}));

import { GET as getAlerts } from "./alerts/route";
import { GET as getHoldings } from "./holdings/route";
import { GET as getPortfolioAnalytics } from "./portfolio/route";
import { GET as getPortfolio } from "./portfolios/[id]/route";
import { GET as getPortfolios } from "./portfolios/route";
import {
  GET as getPublicResearch,
  POST as postResearch,
} from "./research/[ticker]/route";
import { GET as getResearchJob } from "./research/jobs/[id]/route";
import { GET as getResearchJobs } from "./research/jobs/route";
import { GET as getWatchlist } from "./watchlist/route";

import {
  AuthorizationError,
  AuthorizationErrorCode,
} from "@/lib/auth/authorization";
import type { PortfolioAnalytics } from "@/lib/portfolio/types";
import type { StockResearch } from "@/lib/research/types";

const actor = {
  email: "owner@example.com",
  id: "user-a",
  image: null,
  name: "Owner",
  role: "USER" as const,
};

const analyticsResponse: PortfolioAnalytics = {
  allocationByHolding: [],
  allocationBySector: [],
  asOf: "2026-06-30T21:00:00.000Z",
  holdings: [
    {
      allocationPercent: 1,
      averageCost: 400,
      companyName: "NVIDIA Corporation",
      costBasis: 800,
      currentPrice: 500,
      dollarContribution: 50,
      id: "holding-a",
      marketValue: 1000,
      periodEndValue: 1000,
      periodReturn: 0.0526,
      periodStartValue: 950,
      portfolioContributionPercent: 1,
      sector: "Technology",
      shares: 2,
      ticker: "NVDA",
      totalGainLoss: 200,
      totalGainLossPercent: 0.25,
    },
  ],
  performance: [],
  period: "1M",
  portfolio: {
    baseCurrency: "USD",
    id: "portfolio-a",
    name: "Private portfolio",
  },
  summary: {
    costBasis: 900,
    marketValue: 1000,
    periodEndValue: 1000,
    periodGainLoss: 50,
    periodReturn: 0.0526,
    periodStartValue: 950,
    unrealizedGain: 100,
    unrealizedGainPercent: 0.1111,
  },
  topLosers: [],
  topWinners: [],
};

const researchResponse: StockResearch = {
  agents: [],
  companyName: "Apple Inc.",
  expiresAt: "2026-07-30T21:00:00.000Z",
  generatedAt: "2026-06-30T21:00:00.000Z",
  jobId: "job-a",
  report: {
    bearCase: [],
    bullCase: [],
    confidence: 0.7,
    missingData: [],
    overview: "Deterministic overview.",
    risks: [],
  },
  status: "COMPLETED",
  ticker: "AAPL",
};

const portfolioResponse = {
  baseCurrency: "USD",
  holdings: [],
  id: "portfolio-a",
  name: "Private portfolio",
};

const ownedResearchJobResponse = {
  companyName: "Apple Inc.",
  completedAt: "2026-06-30T21:00:00.000Z",
  createdAt: "2026-06-30T20:00:00.000Z",
  id: "job-a",
  research: researchResponse,
  status: "COMPLETED",
  ticker: "AAPL",
};

function idContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function tickerContext(ticker: string) {
  return { params: Promise.resolve({ ticker }) };
}

const privateReadCases = [
  {
    expectedArgs: [actor.id],
    expectedBody: { portfolios: [{ id: "portfolio-a" }] },
    invoke: () => getPortfolios(),
    label: "portfolio list",
    service: mocks.listPortfolios,
  },
  {
    expectedArgs: [actor.id, "portfolio-a"],
    expectedBody: portfolioResponse,
    invoke: () =>
      getPortfolio(
        new Request("http://localhost/api/portfolios/portfolio-a"),
        idContext("portfolio-a"),
      ),
    label: "portfolio detail",
    service: mocks.getPortfolio,
  },
  {
    expectedArgs: [actor.id, "portfolio-a", "1W"],
    expectedBody: analyticsResponse,
    invoke: () =>
      getPortfolioAnalytics(
        new Request(
          "http://localhost/api/portfolio?portfolioId=portfolio-a&period=1W",
        ),
      ),
    label: "portfolio analytics",
    service: mocks.getOwnedPortfolioAnalytics,
  },
  {
    expectedArgs: [actor.id, "portfolio-a"],
    expectedBody: portfolioResponse,
    invoke: () =>
      getHoldings(
        new Request("http://localhost/api/holdings?portfolioId=portfolio-a"),
      ),
    label: "holdings",
    service: mocks.listHoldings,
  },
  {
    expectedArgs: [actor.id],
    expectedBody: { items: [{ id: "watch-a" }] },
    invoke: () => getWatchlist(),
    label: "watchlist",
    service: mocks.getUserWatchlist,
  },
  {
    expectedArgs: [actor.id],
    expectedBody: { alerts: [{ id: "alert-a" }], count: 1 },
    invoke: () => getAlerts(),
    label: "alerts",
    service: mocks.listUserAlerts,
  },
  {
    expectedArgs: [actor.id],
    expectedBody: { jobs: [{ id: "job-a" }] },
    invoke: () => getResearchJobs(),
    label: "research history",
    service: mocks.listResearchJobs,
  },
  {
    expectedArgs: [actor.id, "job-a"],
    expectedBody: ownedResearchJobResponse,
    invoke: () =>
      getResearchJob(
        new Request("http://localhost/api/research/jobs/job-a"),
        idContext("job-a"),
      ),
    label: "research job and report",
    service: mocks.getOwnedResearchJob,
  },
];

describe("private API read contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(actor);
    mocks.requireMutableUser.mockResolvedValue({ id: actor.id, isDemo: false });
    mocks.getOwnedPortfolioAnalytics.mockResolvedValue(analyticsResponse);
    mocks.getOwnedResearchJob.mockResolvedValue(ownedResearchJobResponse);
    mocks.getPortfolio.mockResolvedValue(portfolioResponse);
    mocks.getUserWatchlist.mockResolvedValue([{ id: "watch-a" }]);
    mocks.listHoldings.mockResolvedValue(portfolioResponse);
    mocks.listPortfolios.mockResolvedValue([{ id: "portfolio-a" }]);
    mocks.listResearchJobs.mockResolvedValue([{ id: "job-a" }]);
    mocks.listUserAlerts.mockResolvedValue([{ id: "alert-a" }]);
  });

  it.each(privateReadCases)(
    "returns owner-scoped $label data and forwards the actor ID",
    async ({ expectedArgs, expectedBody, invoke, service }) => {
      const response = await invoke();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expectedBody);
      expect(mocks.requireApiUser).toHaveBeenCalledOnce();
      expect(service).toHaveBeenCalledWith(...expectedArgs);
    },
  );

  it.each(privateReadCases)(
    "returns 401 before calling the $label service for an anonymous request",
    async ({ invoke, service }) => {
      mocks.requireApiUser.mockRejectedValue(
        new AuthorizationError(AuthorizationErrorCode.AUTHENTICATION_REQUIRED),
      );

      const response = await invoke();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Authentication is required.",
      });
      expect(service).not.toHaveBeenCalled();
    },
  );

  it("defaults an invalid private analytics period while preserving owner scope", async () => {
    await getPortfolioAnalytics(
      new Request(
        "http://localhost/api/portfolio?portfolioId=portfolio-a&period=YTD",
      ),
    );

    expect(mocks.getOwnedPortfolioAnalytics).toHaveBeenCalledWith(
      actor.id,
      "portfolio-a",
      "1M",
    );
  });

  it("requires a portfolio identifier only after authenticating", async () => {
    const response = await getHoldings(
      new Request("http://localhost/api/holdings"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "portfolioId is required.",
    });
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.listHoldings).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: "Portfolio was not found.",
      invoke: (id: string) =>
        getPortfolio(
          new Request(`http://localhost/api/portfolios/${id}`),
          idContext(id),
        ),
      label: "portfolio detail",
      service: mocks.getPortfolio,
    },
    {
      error: "Portfolio analytics are unavailable.",
      invoke: (id: string) =>
        getPortfolioAnalytics(
          new Request(
            `http://localhost/api/portfolio?portfolioId=${id}&period=1M`,
          ),
        ),
      label: "portfolio analytics",
      service: mocks.getOwnedPortfolioAnalytics,
    },
    {
      error: "Portfolio was not found.",
      invoke: (id: string) =>
        getHoldings(
          new Request(`http://localhost/api/holdings?portfolioId=${id}`),
        ),
      label: "holdings",
      service: mocks.listHoldings,
    },
    {
      error: "Research job was not found.",
      invoke: (id: string) =>
        getResearchJob(
          new Request(`http://localhost/api/research/jobs/${id}`),
          idContext(id),
        ),
      label: "research job/report",
      service: mocks.getOwnedResearchJob,
    },
  ])(
    "returns an equivalent API 404 for foreign and missing $label records",
    async ({ error, invoke, service }) => {
      service.mockResolvedValue(null);

      const bodies = [];
      for (const resourceId of ["foreign-id", "missing-id"]) {
        const response = await invoke(resourceId);
        expect(response.status).toBe(404);
        bodies.push(await response.json());
      }

      expect(bodies).toEqual([{ error }, { error }]);
      expect(service.mock.calls.map((call) => call.slice(0, 2))).toEqual([
        [actor.id, "foreign-id"],
        [actor.id, "missing-id"],
      ]);
    },
  );
});

describe("public sample and private research route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(actor);
    mocks.requireMutableUser.mockResolvedValue({ id: actor.id, isDemo: false });
  });

  it("preserves anonymous sample research GET access for a normalized ticker", async () => {
    mocks.getLatestResearch.mockResolvedValue(researchResponse);

    const response = await getPublicResearch(
      new Request("http://localhost/api/research/aapl"),
      tickerContext("aapl"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(researchResponse);
    expect(mocks.getLatestResearch).toHaveBeenCalledWith("AAPL");
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid public sample ticker before querying data", async () => {
    const response = await getPublicResearch(
      new Request("http://localhost/api/research/invalid"),
      tickerContext("AAPL<script>"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getLatestResearch).not.toHaveBeenCalled();
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
  });

  it("returns 404 when no public sample report exists", async () => {
    mocks.getLatestResearch.mockResolvedValue(null);

    const response = await getPublicResearch(
      new Request("http://localhost/api/research/MSFT"),
      tickerContext("MSFT"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Research is unavailable for this ticker.",
    });
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
  });

  it("forwards the authenticated actor when starting private research", async () => {
    mocks.runResearch.mockResolvedValue(researchResponse);

    const response = await postResearch(
      new Request("http://localhost/api/research/aapl", { method: "POST" }),
      tickerContext("aapl"),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(researchResponse);
    expect(mocks.runResearch).toHaveBeenCalledWith(actor.id, "AAPL");
  });

  it("returns a stable JSON error when private research generation fails", async () => {
    mocks.runResearch.mockRejectedValue(new Error("provider failure"));

    const response = await postResearch(
      new Request("http://localhost/api/research/NVDA", { method: "POST" }),
      tickerContext("NVDA"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The deterministic research pipeline could not complete.",
    });
  });
});
