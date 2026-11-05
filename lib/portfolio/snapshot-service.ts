import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { JobExecutionError } from "@/lib/jobs/errors";

type Numeric = Prisma.Decimal | { toNumber(): number } | number;

function toNumber(value: Numeric) {
  return typeof value === "number" ? value : value.toNumber();
}

export type SnapshotHoldingInput = {
  id: string;
  shares: Numeric;
  costBasis: Numeric;
  latestPrice: { close: Numeric; timestamp: Date } | null;
};

export function calculatePortfolioSnapshot(holdings: SnapshotHoldingInput[]) {
  const missingPriceHoldingIds = holdings
    .filter((holding) => holding.latestPrice === null)
    .map((holding) => holding.id);
  if (missingPriceHoldingIds.length > 0) {
    return { available: false as const, missingPriceHoldingIds };
  }

  // Snapshots are dated by the newest price they use, not by when the job
  // ran, so stored history never claims a valuation newer than its prices.
  const observedAt = new Date(
    Math.max(
      ...holdings.map((holding) => holding.latestPrice!.timestamp.getTime()),
    ),
  );
  // Percentages are stored as fractions (0.25 = 25%), matching the seed and
  // the holding-edit rebuild that analytics reads alongside these rows.
  const holdingSnapshots = holdings.map((holding) => {
    const price = toNumber(holding.latestPrice!.close);
    const marketValue = toNumber(holding.shares) * price;
    const costBasis = toNumber(holding.costBasis);
    const gainLoss = marketValue - costBasis;
    return {
      holdingId: holding.id,
      price,
      marketValue,
      gainLoss,
      gainLossPercent: costBasis === 0 ? 0 : gainLoss / costBasis,
      costBasis,
    };
  });
  const totalValue = holdingSnapshots.reduce(
    (total, holding) => total + holding.marketValue,
    0,
  );
  const totalCostBasis = holdingSnapshots.reduce(
    (total, holding) => total + holding.costBasis,
    0,
  );
  const totalGainLoss = totalValue - totalCostBasis;

  return {
    available: true as const,
    observedAt,
    totalValue,
    totalCostBasis,
    totalGainLoss,
    totalGainLossPercent:
      totalCostBasis === 0 ? 0 : totalGainLoss / totalCostBasis,
    holdingSnapshots,
  };
}

export async function refreshPortfolioSnapshot(input: {
  portfolioId: string;
  userId: string;
  asOf: Date;
}) {
  const portfolio = await db.portfolio.findFirst({
    where: { id: input.portfolioId, userId: input.userId },
    select: {
      id: true,
      holdings: {
        select: {
          id: true,
          shares: true,
          costBasis: true,
          stock: {
            select: {
              prices: {
                where: { timestamp: { lte: input.asOf } },
                orderBy: { timestamp: "desc" },
                take: 1,
                select: { close: true, timestamp: true },
              },
            },
          },
        },
      },
    },
  });
  if (!portfolio) {
    throw new JobExecutionError(
      "PORTFOLIO_NOT_FOUND",
      false,
      "The owned portfolio no longer exists.",
    );
  }

  if (portfolio.holdings.length === 0) {
    // An empty portfolio has no valuation; writing a zero snapshot would
    // present "worth nothing" as a fact on the dashboard.
    return {
      portfolioId: portfolio.id,
      asOf: input.asOf.toISOString(),
      holdingsProcessed: 0,
    };
  }

  const calculated = calculatePortfolioSnapshot(
    portfolio.holdings.map((holding) => ({
      id: holding.id,
      shares: holding.shares,
      costBasis: holding.costBasis,
      latestPrice: holding.stock.prices[0] ?? null,
    })),
  );
  if (!calculated.available) {
    throw new JobExecutionError(
      "PORTFOLIO_PRICE_MISSING",
      false,
      "A portfolio snapshot could not be calculated because a price is missing.",
    );
  }

  await db.$transaction([
    db.portfolioSnapshot.upsert({
      where: {
        portfolioId_timestamp: {
          portfolioId: portfolio.id,
          timestamp: calculated.observedAt,
        },
      },
      update: {
        totalValue: calculated.totalValue,
        totalCostBasis: calculated.totalCostBasis,
        totalGainLoss: calculated.totalGainLoss,
        totalGainLossPercent: calculated.totalGainLossPercent,
      },
      create: {
        portfolioId: portfolio.id,
        timestamp: calculated.observedAt,
        totalValue: calculated.totalValue,
        totalCostBasis: calculated.totalCostBasis,
        totalGainLoss: calculated.totalGainLoss,
        totalGainLossPercent: calculated.totalGainLossPercent,
      },
    }),
    ...calculated.holdingSnapshots.map((holding) =>
      db.holdingSnapshot.upsert({
        where: {
          holdingId_timestamp: {
            holdingId: holding.holdingId,
            timestamp: calculated.observedAt,
          },
        },
        update: {
          price: holding.price,
          marketValue: holding.marketValue,
          gainLoss: holding.gainLoss,
          gainLossPercent: holding.gainLossPercent,
        },
        create: {
          holdingId: holding.holdingId,
          timestamp: calculated.observedAt,
          price: holding.price,
          marketValue: holding.marketValue,
          gainLoss: holding.gainLoss,
          gainLossPercent: holding.gainLossPercent,
        },
      }),
    ),
  ]);

  return {
    portfolioId: portfolio.id,
    asOf: input.asOf.toISOString(),
    observedAt: calculated.observedAt.toISOString(),
    holdingsProcessed: calculated.holdingSnapshots.length,
    totalValue: calculated.totalValue,
  };
}
