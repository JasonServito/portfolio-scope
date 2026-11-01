import { db } from "@/lib/db";
import {
  evaluateTargetCrossing,
  presentWatchlistPrice,
} from "@/lib/portfolio/watchlist-prices";

function alertId(input: {
  currentPriceId: string;
  direction: "DOWN" | "UP";
  targetPrice: string;
  watchlistItemId: string;
}) {
  return [
    "watchlist-target",
    input.watchlistItemId,
    input.currentPriceId,
    input.targetPrice,
    input.direction.toLowerCase(),
  ].join(":");
}

export async function reconcileUserTargetAlerts(
  userId: string,
  now = new Date(),
) {
  const items = await db.watchlistItem.findMany({
    where: {
      userId,
      targetPrice: { not: null },
      user: { isDemo: false },
    },
    select: {
      id: true,
      stockId: true,
      targetPrice: true,
      stock: {
        select: {
          companyName: true,
          currency: true,
          ticker: true,
          prices: {
            orderBy: { timestamp: "desc" },
            take: 2,
            select: { close: true, id: true, timestamp: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const alerts = items.flatMap((item) => {
    const [current, previous] = item.stock.prices;
    if (!item.targetPrice || !current || !previous) return [];

    const price = presentWatchlistPrice([current], item.stock.currency, now);
    const previousPrice = presentWatchlistPrice(
      [previous],
      item.stock.currency,
      current.timestamp,
    );
    if (price.state !== "CACHED" || previousPrice.state !== "CACHED") {
      return [];
    }

    const crossing = evaluateTargetCrossing({
      currentPrice: current.close,
      previousPrice: previous.close,
      targetPrice: item.targetPrice,
    });
    if (!crossing) return [];

    const targetPrice = item.targetPrice.toString();
    const directionLabel =
      crossing.direction === "UP" ? "up through" : "down through";

    return [
      {
        id: alertId({
          currentPriceId: current.id,
          direction: crossing.direction,
          targetPrice,
          watchlistItemId: item.id,
        }),
        data: {
          userId,
          stockId: item.stockId,
          type: "WATCHLIST_MOVE" as const,
          severity: "LOW" as const,
          title: `${item.stock.ticker} crossed your target`,
          message: `${item.stock.companyName}'s cached demo price moved ${directionLabel} your ${item.stock.currency} ${targetPrice} target at ${current.timestamp.toISOString()}.`,
          createdAt: current.timestamp,
        },
      },
    ];
  });

  await Promise.all(
    alerts.map((alert) =>
      db.alert.upsert({
        where: { id: alert.id },
        update: {},
        create: { id: alert.id, ...alert.data },
      }),
    ),
  );

  return { reconciled: alerts.length };
}
