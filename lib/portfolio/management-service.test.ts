import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  deleteHolding,
  deleteWatchlistItem,
  ManagementError,
} from "@/lib/portfolio/management";

const tx = {
  portfolio: {
    findFirst: vi.fn(),
  },
  holding: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  watchlistItem: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
  },
}));

describe("portfolio management ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$transaction).mockImplementation(async (callback) =>
      callback(tx as never),
    );
    tx.portfolio.findFirst.mockResolvedValue({
      id: "portfolio-1",
      userId: "demo-user-1",
      user: { id: "demo-user-1" },
    });
  });

  it("does not delete a holding outside the demo portfolio", async () => {
    tx.holding.findFirst.mockResolvedValue(null);

    await expect(deleteHolding("another-portfolio-holding")).rejects.toEqual(
      new ManagementError("Holding was not found.", 404),
    );
    expect(tx.holding.findFirst).toHaveBeenCalledWith({
      where: {
        id: "another-portfolio-holding",
        portfolioId: "portfolio-1",
      },
    });
    expect(tx.holding.delete).not.toHaveBeenCalled();
  });

  it("does not delete a watchlist item owned by another user", async () => {
    tx.watchlistItem.findFirst.mockResolvedValue(null);

    await expect(deleteWatchlistItem("another-user-item")).rejects.toEqual(
      new ManagementError("Watchlist item was not found.", 404),
    );
    expect(tx.watchlistItem.findFirst).toHaveBeenCalledWith({
      where: { id: "another-user-item", userId: "demo-user-1" },
    });
    expect(tx.watchlistItem.delete).not.toHaveBeenCalled();
  });
});
