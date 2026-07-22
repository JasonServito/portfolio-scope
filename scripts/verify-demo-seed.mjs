import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { Prisma, PrismaClient } from "@prisma/client";

if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production"
) {
  throw new Error(
    "The seed integration check must not run against production.",
  );
}

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  process.loadEnvFile();
}

const prisma = new PrismaClient();
const demoUserEmail = process.env.DEMO_USER_EMAIL ?? "demo@portfolioscope.dev";
const demoPortfolioName = "Recruiter Demo Portfolio";
const stableDemoUserId = "portfolioscope-demo-user";
const stableDemoPortfolioId = "portfolioscope-demo-portfolio";
const deterministicAlertId = "portfolioscope-demo-alert-nvda-concentration";
const deterministicResearchId = "portfolioscope-demo-research-aapl";
const suffix = `${process.pid}-${Date.now()}`;
const legacyDemoUserId = `legacy-demo-${suffix}`;
const legacyDemoPortfolioId = `legacy-demo-portfolio-${suffix}`;
const sentinelId = `seed-safety-${suffix}`;
const sentinelEmail = `${sentinelId}@portfolioscope.invalid`;
const sentinelPortfolioId = `seed-safety-portfolio-${suffix}`;
const stableCollisionEmail = `stable-collision-${suffix}@portfolioscope.invalid`;
const ambiguousPortfolioId = `ambiguous-demo-portfolio-${suffix}`;
const secondMarkerId = `second-demo-marker-${suffix}`;
const extraStockId = `extra-demo-stock-${suffix}`;
const extraTicker =
  `EX${process.pid.toString(36).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`.slice(
    0,
    10,
  );
const extraHoldingId = `extra-demo-holding-${suffix}`;
const extraWatchlistId = `extra-demo-watchlist-${suffix}`;
const demoAnchorDate = new Date("2026-06-26T21:00:00.000Z");
let aggregateRestorePoint = null;

const legacyHoldings = [
  ["AAPL", 42, 154.25],
  ["MSFT", 24, 336.4],
  ["NVDA", 68, 88.75],
  ["GOOGL", 31, 131.2],
  ["AMZN", 27, 146.8],
  ["COST", 8, 702.5],
];

function executeSeed(email) {
  return spawnSync(process.execPath, ["prisma/seed.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DEMO_USER_EMAIL: email },
    encoding: "utf8",
  });
}

function runSeed(email = demoUserEmail) {
  const result = executeSeed(email);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  assert.equal(
    result.error,
    undefined,
    "The demo seed process could not start.",
  );
  assert.equal(result.status, 0, "The demo seed process did not exit cleanly.");
}

function expectSeedFailure(pattern, email = demoUserEmail) {
  const result = executeSeed(email);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(
    result.error,
    undefined,
    "The demo seed process could not start.",
  );
  assert.notEqual(
    result.status,
    0,
    "The unsafe demo seed unexpectedly succeeded.",
  );
  assert.match(output, pattern);
}

async function ensureCanonicalStocks() {
  const records = new Map();

  for (const [ticker] of legacyHoldings) {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: {
        ticker,
        companyName: `${ticker} legacy demo fixture`,
        sector: "Fixture",
        industry: "Fixture",
        exchange: "TEST",
      },
    });
    records.set(ticker, stock);
  }

  return records;
}

async function ensureLegacyDemoCandidate(stockRecords) {
  const markedUsers = await prisma.user.findMany({
    where: { isDemo: true },
    take: 2,
    select: { id: true },
  });
  assert.ok(
    markedUsers.length <= 1,
    "The test database already has multiple demo markers.",
  );

  if (markedUsers[0]) return markedUsers[0].id;

  const emailOwner = await prisma.user.findUnique({
    where: { email: demoUserEmail },
    select: { id: true },
  });
  if (emailOwner) return emailOwner.id;

  const stableOwner = await prisma.user.findUnique({
    where: { id: stableDemoUserId },
    select: { id: true },
  });
  if (stableOwner) return stableOwner.id;

  await prisma.user.create({
    data: {
      id: legacyDemoUserId,
      name: "Legacy Demo Investor",
      email: demoUserEmail,
      isDemo: false,
    },
  });
  await prisma.portfolio.create({
    data: {
      id: legacyDemoPortfolioId,
      userId: legacyDemoUserId,
      name: demoPortfolioName,
    },
  });

  for (const [ticker, shares, averageCost] of legacyHoldings) {
    const stock = stockRecords.get(ticker);
    await prisma.holding.create({
      data: {
        portfolioId: legacyDemoPortfolioId,
        stockId: stock.id,
        shares,
        averageCost,
        costBasis: shares * averageCost,
      },
    });
  }

  return legacyDemoUserId;
}

async function getDemoShape(email = demoUserEmail) {
  const demoUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isDemo: true },
  });

  assert.ok(demoUser, "The demo user was not created.");
  assert.equal(demoUser.isDemo, true, "The demo owner was not durably marked.");

  const demoPortfolios = await prisma.portfolio.findMany({
    where: {
      userId: demoUser.id,
      name: demoPortfolioName,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  assert.equal(
    demoPortfolios.length,
    1,
    "The recruiter demo portfolio is missing or ambiguous.",
  );
  const demoPortfolio = demoPortfolios[0];

  const [
    portfolioCount,
    holdingCount,
    watchlistCount,
    alertCount,
    researchJobCount,
    agentRunCount,
    researchReportCount,
    stockPriceCount,
  ] = await Promise.all([
    prisma.portfolio.count({ where: { userId: demoUser.id } }),
    prisma.holding.count({ where: { portfolioId: demoPortfolio.id } }),
    prisma.watchlistItem.count({ where: { userId: demoUser.id } }),
    prisma.alert.count({ where: { userId: demoUser.id } }),
    prisma.researchJob.count({ where: { userId: demoUser.id } }),
    prisma.agentRun.count({
      where: { researchJob: { userId: demoUser.id } },
    }),
    prisma.researchReport.count({
      where: { researchJob: { userId: demoUser.id } },
    }),
    prisma.stockPrice.count({
      where: {
        stock: {
          ticker: {
            in: [
              "AAPL",
              "MSFT",
              "NVDA",
              "AMD",
              "TSLA",
              "SHOP",
              "GOOGL",
              "AMZN",
              "META",
              "COST",
            ],
          },
        },
      },
    }),
  ]);

  assert.ok(holdingCount >= 6, "Canonical demo holdings are missing.");
  assert.ok(watchlistCount >= 4, "Canonical demo watchlist items are missing.");
  assert.ok(alertCount >= 3, "Canonical demo alerts are missing.");
  assert.ok(
    researchJobCount >= 10,
    "Canonical demo research jobs are missing.",
  );
  assert.ok(agentRunCount >= 60, "Canonical demo agent runs are missing.");
  assert.ok(
    researchReportCount >= 10,
    "Canonical demo research reports are missing.",
  );
  assert.ok(
    stockPriceCount >= 3660,
    "Canonical demo price history is missing.",
  );

  return {
    demoUserId: demoUser.id,
    demoPortfolioId: demoPortfolio.id,
    portfolioCount,
    holdingCount,
    watchlistCount,
    alertCount,
    researchJobCount,
    agentRunCount,
    researchReportCount,
    stockPriceCount,
  };
}

async function assertSentinelPreserved() {
  const sentinel = await prisma.user.findUnique({
    where: { id: sentinelId },
    select: { email: true, isDemo: true },
  });

  assert.deepEqual(sentinel, { email: sentinelEmail, isDemo: false });
}

async function ensureSentinel() {
  await prisma.user.create({
    data: {
      id: sentinelId,
      name: "Seed safety sentinel",
      email: sentinelEmail,
    },
  });
  await prisma.portfolio.create({
    data: {
      id: sentinelPortfolioId,
      userId: sentinelId,
      name: "Seed safety sentinel portfolio",
    },
  });
}

async function testStableIdCollision(demoUserId) {
  if (demoUserId !== stableDemoUserId) {
    const stableOwner = await prisma.user.findUnique({
      where: { id: stableDemoUserId },
      select: { id: true },
    });
    if (!stableOwner) {
      await prisma.user.create({
        data: {
          id: stableDemoUserId,
          name: "Stable ID collision",
          email: stableCollisionEmail,
        },
      });
      expectSeedFailure(
        /stable demo user ID.*(?:DEMO_USER_EMAIL|different user)/i,
      );
      await prisma.user.delete({ where: { id: stableDemoUserId } });
    }
  }

  const stablePortfolio = await prisma.portfolio.findUnique({
    where: { id: stableDemoPortfolioId },
    select: { userId: true },
  });
  if (!stablePortfolio) {
    await prisma.portfolio.create({
      data: {
        id: stableDemoPortfolioId,
        userId: sentinelId,
        name: "Stable portfolio ID collision",
      },
    });
    expectSeedFailure(/stable demo portfolio ID.*non-demo user/i);
    await prisma.portfolio.delete({ where: { id: stableDemoPortfolioId } });
  }
}

async function testAmbiguousPortfolio(demoUserId) {
  await prisma.portfolio.create({
    data: {
      id: ambiguousPortfolioId,
      userId: demoUserId,
      name: demoPortfolioName,
    },
  });
  expectSeedFailure(/demo portfolio|ambigui/i);
  await prisma.portfolio.delete({ where: { id: ambiguousPortfolioId } });
}

async function testDeterministicIdCollisions(stockRecords) {
  const existingAlert = await prisma.alert.findUnique({
    where: { id: deterministicAlertId },
    select: { id: true },
  });
  const existingResearch = await prisma.researchJob.findUnique({
    where: { id: deterministicResearchId },
    select: { id: true },
  });

  if (!existingAlert) {
    await prisma.alert.create({
      data: {
        id: deterministicAlertId,
        userId: sentinelId,
        portfolioId: sentinelPortfolioId,
        stockId: stockRecords.get("NVDA").id,
        type: "CONCENTRATION",
        severity: "LOW",
        title: "Deterministic ID collision",
        message: "This non-demo record must never be reassigned.",
      },
    });
    expectSeedFailure(/deterministic demo alert ID.*non-demo user/i);
    await prisma.alert.delete({ where: { id: deterministicAlertId } });
  }

  if (!existingResearch) {
    await prisma.researchJob.create({
      data: {
        id: deterministicResearchId,
        userId: sentinelId,
        stockId: stockRecords.get("AAPL").id,
        requestedAgents: ["NEWS"],
      },
    });
    expectSeedFailure(/deterministic demo research ID.*non-demo user/i);
    await prisma.researchJob.delete({
      where: { id: deterministicResearchId },
    });
  }
}

async function testMultipleDemoMarkers() {
  await assert.rejects(
    prisma.user.create({
      data: {
        id: secondMarkerId,
        name: "Second demo marker",
        email: `${secondMarkerId}@portfolioscope.invalid`,
        isDemo: true,
      },
    }),
    (error) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
    "The database accepted a second demo-owner marker.",
  );
}

async function addExtraDemoRecords(demoShape) {
  const snapshotsBefore = await prisma.portfolioSnapshot.findMany({
    where: { portfolioId: demoShape.demoPortfolioId },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      totalValue: true,
      totalCostBasis: true,
      totalGainLoss: true,
      totalGainLossPercent: true,
    },
  });
  const aggregateBefore = snapshotsBefore.find(
    (snapshot) => snapshot.timestamp.getTime() === demoAnchorDate.getTime(),
  );
  assert.ok(aggregateBefore, "The canonical demo aggregate is missing.");
  aggregateRestorePoint = {
    portfolioId: demoShape.demoPortfolioId,
    snapshots: snapshotsBefore.map((snapshot) => ({
      timestamp: snapshot.timestamp.toISOString(),
      totalValue: snapshot.totalValue.toString(),
      totalCostBasis: snapshot.totalCostBasis.toString(),
      totalGainLoss: snapshot.totalGainLoss.toString(),
      totalGainLossPercent: snapshot.totalGainLossPercent.toString(),
    })),
  };

  const stock = await prisma.stock.create({
    data: {
      id: extraStockId,
      ticker: extraTicker,
      companyName: "Extra demo record fixture",
      sector: "Fixture",
      industry: "Fixture",
      exchange: "TEST",
    },
  });
  await prisma.holding.create({
    data: {
      id: extraHoldingId,
      portfolioId: demoShape.demoPortfolioId,
      stockId: stock.id,
      shares: 1,
      averageCost: 1,
      costBasis: 1,
    },
  });
  await prisma.holdingSnapshot.create({
    data: {
      holdingId: extraHoldingId,
      timestamp: demoAnchorDate,
      price: 25,
      marketValue: 25,
      gainLoss: 24,
      gainLossPercent: 24,
    },
  });
  await prisma.watchlistItem.create({
    data: {
      id: extraWatchlistId,
      userId: demoShape.demoUserId,
      stockId: stock.id,
      notes: "Seed preservation fixture",
    },
  });

  return {
    totalValue: Number(aggregateBefore.totalValue),
    totalCostBasis: Number(aggregateBefore.totalCostBasis),
  };
}

async function assertExtraSnapshotIncluded(demoShape, aggregateBefore) {
  const aggregateAfter = await prisma.portfolioSnapshot.findUnique({
    where: {
      portfolioId_timestamp: {
        portfolioId: demoShape.demoPortfolioId,
        timestamp: demoAnchorDate,
      },
    },
    select: { totalValue: true, totalCostBasis: true },
  });

  assert.equal(
    Number(aggregateAfter?.totalValue),
    aggregateBefore.totalValue + 25,
    "Rerunning the seed excluded a preserved holding snapshot from the portfolio aggregate.",
  );
  assert.equal(
    Number(aggregateAfter?.totalCostBasis),
    aggregateBefore.totalCostBasis + 1,
    "Rerunning the seed excluded a preserved holding cost basis from the portfolio aggregate.",
  );
}

async function cleanupFixtures() {
  await prisma.alert.deleteMany({
    where: { id: deterministicAlertId, userId: sentinelId },
  });
  await prisma.researchJob.deleteMany({
    where: { id: deterministicResearchId, userId: sentinelId },
  });
  await prisma.watchlistItem.deleteMany({ where: { id: extraWatchlistId } });
  await prisma.holding.deleteMany({ where: { id: extraHoldingId } });
  await prisma.portfolio.deleteMany({ where: { id: ambiguousPortfolioId } });
  await prisma.user.deleteMany({ where: { id: secondMarkerId } });
  await prisma.user.deleteMany({
    where: { id: stableDemoUserId, email: stableCollisionEmail },
  });
  await prisma.user.deleteMany({ where: { id: sentinelId } });
  await prisma.stock.deleteMany({ where: { id: extraStockId } });

  if (aggregateRestorePoint) {
    const { portfolioId, snapshots } = aggregateRestorePoint;
    const timestamps = snapshots.map(
      (snapshot) => new Date(snapshot.timestamp),
    );

    await prisma.$transaction([
      prisma.portfolioSnapshot.deleteMany({
        where: { portfolioId, timestamp: { notIn: timestamps } },
      }),
      ...snapshots.map((snapshot) =>
        prisma.portfolioSnapshot.update({
          where: {
            portfolioId_timestamp: {
              portfolioId,
              timestamp: new Date(snapshot.timestamp),
            },
          },
          data: {
            totalValue: snapshot.totalValue,
            totalCostBasis: snapshot.totalCostBasis,
            totalGainLoss: snapshot.totalGainLoss,
            totalGainLossPercent: snapshot.totalGainLossPercent,
          },
        }),
      ),
    ]);

    const restoredSnapshots = await prisma.portfolioSnapshot.findMany({
      where: { portfolioId },
      orderBy: { timestamp: "asc" },
      select: {
        timestamp: true,
        totalValue: true,
        totalCostBasis: true,
        totalGainLoss: true,
        totalGainLossPercent: true,
      },
    });
    assert.deepEqual(
      restoredSnapshots.map((snapshot) => ({
        timestamp: snapshot.timestamp.toISOString(),
        totalValue: snapshot.totalValue.toString(),
        totalCostBasis: snapshot.totalCostBasis.toString(),
        totalGainLoss: snapshot.totalGainLoss.toString(),
        totalGainLossPercent: snapshot.totalGainLossPercent.toString(),
      })),
      snapshots,
      "Demo aggregate snapshots were not restored after seed verification cleanup.",
    );
    aggregateRestorePoint = null;
  }

  const [markedUsers, configuredEmailOwner] = await Promise.all([
    prisma.user.findMany({
      where: { isDemo: true },
      take: 2,
      select: { id: true, email: true },
    }),
    prisma.user.findUnique({
      where: { email: demoUserEmail },
      select: { id: true },
    }),
  ]);
  if (markedUsers.length === 1 && !configuredEmailOwner) {
    await prisma.user.update({
      where: { id: markedUsers[0].id },
      data: { email: demoUserEmail },
    });
  }
}

async function main() {
  await cleanupFixtures();
  const stockRecords = await ensureCanonicalStocks();
  const initialDemoUserId = await ensureLegacyDemoCandidate(stockRecords);
  await ensureSentinel();

  try {
    await testStableIdCollision(initialDemoUserId);
    await testAmbiguousPortfolio(initialDemoUserId);
    await testDeterministicIdCollisions(stockRecords);

    runSeed();
    const adoptedShape = await getDemoShape();
    assert.equal(
      adoptedShape.demoUserId,
      initialDemoUserId,
      "Legacy demo adoption replaced the owner's primary key.",
    );
    await assertSentinelPreserved();

    await testMultipleDemoMarkers();
    const aggregateBeforeExtra = await addExtraDemoRecords(adoptedShape);
    const shapeWithExtras = await getDemoShape();

    runSeed();
    const repeatedShape = await getDemoShape();
    await assertExtraSnapshotIncluded(repeatedShape, aggregateBeforeExtra);
    assert.deepEqual(
      repeatedShape,
      shapeWithExtras,
      "Rerunning the demo seed changed or removed demo-scoped extras.",
    );
    await assertSentinelPreserved();

    const rotatedDemoEmail = `${sentinelId}-demo@portfolioscope.invalid`;
    runSeed(rotatedDemoEmail);
    const rotatedShape = await getDemoShape(rotatedDemoEmail);
    assert.equal(
      rotatedShape.demoUserId,
      adoptedShape.demoUserId,
      "Changing DEMO_USER_EMAIL created a second demo identity.",
    );
    await assertSentinelPreserved();

    runSeed();
    const finalShape = await getDemoShape();
    assert.deepEqual(
      finalShape,
      shapeWithExtras,
      "Restoring DEMO_USER_EMAIL changed the demo record shape.",
    );

    console.log(
      "Demo seed safely adopts legacy ownership, rejects collisions, remains idempotent, and preserves non-demo and extra demo records.",
    );
  } finally {
    await cleanupFixtures();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
