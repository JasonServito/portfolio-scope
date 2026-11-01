import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertUpsert: vi.fn(),
  watchlistItemFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    alert: { upsert: mocks.alertUpsert },
    watchlistItem: { findMany: mocks.watchlistItemFindMany },
  },
}));

import { reconcileUserTargetAlerts } from "@/lib/portfolio/target-alerts";

const now = new Date("2026-08-20T18:00:00.000Z");

function crossingItem() {
  return {
    id: "watch-a",
    stockId: "stock-a",
    targetPrice: { toNumber: () => 100, toString: () => "100" },
    stock: {
      companyName: "Example Corporation",
      currency: "USD",
      ticker: "EXMP",
      prices: [
        {
          close: { toNumber: () => 101 },
          id: "price-current",
          timestamp: new Date("2026-08-20T17:00:00.000Z"),
        },
        {
          close: { toNumber: () => 99 },
          id: "price-previous",
          timestamp: new Date("2026-08-19T17:00:00.000Z"),
        },
      ],
    },
  };
}

describe("watchlist target alert reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.alertUpsert.mockResolvedValue({ id: "target-alert" });
  });

  it("scopes candidates to the owner and retries one deterministic upsert", async () => {
    mocks.watchlistItemFindMany.mockResolvedValue([crossingItem()]);

    await reconcileUserTargetAlerts("user-a", now);
    await reconcileUserTargetAlerts("user-a", now);

    expect(mocks.watchlistItemFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          userId: "user-a",
          targetPrice: { not: null },
          user: { isDemo: false },
        },
      }),
    );
    expect(mocks.alertUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.alertUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "watchlist-target:watch-a:price-current:100:up",
        },
        update: {},
        create: expect.objectContaining({
          id: "watchlist-target:watch-a:price-current:100:up",
          stockId: "stock-a",
          userId: "user-a",
        }),
      }),
    );
    expect(mocks.alertUpsert.mock.calls[1]?.[0]).toEqual(
      mocks.alertUpsert.mock.calls[0]?.[0],
    );
  });

  it("excludes read-only demo owners from reconciliation", async () => {
    mocks.watchlistItemFindMany.mockResolvedValue([]);

    await expect(reconcileUserTargetAlerts("demo-user", now)).resolves.toEqual({
      reconciled: 0,
    });

    expect(mocks.watchlistItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user: { isDemo: false } }),
      }),
    );
    expect(mocks.alertUpsert).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing history",
      mutate: (item: ReturnType<typeof crossingItem>) =>
        item.stock.prices.splice(1),
    },
    {
      label: "stale current observation",
      mutate: (item: ReturnType<typeof crossingItem>) => {
        item.stock.prices[0]!.timestamp = new Date("2026-08-10T17:00:00.000Z");
      },
    },
    {
      label: "stale previous observation",
      mutate: (item: ReturnType<typeof crossingItem>) => {
        item.stock.prices[1]!.timestamp = new Date("2026-08-10T17:00:00.000Z");
      },
    },
    {
      label: "same-side movement",
      mutate: (item: ReturnType<typeof crossingItem>) => {
        item.stock.prices[1]!.close = { toNumber: () => 100.5 };
      },
    },
  ])("does not create an alert for $label", async ({ mutate }) => {
    const item = crossingItem();
    mutate(item);
    mocks.watchlistItemFindMany.mockResolvedValue([item]);

    await expect(reconcileUserTargetAlerts("user-a", now)).resolves.toEqual({
      reconciled: 0,
    });
    expect(mocks.alertUpsert).not.toHaveBeenCalled();
  });
});
