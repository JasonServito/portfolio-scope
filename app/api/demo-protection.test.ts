import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createHolding } from "./holdings/route";
import {
  DELETE as deleteHolding,
  PATCH as updateHolding,
} from "./holdings/[id]/route";
import { POST as runResearch } from "./research/[ticker]/route";
import { POST as createWatchlistItem } from "./watchlist/route";
import { DELETE as deleteWatchlistItem } from "./watchlist/[id]/route";

import * as management from "@/lib/portfolio/management";
import * as research from "@/lib/research/orchestrator";

vi.mock("@/lib/portfolio/management", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/portfolio/management")>();

  return {
    ...original,
    createHolding: vi.fn(),
    updateHolding: vi.fn(),
    deleteHolding: vi.fn(),
    createWatchlistItem: vi.fn(),
    deleteWatchlistItem: vi.fn(),
  };
});

vi.mock("@/lib/research/orchestrator", () => ({
  getLatestResearch: vi.fn(),
  runResearch: vi.fn(),
}));

const holdingContext = { params: Promise.resolve({ id: "holding-1" }) };
const watchlistContext = { params: Promise.resolve({ id: "watch-1" }) };
const researchContext = { params: Promise.resolve({ ticker: "AAPL" }) };

const dependencies = [
  management.createHolding,
  management.updateHolding,
  management.deleteHolding,
  management.createWatchlistItem,
  management.deleteWatchlistItem,
  research.runResearch,
];

describe("public demo mutation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [
      "create holding",
      () =>
        createHolding(
          new Request("http://localhost/api/holdings", {
            method: "POST",
            body: JSON.stringify({ ticker: "AAPL", shares: 1, averageCost: 1 }),
          }),
        ),
    ],
    [
      "update holding",
      () =>
        updateHolding(
          new Request("http://localhost/api/holdings/holding-1", {
            method: "PATCH",
            body: JSON.stringify({ shares: 1, averageCost: 1 }),
          }),
          holdingContext,
        ),
    ],
    [
      "delete holding",
      () =>
        deleteHolding(
          new Request("http://localhost/api/holdings/holding-1", {
            method: "DELETE",
          }),
          holdingContext,
        ),
    ],
    [
      "create watchlist item",
      () =>
        createWatchlistItem(
          new Request("http://localhost/api/watchlist", {
            method: "POST",
            body: JSON.stringify({ ticker: "COST" }),
          }),
        ),
    ],
    [
      "delete watchlist item",
      () =>
        deleteWatchlistItem(
          new Request("http://localhost/api/watchlist/watch-1", {
            method: "DELETE",
          }),
          watchlistContext,
        ),
    ],
    [
      "run research",
      () =>
        runResearch(
          new Request("http://localhost/api/research/AAPL", {
            method: "POST",
          }),
          researchContext,
        ),
    ],
  ])("rejects %s in production", async (_label, request) => {
    const response = await request();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "The public demo is read-only.",
    });

    for (const dependency of dependencies) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });
});
