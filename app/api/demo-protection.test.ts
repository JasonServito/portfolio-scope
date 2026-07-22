import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertFindFirst: vi.fn(),
  alertUpdate: vi.fn(),
  holdingDelete: vi.fn(),
  holdingFindFirst: vi.fn(),
  holdingUpdate: vi.fn(),
  portfolioCreate: vi.fn(),
  portfolioDelete: vi.fn(),
  portfolioFindFirst: vi.fn(),
  portfolioUpdate: vi.fn(),
  researchJobCreate: vi.fn(),
  requireApiUser: vi.fn(),
  stockFindUnique: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  watchlistItemCreate: vi.fn(),
  watchlistItemDelete: vi.fn(),
  watchlistItemFindFirst: vi.fn(),
  watchlistItemUpdate: vi.fn(),
}));

const tx = {
  alert: {
    findFirst: mocks.alertFindFirst,
    update: mocks.alertUpdate,
  },
  holding: {
    delete: mocks.holdingDelete,
    findFirst: mocks.holdingFindFirst,
    update: mocks.holdingUpdate,
  },
  portfolio: {
    create: mocks.portfolioCreate,
    delete: mocks.portfolioDelete,
    findFirst: mocks.portfolioFindFirst,
    update: mocks.portfolioUpdate,
  },
  user: { findUnique: mocks.userFindUnique },
  watchlistItem: {
    create: mocks.watchlistItemCreate,
    delete: mocks.watchlistItemDelete,
    findFirst: mocks.watchlistItemFindFirst,
    update: mocks.watchlistItemUpdate,
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    researchJob: { create: mocks.researchJobCreate },
    stock: { findUnique: mocks.stockFindUnique },
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return { ...original, requireApiUser: mocks.requireApiUser };
});

import { PATCH as updateAlert } from "./alerts/[id]/route";
import {
  DELETE as deleteHolding,
  PATCH as updateHolding,
} from "./holdings/[id]/route";
import { POST as createHolding } from "./holdings/route";
import {
  DELETE as deletePortfolio,
  PATCH as updatePortfolio,
} from "./portfolios/[id]/route";
import { POST as createPortfolio } from "./portfolios/route";
import { POST as runResearch } from "./research/[ticker]/route";
import {
  DELETE as deleteWatchlistItem,
  PATCH as updateWatchlistItem,
} from "./watchlist/[id]/route";
import { POST as createWatchlistItem } from "./watchlist/route";

const demoActor = {
  email: "demo@portfolioscope.local",
  id: "demo-user",
  image: null,
  name: "Recruiter demo",
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

const demoMutations = [
  {
    invoke: () =>
      updateWatchlistItem(
        jsonRequest("PATCH", "/api/watchlist/watch-a", {
          notes: "Blocked demo update",
        }),
        idContext("watch-a"),
      ),
    label: "update watchlist item",
  },
  {
    invoke: () =>
      createPortfolio(
        jsonRequest("POST", "/api/portfolios", {
          baseCurrency: "USD",
          name: "Blocked portfolio",
        }),
      ),
    label: "create portfolio",
  },
  {
    invoke: () =>
      updatePortfolio(
        jsonRequest("PATCH", "/api/portfolios/portfolio-a", {
          name: "Blocked rename",
        }),
        idContext("portfolio-a"),
      ),
    label: "update portfolio",
  },
  {
    invoke: () =>
      deletePortfolio(
        new Request("http://localhost/api/portfolios/portfolio-a", {
          method: "DELETE",
        }),
        idContext("portfolio-a"),
      ),
    label: "delete portfolio",
  },
  {
    invoke: () =>
      createHolding(
        jsonRequest("POST", "/api/holdings", {
          averageCost: 100,
          portfolioId: "portfolio-a",
          shares: 1,
          ticker: "AAPL",
        }),
      ),
    label: "create holding",
  },
  {
    invoke: () =>
      updateHolding(
        jsonRequest("PATCH", "/api/holdings/holding-a", {
          averageCost: 100,
          shares: 1,
        }),
        idContext("holding-a"),
      ),
    label: "update holding",
  },
  {
    invoke: () =>
      deleteHolding(
        new Request("http://localhost/api/holdings/holding-a", {
          method: "DELETE",
        }),
        idContext("holding-a"),
      ),
    label: "delete holding",
  },
  {
    invoke: () =>
      createWatchlistItem(
        jsonRequest("POST", "/api/watchlist", { ticker: "COST" }),
      ),
    label: "create watchlist item",
  },
  {
    invoke: () =>
      deleteWatchlistItem(
        new Request("http://localhost/api/watchlist/watch-a", {
          method: "DELETE",
        }),
        idContext("watch-a"),
      ),
    label: "delete watchlist item",
  },
  {
    invoke: () =>
      updateAlert(
        jsonRequest("PATCH", "/api/alerts/alert-a", {
          status: "RESOLVED",
        }),
        idContext("alert-a"),
      ),
    label: "update alert",
  },
  {
    invoke: () =>
      runResearch(
        new Request("http://localhost/api/research/AAPL", {
          method: "POST",
        }),
        { params: Promise.resolve({ ticker: "AAPL" }) },
      ),
    label: "run research",
  },
];

const persistedWriteMocks = [
  mocks.alertUpdate,
  mocks.holdingDelete,
  mocks.holdingUpdate,
  mocks.portfolioCreate,
  mocks.portfolioDelete,
  mocks.portfolioUpdate,
  mocks.researchJobCreate,
  mocks.watchlistItemCreate,
  mocks.watchlistItemDelete,
  mocks.watchlistItemUpdate,
];

describe("persisted public demo mutation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(demoActor);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.userFindUnique.mockResolvedValue({
      id: demoActor.id,
      isDemo: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(
    ["development", "test", "production"].flatMap((nodeEnv) =>
      demoMutations.map((mutation) => ({ ...mutation, nodeEnv })),
    ),
  )(
    "rejects $label for a marked demo actor in NODE_ENV=$nodeEnv",
    async ({ invoke, nodeEnv }) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      const response = await invoke();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "The public demo is read-only.",
      });
      expect(mocks.requireApiUser).toHaveBeenCalledOnce();
      expect(mocks.userFindUnique).toHaveBeenCalledWith({
        where: { id: demoActor.id },
        select: { id: true, isDemo: true },
      });
      expect(mocks.portfolioFindFirst).not.toHaveBeenCalled();
      expect(mocks.holdingFindFirst).not.toHaveBeenCalled();
      expect(mocks.watchlistItemFindFirst).not.toHaveBeenCalled();
      expect(mocks.alertFindFirst).not.toHaveBeenCalled();
      expect(mocks.stockFindUnique).not.toHaveBeenCalled();
      for (const write of persistedWriteMocks) {
        expect(write).not.toHaveBeenCalled();
      }
    },
  );
});
