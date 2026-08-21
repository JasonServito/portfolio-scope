import { describe, expect, it, vi } from "vitest";

import { RedisUnavailableError } from "@/lib/cache/redis";
import {
  EARNINGS_FRESH_AFTER_MS,
  EARNINGS_STALE_AFTER_MS,
  presentUpcomingEarnings,
  refreshCatalogOnce,
  refreshUpcomingEarningsCatalog,
} from "@/lib/earnings/service";
import type {
  EarningsRepository,
  FollowedStock,
} from "@/lib/earnings/repository";
import { supportedCompanies } from "@/lib/sec/company-registry";

const now = new Date("2026-08-21T18:00:00.000Z");

function repository(
  overrides: Partial<EarningsRepository> = {},
): EarningsRepository {
  return {
    deleteStatesFetchedBefore: vi.fn().mockResolvedValue(0),
    listCatalogStocks: vi.fn().mockResolvedValue([]),
    listDemoFollowedStocks: vi.fn().mockResolvedValue([]),
    listFollowedStocks: vi.fn().mockResolvedValue([]),
    saveState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function followedStock(
  ticker: string,
  overrides: Partial<FollowedStock> = {},
): FollowedStock {
  return {
    companyName: `${ticker} Company`,
    followedVia: "HOLDING",
    state: {
      eventDate: new Date("2026-08-28T00:00:00.000Z"),
      fetchedAt: now,
      marketSession: "AFTER_MARKET",
      source: "EarningsAPI.com /v1/earnings",
    },
    ticker,
    ...overrides,
  };
}

describe("fixed earnings catalog refresh", () => {
  it("requires the outer daily sweep claim before catalog or provider access", async () => {
    const provider = { getUpcomingEvent: vi.fn() };
    const listCatalogStocks = vi.fn();
    const input = {
      attemptCoordinator: { claim: vi.fn() },
      now,
      provider,
      repository: repository({ listCatalogStocks }),
    };

    await expect(
      refreshCatalogOnce({
        ...input,
        sweepCoordinator: {
          claim: vi.fn().mockResolvedValue(false),
          readStatus: vi.fn().mockResolvedValue("PARTIAL_FAILURE"),
          writeStatus: vi.fn(),
        },
      }),
    ).resolves.toBe("PARTIAL_FAILURE");
    await expect(
      refreshCatalogOnce({
        ...input,
        sweepCoordinator: {
          claim: vi.fn().mockRejectedValue(new RedisUnavailableError()),
          readStatus: vi.fn(),
          writeStatus: vi.fn(),
        },
      }),
    ).resolves.toBe("COORDINATION_UNAVAILABLE");

    expect(listCatalogStocks).not.toHaveBeenCalled();
    expect(provider.getUpcomingEvent).not.toHaveBeenCalled();
  });

  it("retains the winning sweep outcome for later requests", async () => {
    const writeStatus = vi.fn().mockResolvedValue(true);
    const status = await refreshCatalogOnce({
      attemptCoordinator: { claim: vi.fn() },
      now,
      provider: { getUpcomingEvent: vi.fn() },
      repository: repository(),
      sweepCoordinator: {
        claim: vi.fn().mockResolvedValue(true),
        readStatus: vi.fn(),
        writeStatus,
      },
    });

    expect(status).toBe("PARTIAL_FAILURE");
    expect(writeStatus).toHaveBeenCalledWith("2026-08-21", "PARTIAL_FAILURE");
  });

  it("refreshes the fixed supported catalog without a user-derived symbol list", async () => {
    const catalogStocks = supportedCompanies.map(({ ticker }, index) => ({
      id: `stock-${index}`,
      ticker,
    }));
    const saveState = vi.fn().mockResolvedValue(undefined);
    const provider = {
      getUpcomingEvent: vi.fn().mockResolvedValue({
        eventDate: new Date("2026-08-28T00:00:00.000Z"),
        marketSession: "AFTER_MARKET" as const,
      }),
    };
    const claim = vi.fn().mockResolvedValue(true);

    const result = await refreshUpcomingEarningsCatalog({
      coordinator: { claim },
      now,
      provider,
      repository: repository({
        listCatalogStocks: vi.fn().mockResolvedValue(catalogStocks),
        saveState,
      }),
    });

    expect(catalogStocks).toHaveLength(25);
    expect(provider.getUpcomingEvent).toHaveBeenCalledTimes(25);
    expect(
      provider.getUpcomingEvent.mock.calls.map(([ticker]) => ticker).sort(),
    ).toEqual(supportedCompanies.map(({ ticker }) => ticker).sort());
    expect(provider.getUpcomingEvent).not.toHaveBeenCalledWith(
      "SHOP",
      expect.anything(),
    );
    expect(saveState).toHaveBeenCalledTimes(25);
    expect(result).toMatchObject({ attempted: 25, failed: 0, updated: 25 });
  });

  it("does not call the provider after a daily claim or when coordination fails", async () => {
    const catalog = [{ id: "stock-aapl", ticker: "AAPL" }];
    const provider = { getUpcomingEvent: vi.fn() };

    await refreshUpcomingEarningsCatalog({
      coordinator: { claim: vi.fn().mockResolvedValue(false) },
      now,
      provider,
      repository: repository({
        listCatalogStocks: vi.fn().mockResolvedValue(catalog),
      }),
    });
    expect(provider.getUpcomingEvent).not.toHaveBeenCalled();

    const unavailable = await refreshUpcomingEarningsCatalog({
      coordinator: {
        claim: vi.fn().mockRejectedValue(new RedisUnavailableError()),
      },
      now,
      provider,
      repository: repository({
        listCatalogStocks: vi.fn().mockResolvedValue(catalog),
      }),
    });
    expect(provider.getUpcomingEvent).not.toHaveBeenCalled();
    expect(unavailable.coordinationUnavailable).toBe(true);
  });

  it("persists a successful unknown but preserves PostgreSQL state on failure", async () => {
    const saveState = vi.fn().mockResolvedValue(undefined);
    const catalog = [{ id: "stock-aapl", ticker: "AAPL" }];

    await refreshUpcomingEarningsCatalog({
      coordinator: { claim: vi.fn().mockResolvedValue(true) },
      now,
      provider: { getUpcomingEvent: vi.fn().mockResolvedValue(null) },
      repository: repository({
        listCatalogStocks: vi.fn().mockResolvedValue(catalog),
        saveState,
      }),
    });
    expect(saveState).toHaveBeenCalledWith(
      expect.objectContaining({ eventDate: null, stockId: "stock-aapl" }),
    );

    saveState.mockClear();
    const failed = await refreshUpcomingEarningsCatalog({
      coordinator: { claim: vi.fn().mockResolvedValue(true) },
      now,
      provider: {
        getUpcomingEvent: vi.fn().mockRejectedValue(new Error("offline")),
      },
      repository: repository({
        listCatalogStocks: vi.fn().mockResolvedValue(catalog),
        saveState,
      }),
    });
    expect(saveState).not.toHaveBeenCalled();
    expect(failed.failed).toBe(1);
  });
});

describe("upcoming earnings presentation", () => {
  it("deduplicates holding and watchlist membership without losing provenance", () => {
    const items = presentUpcomingEarnings(
      [
        followedStock("AAPL"),
        followedStock("AAPL", { followedVia: "WATCHLIST" }),
      ],
      now,
    );

    expect(items).toEqual([
      expect.objectContaining({
        eventDate: "2026-08-28",
        followedVia: ["HOLDING", "WATCHLIST"],
        state: "KNOWN",
        ticker: "AAPL",
      }),
    ]);
  });

  it("labels fresh, stale, explicit unknown, unavailable, and unsupported states", () => {
    const items = presentUpcomingEarnings(
      [
        followedStock("AAPL"),
        followedStock("MSFT", {
          state: {
            ...followedStock("MSFT").state!,
            fetchedAt: new Date(now.getTime() - EARNINGS_FRESH_AFTER_MS - 1),
          },
        }),
        followedStock("NVDA", {
          state: { ...followedStock("NVDA").state!, eventDate: null },
        }),
        followedStock("JPM", {
          state: {
            ...followedStock("JPM").state!,
            fetchedAt: new Date(now.getTime() - EARNINGS_STALE_AFTER_MS - 1),
          },
        }),
        followedStock("SHOP"),
      ],
      now,
    );

    expect(
      Object.fromEntries(items.map((item) => [item.ticker, item.state])),
    ).toEqual({
      AAPL: "KNOWN",
      JPM: "UNAVAILABLE",
      MSFT: "STALE",
      NVDA: "UNKNOWN",
      SHOP: "UNSUPPORTED",
    });
  });

  it("includes today's event but never renders an expired persisted event", () => {
    const items = presentUpcomingEarnings(
      [
        followedStock("AAPL", {
          state: {
            ...followedStock("AAPL").state!,
            eventDate: new Date("2026-08-21T00:00:00.000Z"),
          },
        }),
        followedStock("MSFT", {
          state: {
            ...followedStock("MSFT").state!,
            eventDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        }),
      ],
      now,
    );

    expect(items.find(({ ticker }) => ticker === "AAPL")).toMatchObject({
      eventDate: "2026-08-21",
      state: "KNOWN",
    });
    expect(items.find(({ ticker }) => ticker === "MSFT")).toMatchObject({
      eventDate: null,
      state: "UNKNOWN",
    });
  });
});
