import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  demoPortfolioName,
  demoReadOnlyMessage,
  isPublicDemoReadOnly,
} from "@/lib/demo";

const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/, "Enter a valid ticker.");

export const holdingInputSchema = z.object({
  ticker: tickerSchema,
  shares: z.coerce
    .number()
    .finite()
    .positive("Shares must be greater than zero."),
  averageCost: z.coerce
    .number()
    .finite()
    .positive("Average cost must be greater than zero."),
});

export const watchlistInputSchema = z.object({
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

function requireWritableDemo() {
  if (isPublicDemoReadOnly()) {
    throw new ManagementError(demoReadOnlyMessage, 403);
  }
}

async function getDemoPortfolio(tx: Prisma.TransactionClient) {
  const portfolio = await tx.portfolio.findFirst({
    where: { name: demoPortfolioName },
    include: { user: true },
  });
  if (!portfolio)
    throw new ManagementError("Demo portfolio is unavailable.", 404);
  return portfolio;
}

async function rebuildPortfolioSnapshots(
  tx: Prisma.TransactionClient,
  portfolioId: string,
) {
  const portfolio = await tx.portfolio.findUnique({
    where: { id: portfolioId },
    include: {
      holdings: { include: { snapshots: true } },
      snapshots: { select: { timestamp: true } },
    },
  });
  if (!portfolio)
    throw new ManagementError("Demo portfolio is unavailable.", 404);

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
  if (prices.length === 0)
    throw new ManagementError(
      "No seeded price history is available for that ticker.",
      422,
    );
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
  if (!stock)
    throw new ManagementError(
      "Ticker is not available in the seeded stock catalog.",
      422,
    );
  return stock;
}

export async function createHolding(input: unknown) {
  requireWritableDemo();
  const parsed = holdingInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ManagementError(
      parsed.error.issues[0]?.message ?? "Invalid holding.",
      400,
    );
  return db.$transaction(async (tx) => {
    const portfolio = await getDemoPortfolio(tx);
    const stock = await findStock(tx, parsed.data.ticker);
    const duplicate = await tx.holding.findUnique({
      where: {
        portfolioId_stockId: { portfolioId: portfolio.id, stockId: stock.id },
      },
    });
    if (duplicate)
      throw new ManagementError(
        "That ticker is already in the portfolio. Edit the existing holding instead.",
        409,
      );
    const costBasis = parsed.data.shares * parsed.data.averageCost;
    const holding = await tx.holding.create({
      data: {
        portfolioId: portfolio.id,
        stockId: stock.id,
        shares: decimal(parsed.data.shares),
        averageCost: decimal(parsed.data.averageCost),
        costBasis: decimal(costBasis),
      },
    });
    await createHoldingSnapshots(
      tx,
      holding.id,
      stock.id,
      parsed.data.shares,
      costBasis,
    );
    await rebuildPortfolioSnapshots(tx, portfolio.id);
    return holding;
  });
}

export async function updateHolding(id: string, input: unknown) {
  requireWritableDemo();
  const parsed = holdingInputSchema
    .pick({ shares: true, averageCost: true })
    .safeParse(input);
  if (!parsed.success)
    throw new ManagementError(
      parsed.error.issues[0]?.message ?? "Invalid holding.",
      400,
    );
  return db.$transaction(async (tx) => {
    const portfolio = await getDemoPortfolio(tx);
    const existing = await tx.holding.findFirst({
      where: { id, portfolioId: portfolio.id },
    });
    if (!existing) throw new ManagementError("Holding was not found.", 404);
    const costBasis = parsed.data.shares * parsed.data.averageCost;
    const holding = await tx.holding.update({
      where: { id },
      data: {
        shares: decimal(parsed.data.shares),
        averageCost: decimal(parsed.data.averageCost),
        costBasis: decimal(costBasis),
      },
    });
    await tx.holdingSnapshot.deleteMany({ where: { holdingId: id } });
    await createHoldingSnapshots(
      tx,
      id,
      existing.stockId,
      parsed.data.shares,
      costBasis,
    );
    await rebuildPortfolioSnapshots(tx, portfolio.id);
    return holding;
  });
}

export async function deleteHolding(id: string) {
  requireWritableDemo();
  return db.$transaction(async (tx) => {
    const portfolio = await getDemoPortfolio(tx);
    const existing = await tx.holding.findFirst({
      where: { id, portfolioId: portfolio.id },
    });
    if (!existing) throw new ManagementError("Holding was not found.", 404);
    await tx.holding.delete({ where: { id } });
    await rebuildPortfolioSnapshots(tx, portfolio.id);
  });
}

export async function getDemoWatchlist() {
  const portfolio = await db.portfolio.findFirst({
    where: { name: demoPortfolioName },
  });
  if (!portfolio) return null;
  return db.watchlistItem.findMany({
    where: { userId: portfolio.userId },
    include: { stock: true },
    orderBy: { stock: { ticker: "asc" } },
  });
}

export async function createWatchlistItem(input: unknown) {
  requireWritableDemo();
  const parsed = watchlistInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ManagementError(
      parsed.error.issues[0]?.message ?? "Invalid watchlist item.",
      400,
    );
  return db.$transaction(async (tx) => {
    const portfolio = await getDemoPortfolio(tx);
    const stock = await findStock(tx, parsed.data.ticker);
    const duplicate = await tx.watchlistItem.findUnique({
      where: {
        userId_stockId: { userId: portfolio.userId, stockId: stock.id },
      },
    });
    if (duplicate)
      throw new ManagementError(
        "That ticker is already on the watchlist.",
        409,
      );
    return tx.watchlistItem.create({
      data: {
        userId: portfolio.userId,
        stockId: stock.id,
        targetPrice:
          parsed.data.targetPrice === "" ||
          parsed.data.targetPrice === undefined
            ? null
            : decimal(parsed.data.targetPrice),
        notes: parsed.data.notes || null,
      },
    });
  });
}

export async function deleteWatchlistItem(id: string) {
  requireWritableDemo();
  return db.$transaction(async (tx) => {
    const portfolio = await getDemoPortfolio(tx);
    const existing = await tx.watchlistItem.findFirst({
      where: { id, userId: portfolio.userId },
    });
    if (!existing)
      throw new ManagementError("Watchlist item was not found.", 404);
    await tx.watchlistItem.delete({ where: { id } });
  });
}
