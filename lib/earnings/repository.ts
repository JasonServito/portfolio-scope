import type { EarningsMarketSession } from "@prisma/client";

import { db } from "@/lib/db";

export type CatalogStock = { id: string; ticker: string };

export type FollowedStock = {
  companyName: string;
  followedVia: "HOLDING" | "WATCHLIST";
  state: {
    eventDate: Date | null;
    fetchedAt: Date;
    marketSession: EarningsMarketSession | null;
    source: string;
  } | null;
  ticker: string;
};

export interface EarningsRepository {
  deleteStatesFetchedBefore(cutoff: Date): Promise<number>;
  listCatalogStocks(tickers: readonly string[]): Promise<CatalogStock[]>;
  saveState(input: {
    eventDate: Date | null;
    fetchedAt: Date;
    marketSession: EarningsMarketSession | null;
    source: string;
    stockId: string;
  }): Promise<void>;
  listFollowedStocks(userId: string): Promise<FollowedStock[]>;
  listDemoFollowedStocks(): Promise<FollowedStock[]>;
}

const followedStockSelect = {
  companyName: true,
  ticker: true,
  upcomingEarnings: {
    select: {
      eventDate: true,
      fetchedAt: true,
      marketSession: true,
      source: true,
    },
  },
} as const;

async function listForOwner(where: { id: string } | { isDemo: true }) {
  const owner = await db.user.findFirst({
    where,
    select: {
      portfolios: {
        select: {
          holdings: {
            select: { stock: { select: followedStockSelect } },
          },
        },
      },
      watchlistItems: {
        select: { stock: { select: followedStockSelect } },
      },
    },
  });

  if (!owner) return [];

  return [
    ...owner.portfolios.flatMap((portfolio) =>
      portfolio.holdings.map(
        ({ stock }): FollowedStock => ({
          companyName: stock.companyName,
          followedVia: "HOLDING",
          state: stock.upcomingEarnings,
          ticker: stock.ticker,
        }),
      ),
    ),
    ...owner.watchlistItems.map(
      ({ stock }): FollowedStock => ({
        companyName: stock.companyName,
        followedVia: "WATCHLIST",
        state: stock.upcomingEarnings,
        ticker: stock.ticker,
      }),
    ),
  ];
}

export const prismaEarningsRepository: EarningsRepository = {
  async deleteStatesFetchedBefore(cutoff) {
    const result = await db.upcomingEarningsState.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    });
    return result.count;
  },

  listCatalogStocks(tickers) {
    return db.stock.findMany({
      where: { ticker: { in: [...tickers] } },
      orderBy: { ticker: "asc" },
      select: { id: true, ticker: true },
    });
  },

  async saveState(input) {
    await db.upcomingEarningsState.upsert({
      where: { stockId: input.stockId },
      update: {
        eventDate: input.eventDate,
        fetchedAt: input.fetchedAt,
        marketSession: input.marketSession,
        source: input.source,
      },
      create: input,
    });
  },

  listFollowedStocks(userId) {
    return listForOwner({ id: userId });
  },

  listDemoFollowedStocks() {
    return listForOwner({ isDemo: true });
  },
};
