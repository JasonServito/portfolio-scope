import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  throw new Error("The seed integration check must not run against production.");
}

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  process.loadEnvFile();
}

const prisma = new PrismaClient();
const demoUserEmail = process.env.DEMO_USER_EMAIL ?? "demo@portfolioscope.dev";
const sentinelId = `seed-safety-${process.pid}-${Date.now()}`;
const sentinelEmail = `${sentinelId}@portfolioscope.invalid`;

function runSeed() {
  const result = spawnSync(process.execPath, ["prisma/seed.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  assert.equal(result.error, undefined, "The demo seed process could not start.");
  assert.equal(result.status, 0, "The demo seed process did not exit cleanly.");
}

async function getDemoShape() {
  const demoUser = await prisma.user.findUnique({
    where: { email: demoUserEmail },
    select: { id: true },
  });

  assert.ok(demoUser, "The demo user was not created.");

  const demoPortfolio = await prisma.portfolio.findFirst({
    where: {
      userId: demoUser.id,
      name: "Recruiter Demo Portfolio",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  assert.ok(demoPortfolio, "The recruiter demo portfolio was not created.");

  const [
    portfolioCount,
    holdingCount,
    watchlistCount,
    alertCount,
    researchJobCount,
    stockPriceCount,
  ] = await Promise.all([
    prisma.portfolio.count({ where: { userId: demoUser.id } }),
    prisma.holding.count({ where: { portfolioId: demoPortfolio.id } }),
    prisma.watchlistItem.count({ where: { userId: demoUser.id } }),
    prisma.alert.count({ where: { userId: demoUser.id } }),
    prisma.researchJob.count({ where: { userId: demoUser.id } }),
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

  return {
    demoUserId: demoUser.id,
    demoPortfolioId: demoPortfolio.id,
    portfolioCount,
    holdingCount,
    watchlistCount,
    alertCount,
    researchJobCount,
    stockPriceCount,
  };
}

async function assertSentinelPreserved() {
  const sentinel = await prisma.user.findUnique({
    where: { id: sentinelId },
    select: { email: true },
  });

  assert.deepEqual(sentinel, { email: sentinelEmail });
}

async function main() {
  await prisma.user.create({
    data: {
      id: sentinelId,
      name: "Seed safety sentinel",
      email: sentinelEmail,
    },
  });

  try {
    runSeed();
    const firstShape = await getDemoShape();
    await assertSentinelPreserved();

    runSeed();
    const secondShape = await getDemoShape();
    await assertSentinelPreserved();

    assert.deepEqual(
      secondShape,
      firstShape,
      "Rerunning the demo seed changed its record shape.",
    );

    console.log("Demo seed is idempotent and preserves non-demo users.");
  } finally {
    await prisma.user.deleteMany({ where: { id: sentinelId } });
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
