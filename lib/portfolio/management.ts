import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  requireMutableUser,
  requireOwnedHolding,
  requireOwnedPortfolio,
  requireOwnedWatchlistItem,
} from "@/lib/auth/authorization";
import { db } from "@/lib/db";
import { queuePortfolioSnapshotRefresh } from "@/lib/portfolio/snapshot-jobs";

async function queueSnapshotSafely(userId: string, portfolioId: string) {
  try {
    await queuePortfolioSnapshotRefresh(userId, portfolioId);
  } catch {
    // A mutation is already committed at this point. When publishing was
    // attempted, the durable job records its failure for admin retry. A
    // disabled local background system intentionally leaves no job.
  }
}

const resourceIdSchema = z.string().trim().min(1).max(128);
const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/, "Enter a valid ticker.");
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Enter a three-letter currency code.");

export const portfolioInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Portfolio name is required.")
      .max(80, "Portfolio name must be 80 characters or fewer."),
    baseCurrency: currencySchema.default("USD"),
  })
  .strict();

export const portfolioUpdateSchema = portfolioInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a portfolio field to update.",
  });

export const holdingInputSchema = z
  .object({
    portfolioId: resourceIdSchema,
    ticker: tickerSchema,
    shares: z.coerce
      .number()
      .finite()
      .positive("Shares must be greater than zero."),
    averageCost: z.coerce
      .number()
      .finite()
      .positive("Average cost must be greater than zero."),
  })
  .strict();

export const holdingUpdateSchema = holdingInputSchema
  .pick({ shares: true, averageCost: true })
  .strict();

export const watchlistInputSchema = z
  .object({
    ticker: tickerSchema,
    targetPrice: z
      .union([
        z.coerce
          .number()
          .finite()
          .positive("Target price must be greater than zero."),
        z.literal(""),
      ])
      .optional(),
    notes: z
      .string()
      .trim()
      .max(500, "Notes must be 500 characters or fewer.")
      .optional(),
  })
  .strict();

export const watchlistUpdateSchema = watchlistInputSchema
  .omit({ ticker: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a watchlist field to update.",
  });

export class ManagementError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  fallback: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ManagementError(parsed.error.issues[0]?.message ?? fallback, 400);
  }
  return parsed.data;
}

async function rebuildPortfolioSnapshots(
  tx: Prisma.TransactionClient,
  userId: string,
  portfolioId: string,
) {
  const portfolio = await tx.portfolio.findFirst({
    where: { id: portfolioId, userId },
    include: {
      holdings: { include: { snapshots: true } },
      snapshots: { select: { timestamp: true } },
    },
  });
  if (!portfolio) throw new ManagementError("Portfolio was not found.", 404);

  const timestamps = [
    ...new Set([
      ...portfolio.snapshots.map((snapshot) => snapshot.timestamp.getTime()),
      ...portfolio.holdings.flatMap((holding) =>
        holding.snapshots.map((snapshot) => snapshot.timestamp.getTime()),
      ),
    ]),
  ].sort();
  await tx.portfolioSnapshot.deleteMany({ where: { portfolioId } });
  if (timestamps.length === 0) return;

  await tx.portfolioSnapshot.createMany({
    data: timestamps.map((time) => {
      const totalCostBasis = portfolio.holdings.reduce(
        (sum, holding) => sum + Number(holding.costBasis),
        0,
      );
      const totalValue = portfolio.holdings.reduce((sum, holding) => {
        const snapshot = holding.snapshots.find(
          (item) => item.timestamp.getTime() === time,
        );
        return sum + (snapshot ? Number(snapshot.marketValue) : 0);
      }, 0);
      const totalGainLoss = totalValue - totalCostBasis;
      return {
        portfolioId,
        timestamp: new Date(time),
        totalValue: decimal(totalValue),
        totalCostBasis: decimal(totalCostBasis),
        totalGainLoss: decimal(totalGainLoss),
        totalGainLossPercent: decimal(
          totalCostBasis === 0 ? 0 : totalGainLoss / totalCostBasis,
        ),
      };
    }),
  });
}

async function createHoldingSnapshots(
  tx: Prisma.TransactionClient,
  holdingId: string,
  stockId: string,
  shares: number,
  costBasis: number,
) {
  const prices = await tx.stockPrice.findMany({
    where: { stockId },
    orderBy: { timestamp: "asc" },
  });
  if (prices.length === 0) {
    throw new ManagementError(
      "No seeded price history is available for that ticker.",
      422,
    );
  }
  await tx.holdingSnapshot.createMany({
    data: prices.map((price) => {
      const marketValue = Number(price.close) * shares;
      const gainLoss = marketValue - costBasis;
      return {
        holdingId,
        timestamp: price.timestamp,
        price: price.close,
        marketValue: decimal(marketValue),
        gainLoss: decimal(gainLoss),
        gainLossPercent: decimal(costBasis === 0 ? 0 : gainLoss / costBasis),
      };
    }),
  });
}

async function findStock(tx: Prisma.TransactionClient, ticker: string) {
  const stock = await tx.stock.findUnique({ where: { ticker } });
  if (!stock) {
    throw new ManagementError(
      "Ticker is not available in the seeded stock catalog.",
      422,
    );
  }
  return stock;
}

export async function listPortfolios(userId: string) {
  return db.portfolio.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { holdings: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPortfolio(userId: string, portfolioId: string) {
  return db.portfolio.findFirst({
    where: { id: portfolioId, userId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      createdAt: true,
      updatedAt: true,
      holdings: {
        select: {
          id: true,
          shares: true,
          averageCost: true,
          costBasis: true,
          stock: {
            select: { ticker: true, companyName: true, sector: true },
          },
        },
        orderBy: { stock: { ticker: "asc" } },
      },
    },
  });
}

export async function createPortfolio(userId: string, input: unknown) {
  const data = parseInput(portfolioInputSchema, input, "Invalid portfolio.");
  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    return tx.portfolio.create({ data: { ...data, userId } });
  });
}

export async function updatePortfolio(
  userId: string,
  portfolioId: string,
  input: unknown,
) {
  const data = parseInput(
    portfolioUpdateSchema,
    input,
    "Invalid portfolio update.",
  );
  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    await requireOwnedPortfolio(userId, portfolioId, tx);
    return tx.portfolio.update({ where: { id: portfolioId }, data });
  });
}

export async function deletePortfolio(userId: string, portfolioId: string) {
  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    await requireOwnedPortfolio(userId, portfolioId, tx);
    await tx.portfolio.delete({ where: { id: portfolioId } });
  });
}

export async function createHolding(userId: string, input: unknown) {
  const data = parseInput(holdingInputSchema, input, "Invalid holding.");
  const holding = await db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    const portfolio = await requireOwnedPortfolio(userId, data.portfolioId, tx);
    const stock = await findStock(tx, data.ticker);
    const duplicate = await tx.holding.findUnique({
      where: {
        portfolioId_stockId: {
          portfolioId: portfolio.id,
          stockId: stock.id,
        },
      },
    });
    if (duplicate) {
      throw new ManagementError(
        "That ticker is already in the portfolio. Edit the existing holding instead.",
        409,
      );
    }
    const costBasis = data.shares * data.averageCost;
    const holding = await tx.holding.create({
      data: {
        portfolioId: portfolio.id,
        stockId: stock.id,
        shares: decimal(data.shares),
        averageCost: decimal(data.averageCost),
        costBasis: decimal(costBasis),
      },
    });
    await createHoldingSnapshots(
      tx,
      holding.id,
      stock.id,
      data.shares,
      costBasis,
    );
    await rebuildPortfolioSnapshots(tx, userId, portfolio.id);
    return holding;
  });
  await queueSnapshotSafely(userId, holding.portfolioId);
  return holding;
}

export async function listHoldings(userId: string, portfolioId: string) {
  const portfolio = await db.portfolio.findFirst({
    where: { id: portfolioId, userId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      holdings: {
        select: {
          id: true,
          shares: true,
          averageCost: true,
          costBasis: true,
          createdAt: true,
          updatedAt: true,
          stock: {
            select: { ticker: true, companyName: true, sector: true },
          },
        },
        orderBy: { stock: { ticker: "asc" } },
      },
    },
  });

  return portfolio;
}

export async function updateHolding(
  userId: string,
  holdingId: string,
  input: unknown,
) {
  const data = parseInput(
    holdingUpdateSchema,
    input,
    "Invalid holding update.",
  );
  const holding = await db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    const existing = await requireOwnedHolding(userId, holdingId, tx);
    const costBasis = data.shares * data.averageCost;
    const holding = await tx.holding.update({
      where: { id: holdingId },
      data: {
        shares: decimal(data.shares),
        averageCost: decimal(data.averageCost),
        costBasis: decimal(costBasis),
      },
    });
    await tx.holdingSnapshot.deleteMany({ where: { holdingId } });
    await createHoldingSnapshots(
      tx,
      holdingId,
      existing.stockId,
      data.shares,
      costBasis,
    );
    await rebuildPortfolioSnapshots(tx, userId, existing.portfolioId);
    return holding;
  });
  await queueSnapshotSafely(userId, holding.portfolioId);
  return holding;
}

export async function deleteHolding(userId: string, holdingId: string) {
  const portfolioId = await db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    const existing = await requireOwnedHolding(userId, holdingId, tx);
    await tx.holding.delete({ where: { id: holdingId } });
    await rebuildPortfolioSnapshots(tx, userId, existing.portfolioId);
    return existing.portfolioId;
  });
  await queueSnapshotSafely(userId, portfolioId);
}

export async function getDemoWatchlist() {
  return db.watchlistItem.findMany({
    where: { user: { isDemo: true } },
    include: {
      stock: {
        include: {
          prices: {
            orderBy: { timestamp: "desc" },
            select: { close: true, id: true, timestamp: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { stock: { ticker: "asc" } },
  });
}

export async function getUserWatchlist(userId: string) {
  return db.watchlistItem.findMany({
    where: { userId },
    include: {
      stock: {
        include: {
          prices: {
            orderBy: { timestamp: "desc" },
            select: { close: true, id: true, timestamp: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { stock: { ticker: "asc" } },
  });
}

export async function createWatchlistItem(userId: string, input: unknown) {
  const data = parseInput(
    watchlistInputSchema,
    input,
    "Invalid watchlist item.",
  );
  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    const stock = await findStock(tx, data.ticker);
    const duplicate = await tx.watchlistItem.findUnique({
      where: { userId_stockId: { userId, stockId: stock.id } },
    });
    if (duplicate) {
      throw new ManagementError(
        "That ticker is already on the watchlist.",
        409,
      );
    }
    return tx.watchlistItem.create({
      data: {
        userId,
        stockId: stock.id,
        targetPrice:
          data.targetPrice === "" || data.targetPrice === undefined
            ? null
            : decimal(data.targetPrice),
        notes: data.notes || null,
      },
    });
  });
}

export async function deleteWatchlistItem(userId: string, itemId: string) {
  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    await requireOwnedWatchlistItem(userId, itemId, tx);
    await tx.watchlistItem.delete({ where: { id: itemId } });
  });
}

export async function updateWatchlistItem(
  userId: string,
  itemId: string,
  input: unknown,
) {
  const data = parseInput(
    watchlistUpdateSchema,
    input,
    "Invalid watchlist update.",
  );

  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    await requireOwnedWatchlistItem(userId, itemId, tx);

    return tx.watchlistItem.update({
      where: { id: itemId },
      data: {
        ...(data.targetPrice !== undefined
          ? {
              targetPrice:
                data.targetPrice === "" ? null : decimal(data.targetPrice),
            }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      },
    });
  });
}
