import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  listUserAlerts,
  updateAlertStatus,
} from "@/lib/portfolio/alerts-service";

const runId = randomUUID().replaceAll("-", "");
const ids = {
  stock: `m23-stock-${runId}`,
  userA: `m23-user-a-${runId}`,
  userB: `m23-user-b-${runId}`,
  watchlistA: `m23-watch-a-${runId}`,
  watchlistB: `m23-watch-b-${runId}`,
  watchlistDemo: `m23-watch-demo-${runId}`,
};
const ticker = `Z${runId.slice(0, 9).toUpperCase()}`;
let demoUserId: string;

describe("M23 owner-scoped target alerts", () => {
  beforeAll(async () => {
    const currentTimestamp = new Date(Date.now() - 60 * 60 * 1_000);
    const previousTimestamp = new Date(
      currentTimestamp.getTime() - 24 * 60 * 60 * 1_000,
    );
    const demoUser = await db.user.findFirst({
      where: { isDemo: true },
      select: { id: true },
    });
    if (!demoUser) throw new Error("Seeded demo user is required.");
    demoUserId = demoUser.id;

    await db.stock.create({
      data: {
        id: ids.stock,
        ticker,
        companyName: "M23 Crossing Fixture",
        sector: "Technology",
        industry: "Software",
        exchange: "NASDAQ",
        currency: "USD",
        prices: {
          create: [
            {
              timestamp: previousTimestamp,
              open: 98,
              high: 100,
              low: 97,
              close: 99,
              volume: 1_000,
            },
            {
              timestamp: currentTimestamp,
              open: 99,
              high: 102,
              low: 99,
              close: 101,
              volume: 1_200,
            },
          ],
        },
      },
    });

    await Promise.all([
      db.user.create({
        data: {
          id: ids.userA,
          email: `${ids.userA}@portfolioscope.invalid`,
          watchlistItems: {
            create: {
              id: ids.watchlistA,
              stockId: ids.stock,
              targetPrice: 100,
            },
          },
        },
      }),
      db.user.create({
        data: {
          id: ids.userB,
          email: `${ids.userB}@portfolioscope.invalid`,
          watchlistItems: {
            create: {
              id: ids.watchlistB,
              stockId: ids.stock,
              targetPrice: 100,
            },
          },
        },
      }),
      db.watchlistItem.create({
        data: {
          id: ids.watchlistDemo,
          userId: demoUserId,
          stockId: ids.stock,
          targetPrice: 100,
        },
      }),
    ]);
  });

  afterAll(async () => {
    await db.watchlistItem.deleteMany({ where: { id: ids.watchlistDemo } });
    await db.user.deleteMany({
      where: { id: { in: [ids.userA, ids.userB] } },
    });
    await db.stock.deleteMany({ where: { id: ids.stock } });
    await db.$disconnect();
  });

  it("creates one owner-bound alert across duplicate delivery and preserves resolution", async () => {
    const [firstRead, retryRead] = await Promise.all([
      listUserAlerts(ids.userA),
      listUserAlerts(ids.userA),
    ]);
    const firstTargetAlert = firstRead.find((alert) =>
      alert.id.startsWith(`watchlist-target:${ids.watchlistA}:`),
    );
    const retryTargetAlert = retryRead.find((alert) =>
      alert.id.startsWith(`watchlist-target:${ids.watchlistA}:`),
    );

    expect(firstTargetAlert).toMatchObject({
      status: "ACTIVE",
      stock: { ticker },
      type: "WATCHLIST_MOVE",
    });
    expect(retryTargetAlert?.id).toBe(firstTargetAlert?.id);
    expect(
      await db.alert.count({
        where: {
          userId: ids.userA,
          id: { startsWith: `watchlist-target:${ids.watchlistA}:` },
        },
      }),
    ).toBe(1);
    expect(await db.alert.count({ where: { userId: ids.userB } })).toBe(0);

    await updateAlertStatus(ids.userA, firstTargetAlert!.id, {
      status: "RESOLVED",
    });
    const afterRetry = await listUserAlerts(ids.userA);

    expect(
      afterRetry.find((alert) => alert.id === firstTargetAlert!.id)?.status,
    ).toBe("RESOLVED");
  });

  it("keeps demo alert reads free of reconciliation writes", async () => {
    await listUserAlerts(demoUserId);
    await expect(
      db.alert.count({
        where: {
          userId: demoUserId,
          id: { startsWith: `watchlist-target:${ids.watchlistDemo}:` },
        },
      }),
    ).resolves.toBe(0);
  });
});
