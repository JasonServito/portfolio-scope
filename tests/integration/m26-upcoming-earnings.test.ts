import { randomUUID } from "node:crypto";

import type { UpcomingEarningsState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { getUserUpcomingEarnings } from "@/lib/earnings/service";

const runId = randomUUID().replaceAll("-", "");
const ids = {
  userA: `m26-user-a-${runId}`,
  userB: `m26-user-b-${runId}`,
  portfolioA: `m26-portfolio-a-${runId}`,
  portfolioB: `m26-portfolio-b-${runId}`,
};
const now = new Date("2026-08-21T16:00:00.000Z");
const originalFlag = process.env.EARNINGS_SYNC_ENABLED;
let previousStates: UpcomingEarningsState[] = [];

describe("M26 owner-scoped persisted upcoming earnings", () => {
  beforeAll(async () => {
    process.env.EARNINGS_SYNC_ENABLED = "false";
    const stocks = await db.stock.findMany({
      where: { ticker: { in: ["AAPL", "JPM", "MSFT", "SHOP"] } },
      select: { id: true, ticker: true },
    });
    const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock.id]));
    for (const ticker of ["AAPL", "JPM", "MSFT", "SHOP"]) {
      if (!byTicker.has(ticker)) {
        throw new Error(`Seeded ${ticker} stock is required for M26.`);
      }
    }

    previousStates = await db.upcomingEarningsState.findMany({
      where: {
        stockId: { in: [byTicker.get("AAPL")!, byTicker.get("MSFT")!] },
      },
    });

    await Promise.all([
      db.upcomingEarningsState.upsert({
        where: { stockId: byTicker.get("AAPL")! },
        update: {
          eventDate: new Date("2026-10-29T00:00:00.000Z"),
          fetchedAt: now,
          marketSession: "AFTER_MARKET",
          source: "M26 persisted integration fixture",
        },
        create: {
          stockId: byTicker.get("AAPL")!,
          eventDate: new Date("2026-10-29T00:00:00.000Z"),
          fetchedAt: now,
          marketSession: "AFTER_MARKET",
          source: "M26 persisted integration fixture",
        },
      }),
      db.upcomingEarningsState.upsert({
        where: { stockId: byTicker.get("MSFT")! },
        update: {
          eventDate: null,
          fetchedAt: now,
          marketSession: null,
          source: "M26 persisted integration fixture",
        },
        create: {
          stockId: byTicker.get("MSFT")!,
          eventDate: null,
          fetchedAt: now,
          marketSession: null,
          source: "M26 persisted integration fixture",
        },
      }),
    ]);

    await Promise.all([
      db.user.create({
        data: {
          id: ids.userA,
          email: `${ids.userA}@portfolioscope.invalid`,
          portfolios: {
            create: {
              id: ids.portfolioA,
              name: "M26 owner A",
              holdings: {
                create: [
                  {
                    stockId: byTicker.get("AAPL")!,
                    shares: 2,
                    averageCost: 100,
                    costBasis: 200,
                  },
                  {
                    stockId: byTicker.get("SHOP")!,
                    shares: 1,
                    averageCost: 80,
                    costBasis: 80,
                  },
                ],
              },
            },
          },
          watchlistItems: {
            create: [
              { stockId: byTicker.get("AAPL")! },
              { stockId: byTicker.get("MSFT")! },
            ],
          },
        },
      }),
      db.user.create({
        data: {
          id: ids.userB,
          email: `${ids.userB}@portfolioscope.invalid`,
          portfolios: {
            create: {
              id: ids.portfolioB,
              name: "M26 owner B",
              holdings: {
                create: {
                  stockId: byTicker.get("JPM")!,
                  shares: 1,
                  averageCost: 150,
                  costBasis: 150,
                },
              },
            },
          },
        },
      }),
    ]);
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });

    const stocks = await db.stock.findMany({
      where: { ticker: { in: ["AAPL", "MSFT"] } },
      select: { id: true },
    });
    await db.upcomingEarningsState.deleteMany({
      where: { stockId: { in: stocks.map(({ id }) => id) } },
    });
    for (const state of previousStates) {
      await db.upcomingEarningsState.create({ data: state });
    }

    if (originalFlag === undefined) delete process.env.EARNINGS_SYNC_ENABLED;
    else process.env.EARNINGS_SYNC_ENABLED = originalFlag;
    await db.$disconnect();
  });

  it("deduplicates holding and watchlist provenance from PostgreSQL", async () => {
    const result = await getUserUpcomingEarnings(ids.userA, { now });

    expect(result.sourceStatus).toBe("DISABLED");
    expect(result.items.map(({ ticker }) => ticker)).toEqual([
      "AAPL",
      "MSFT",
      "SHOP",
    ]);
    expect(result.items.find(({ ticker }) => ticker === "AAPL")).toMatchObject({
      eventDate: "2026-10-29",
      followedVia: ["HOLDING", "WATCHLIST"],
      source: "M26 persisted integration fixture",
      state: "KNOWN",
    });
    expect(result.items.find(({ ticker }) => ticker === "MSFT")?.state).toBe(
      "UNKNOWN",
    );
  });

  it("keeps reads owner-scoped and labels the seeded out-of-catalog ticker", async () => {
    const [ownerA, ownerB] = await Promise.all([
      getUserUpcomingEarnings(ids.userA, { now }),
      getUserUpcomingEarnings(ids.userB, { now }),
    ]);

    expect(ownerA.items.find(({ ticker }) => ticker === "SHOP")).toMatchObject({
      eventDate: null,
      source: null,
      state: "UNSUPPORTED",
    });
    expect(ownerA.items.some(({ ticker }) => ticker === "JPM")).toBe(false);
    expect(ownerB.items.map(({ ticker }) => ticker)).toEqual(["JPM"]);
    expect(ownerB.items[0]?.state).toBe("UNAVAILABLE");
  });

  it("serves a persisted observation as stale inside the approved window", async () => {
    const staleNow = new Date(now.getTime() + 48 * 60 * 60 * 1_000);
    const result = await getUserUpcomingEarnings(ids.userA, { now: staleNow });

    expect(result.items.find(({ ticker }) => ticker === "AAPL")?.state).toBe(
      "STALE",
    );
  });

  it("prunes PostgreSQL observations outside the approved stale window", async () => {
    const expiredNow = new Date(now.getTime() + 73 * 60 * 60 * 1_000);
    const result = await getUserUpcomingEarnings(ids.userA, {
      now: expiredNow,
    });

    expect(result.items.find(({ ticker }) => ticker === "AAPL")?.state).toBe(
      "UNAVAILABLE",
    );
    const aapl = await db.stock.findUniqueOrThrow({
      where: { ticker: "AAPL" },
      select: { upcomingEarnings: true },
    });
    expect(aapl.upcomingEarnings).toBeNull();
  });
});
