import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHolding: vi.fn(),
  createPortfolio: vi.fn(),
  createWatchlistItem: vi.fn(),
  deleteHolding: vi.fn(),
  deletePortfolio: vi.fn(),
  deleteWatchlistItem: vi.fn(),
  getLatestResearch: vi.fn(),
  requireApiUser: vi.fn(),
  requireMutableUser: vi.fn(),
  runResearch: vi.fn(),
  updateAlertStatus: vi.fn(),
  updateHolding: vi.fn(),
  updatePortfolio: vi.fn(),
  updateWatchlistItem: vi.fn(),
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

vi.mock("@/lib/portfolio/management", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/portfolio/management")>();
  return {
    ...original,
    createHolding: mocks.createHolding,
    createPortfolio: mocks.createPortfolio,
    createWatchlistItem: mocks.createWatchlistItem,
    deleteHolding: mocks.deleteHolding,
    deletePortfolio: mocks.deletePortfolio,
    deleteWatchlistItem: mocks.deleteWatchlistItem,
    updateHolding: mocks.updateHolding,
    updatePortfolio: mocks.updatePortfolio,
    updateWatchlistItem: mocks.updateWatchlistItem,
  };
});

vi.mock("@/lib/portfolio/alerts-service", () => ({
  updateAlertStatus: mocks.updateAlertStatus,
}));

vi.mock("@/lib/research/orchestrator", () => ({
  getLatestResearch: mocks.getLatestResearch,
  runResearch: mocks.runResearch,
}));

import { PATCH as updateAlertRoute } from "./alerts/[id]/route";
import {
  DELETE as deleteHoldingRoute,
  PATCH as updateHoldingRoute,
} from "./holdings/[id]/route";
import { POST as createHoldingRoute } from "./holdings/route";
import {
  DELETE as deletePortfolioRoute,
  PATCH as updatePortfolioRoute,
} from "./portfolios/[id]/route";
import { POST as createPortfolioRoute } from "./portfolios/route";
import { POST as runResearchRoute } from "./research/[ticker]/route";
import {
  DELETE as deleteWatchlistRoute,
  PATCH as updateWatchlistRoute,
} from "./watchlist/[id]/route";
import { POST as createWatchlistRoute } from "./watchlist/route";

import {
  AuthorizationError,
  AuthorizationErrorCode,
} from "@/lib/auth/authorization";
import { ManagementError } from "@/lib/portfolio/management";

const actor = {
  email: "owner@example.com",
  id: "user-a",
  image: null,
  name: "Owner",
  role: "USER" as const,
};

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    method,
  });
}

function idContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function tickerContext(ticker: string) {
  return { params: Promise.resolve({ ticker }) };
}

const mutationCases = [
  {
    expectedArgs: [actor.id, "watch-a", { notes: "Updated" }],
    expectedStatus: 200,
    invoke: () =>
      updateWatchlistRoute(
        jsonRequest("PATCH", "/api/watchlist/watch-a", { notes: "Updated" }),
        idContext("watch-a"),
      ),
    label: "update watchlist item",
    service: mocks.updateWatchlistItem,
  },
  {
    expectedArgs: [
      actor.id,
      {
        baseCurrency: "USD",
        name: "Primary portfolio",
      },
    ],
    expectedStatus: 201,
    invoke: () =>
      createPortfolioRoute(
        jsonRequest("POST", "/api/portfolios", {
          baseCurrency: "USD",
          name: "Primary portfolio",
        }),
      ),
    label: "create portfolio",
    service: mocks.createPortfolio,
  },
  {
    expectedArgs: [actor.id, "portfolio-a", { name: "Renamed portfolio" }],
    expectedStatus: 200,
    invoke: () =>
      updatePortfolioRoute(
        jsonRequest("PATCH", "/api/portfolios/portfolio-a", {
          name: "Renamed portfolio",
        }),
        idContext("portfolio-a"),
      ),
    label: "update portfolio",
    service: mocks.updatePortfolio,
  },
  {
    expectedArgs: [actor.id, "portfolio-a"],
    expectedStatus: 204,
    invoke: () =>
      deletePortfolioRoute(
        new Request("http://localhost/api/portfolios/portfolio-a", {
          method: "DELETE",
        }),
        idContext("portfolio-a"),
      ),
    label: "delete portfolio",
    service: mocks.deletePortfolio,
  },
  {
    expectedArgs: [
      actor.id,
      {
        averageCost: 100,
        portfolioId: "portfolio-a",
        shares: 2,
        ticker: "AAPL",
      },
    ],
    expectedStatus: 201,
    invoke: () =>
      createHoldingRoute(
        jsonRequest("POST", "/api/holdings", {
          averageCost: 100,
          portfolioId: "portfolio-a",
          shares: 2,
          ticker: "AAPL",
        }),
      ),
    label: "create holding",
    service: mocks.createHolding,
  },
  {
    expectedArgs: [actor.id, "holding-a", { averageCost: 110, shares: 3 }],
    expectedStatus: 200,
    invoke: () =>
      updateHoldingRoute(
        jsonRequest("PATCH", "/api/holdings/holding-a", {
          averageCost: 110,
          shares: 3,
        }),
        idContext("holding-a"),
      ),
    label: "update holding",
    service: mocks.updateHolding,
  },
  {
    expectedArgs: [actor.id, "holding-a"],
    expectedStatus: 204,
    invoke: () =>
      deleteHoldingRoute(
        new Request("http://localhost/api/holdings/holding-a", {
          method: "DELETE",
        }),
        idContext("holding-a"),
      ),
    label: "delete holding",
    service: mocks.deleteHolding,
  },
  {
    expectedArgs: [actor.id, { ticker: "COST" }],
    expectedStatus: 201,
    invoke: () =>
      createWatchlistRoute(
        jsonRequest("POST", "/api/watchlist", { ticker: "COST" }),
      ),
    label: "create watchlist item",
    service: mocks.createWatchlistItem,
  },
  {
    expectedArgs: [actor.id, "watch-a"],
    expectedStatus: 204,
    invoke: () =>
      deleteWatchlistRoute(
        new Request("http://localhost/api/watchlist/watch-a", {
          method: "DELETE",
        }),
        idContext("watch-a"),
      ),
    label: "delete watchlist item",
    service: mocks.deleteWatchlistItem,
  },
  {
    expectedArgs: [actor.id, "alert-a", { status: "RESOLVED" }],
    expectedStatus: 200,
    invoke: () =>
      updateAlertRoute(
        jsonRequest("PATCH", "/api/alerts/alert-a", {
          status: "RESOLVED",
        }),
        idContext("alert-a"),
      ),
    label: "update alert",
    service: mocks.updateAlertStatus,
  },
  {
    expectedArgs: [actor.id, "AAPL", { regenerate: false }],
    expectedStatus: 202,
    invoke: () =>
      runResearchRoute(
        new Request("http://localhost/api/research/aapl", { method: "POST" }),
        tickerContext("aapl"),
      ),
    label: "run research",
    service: mocks.runResearch,
  },
];

describe("authenticated management route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(actor);
    mocks.requireMutableUser.mockResolvedValue({ id: actor.id, isDemo: false });
    mocks.createPortfolio.mockResolvedValue({ id: "portfolio-a" });
    mocks.updatePortfolio.mockResolvedValue({ id: "portfolio-a" });
    mocks.deletePortfolio.mockResolvedValue(undefined);
    mocks.createHolding.mockResolvedValue({ id: "holding-a" });
    mocks.updateHolding.mockResolvedValue({ id: "holding-a" });
    mocks.deleteHolding.mockResolvedValue(undefined);
    mocks.createWatchlistItem.mockResolvedValue({ id: "watch-a" });
    mocks.updateWatchlistItem.mockResolvedValue({ id: "watch-a" });
    mocks.deleteWatchlistItem.mockResolvedValue(undefined);
    mocks.updateAlertStatus.mockResolvedValue({
      id: "alert-a",
      status: "RESOLVED",
    });
    mocks.runResearch.mockResolvedValue({ jobId: "job-a" });
  });

  it.each(mutationCases)(
    "forwards the authenticated actor for owner $label success",
    async ({ expectedArgs, expectedStatus, invoke, service }) => {
      const response = await invoke();

      expect(response.status).toBe(expectedStatus);
      expect(mocks.requireApiUser).toHaveBeenCalledOnce();
      expect(service).toHaveBeenCalledWith(...expectedArgs);
    },
  );

  it.each(mutationCases)(
    "returns 401 before parsing or calling $label for an anonymous request",
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

  it.each([
    {
      invoke: (id: string) =>
        updateWatchlistRoute(
          jsonRequest("PATCH", `/api/watchlist/${id}`, { notes: "Blocked" }),
          idContext(id),
        ),
      label: "watchlist update",
      service: mocks.updateWatchlistItem,
    },
    {
      invoke: (id: string) =>
        updatePortfolioRoute(
          jsonRequest("PATCH", `/api/portfolios/${id}`, { name: "Blocked" }),
          idContext(id),
        ),
      label: "portfolio update",
      service: mocks.updatePortfolio,
    },
    {
      invoke: (id: string) =>
        deletePortfolioRoute(
          new Request(`http://localhost/api/portfolios/${id}`, {
            method: "DELETE",
          }),
          idContext(id),
        ),
      label: "portfolio delete",
      service: mocks.deletePortfolio,
    },
    {
      invoke: (id: string) =>
        updateHoldingRoute(
          jsonRequest("PATCH", `/api/holdings/${id}`, {
            averageCost: 100,
            shares: 1,
          }),
          idContext(id),
        ),
      label: "holding update",
      service: mocks.updateHolding,
    },
    {
      invoke: (id: string) =>
        deleteHoldingRoute(
          new Request(`http://localhost/api/holdings/${id}`, {
            method: "DELETE",
          }),
          idContext(id),
        ),
      label: "holding delete",
      service: mocks.deleteHolding,
    },
    {
      invoke: (id: string) =>
        deleteWatchlistRoute(
          new Request(`http://localhost/api/watchlist/${id}`, {
            method: "DELETE",
          }),
          idContext(id),
        ),
      label: "watchlist delete",
      service: mocks.deleteWatchlistItem,
    },
    {
      invoke: (id: string) =>
        updateAlertRoute(
          jsonRequest("PATCH", `/api/alerts/${id}`, { status: "RESOLVED" }),
          idContext(id),
        ),
      label: "alert update",
      service: mocks.updateAlertStatus,
    },
  ])(
    "maps foreign and missing $label targets to the same API 404",
    async ({ invoke, service }) => {
      service.mockRejectedValue(
        new AuthorizationError(AuthorizationErrorCode.RESOURCE_NOT_FOUND),
      );

      const bodies = [];
      for (const resourceId of ["foreign-id", "missing-id"]) {
        const response = await invoke(resourceId);
        expect(response.status).toBe(404);
        bodies.push(await response.json());
      }

      expect(bodies).toEqual([
        { error: "The requested resource was not found." },
        { error: "The requested resource was not found." },
      ]);
      expect(service.mock.calls.map((call) => call.slice(0, 2))).toEqual([
        [actor.id, "foreign-id"],
        [actor.id, "missing-id"],
      ]);
      expect(service).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    {
      body: {
        baseCurrency: "USD",
        name: "Forged portfolio",
        userId: "user-b",
      },
      expectedArgs: (body: unknown) => [actor.id, body],
      invoke: (body: unknown) =>
        createPortfolioRoute(jsonRequest("POST", "/api/portfolios", body)),
      label: "portfolio",
      service: mocks.createPortfolio,
    },
    {
      body: {
        averageCost: 100,
        portfolioId: "portfolio-a",
        shares: 1,
        ticker: "AAPL",
        userId: "user-b",
      },
      expectedArgs: (body: unknown) => [actor.id, body],
      invoke: (body: unknown) =>
        createHoldingRoute(jsonRequest("POST", "/api/holdings", body)),
      label: "holding",
      service: mocks.createHolding,
    },
    {
      body: { ticker: "COST", userId: "user-b" },
      expectedArgs: (body: unknown) => [actor.id, body],
      invoke: (body: unknown) =>
        createWatchlistRoute(jsonRequest("POST", "/api/watchlist", body)),
      label: "watchlist item",
      service: mocks.createWatchlistItem,
    },
    {
      body: { notes: "Forged update", userId: "user-b" },
      expectedArgs: (body: unknown) => [actor.id, "watch-a", body],
      invoke: (body: unknown) =>
        updateWatchlistRoute(
          jsonRequest("PATCH", "/api/watchlist/watch-a", body),
          idContext("watch-a"),
        ),
      label: "watchlist item update",
      service: mocks.updateWatchlistItem,
    },
  ])(
    "returns a controlled rejection for a forged $label userId",
    async ({ body, expectedArgs, invoke, service }) => {
      service.mockRejectedValue(
        new ManagementError('Unrecognized key: "userId"', 400),
      );

      const response = await invoke(body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Unrecognized key: "userId"',
      });
      expect(service).toHaveBeenCalledWith(...expectedArgs(body));
    },
  );

  it("returns intentional management errors without leaking internals", async () => {
    mocks.createHolding.mockRejectedValue(
      new ManagementError("That ticker is already in the portfolio.", 409),
    );

    const response = await createHoldingRoute(
      jsonRequest("POST", "/api/holdings", {
        averageCost: 100,
        portfolioId: "portfolio-a",
        shares: 2,
        ticker: "AAPL",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That ticker is already in the portfolio.",
    });
  });

  it("rejects malformed JSON only after authentication and before service access", async () => {
    const response = await createHoldingRoute(
      new Request("http://localhost/api/holdings", {
        body: "{invalid",
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.createHolding).not.toHaveBeenCalled();
  });
});
