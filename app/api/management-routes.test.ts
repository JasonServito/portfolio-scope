import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createHoldingRoute } from "./holdings/route";
import {
  DELETE as deleteHoldingRoute,
  PATCH as updateHoldingRoute,
} from "./holdings/[id]/route";
import { POST as createWatchlistRoute } from "./watchlist/route";
import { DELETE as deleteWatchlistRoute } from "./watchlist/[id]/route";
import {
  createHolding,
  createWatchlistItem,
  deleteHolding,
  deleteWatchlistItem,
  ManagementError,
  updateHolding,
} from "@/lib/portfolio/management";

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
    getDemoWatchlist: vi.fn(),
  };
});

const mocks = {
  createHolding: vi.mocked(createHolding),
  updateHolding: vi.mocked(updateHolding),
  deleteHolding: vi.mocked(deleteHolding),
  createWatchlistItem: vi.mocked(createWatchlistItem),
  deleteWatchlistItem: vi.mocked(deleteWatchlistItem),
};

describe("portfolio management routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a holding and forwards the request body", async () => {
    mocks.createHolding.mockResolvedValue({ id: "holding-1" } as never);
    const response = await createHoldingRoute(
      new Request("http://localhost/api/holdings", {
        method: "POST",
        body: JSON.stringify({ ticker: "AAPL", shares: 2, averageCost: 100 }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createHolding).toHaveBeenCalledWith({
      ticker: "AAPL",
      shares: 2,
      averageCost: 100,
    });
  });

  it("returns intentional duplicate errors without leaking internals", async () => {
    mocks.createHolding.mockRejectedValue(
      new ManagementError("That ticker is already in the portfolio.", 409),
    );
    const response = await createHoldingRoute(
      new Request("http://localhost/api/holdings", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That ticker is already in the portfolio.",
    });
  });

  it("rejects malformed JSON as invalid input", async () => {
    const response = await createHoldingRoute(
      new Request("http://localhost/api/holdings", {
        method: "POST",
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.createHolding).not.toHaveBeenCalled();
  });

  it("updates and deletes only the requested holding id", async () => {
    mocks.updateHolding.mockResolvedValue({ id: "holding-1" } as never);
    const context = { params: Promise.resolve({ id: "holding-1" }) };
    expect(
      (
        await updateHoldingRoute(
          new Request("http://localhost", {
            method: "PATCH",
            body: JSON.stringify({ shares: 3, averageCost: 110 }),
          }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.updateHolding).toHaveBeenCalledWith("holding-1", {
      shares: 3,
      averageCost: 110,
    });
    expect(
      (
        await deleteHoldingRoute(
          new Request("http://localhost", { method: "DELETE" }),
          context,
        )
      ).status,
    ).toBe(204);
    expect(mocks.deleteHolding).toHaveBeenCalledWith("holding-1");
  });

  it("creates and removes watchlist items", async () => {
    mocks.createWatchlistItem.mockResolvedValue({ id: "watch-1" } as never);
    const createResponse = await createWatchlistRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ ticker: "COST" }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const deleteResponse = await deleteWatchlistRoute(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: "watch-1" }) },
    );
    expect(deleteResponse.status).toBe(204);
    expect(mocks.deleteWatchlistItem).toHaveBeenCalledWith("watch-1");
  });

  it("rejects malformed holding updates before calling the service", async () => {
    const response = await updateHoldingRoute(
      new Request("http://localhost", {
        method: "PATCH",
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "holding-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateHolding).not.toHaveBeenCalled();
  });
});
