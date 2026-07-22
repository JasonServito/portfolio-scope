import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentStatus,
  AlertSeverity,
  AlertType,
  Prisma,
  PrismaClient,
} from "@prisma/client";

if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production"
) {
  throw new Error(
    "Auth persistence verification must never run against production.",
  );
}

const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const userId = `m12-user-${suffix}`;
const stockId = `m12-stock-${suffix}`;
const ticker = `M12-${suffix.slice(0, 8).toUpperCase()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.stock.deleteMany({ where: { id: stockId } });
}

async function main() {
  await cleanup();

  const stock = await prisma.stock.create({
    data: {
      id: stockId,
      ticker,
      companyName: "M12 Auth Persistence Fixture",
      sector: "Test",
      industry: "Test",
      exchange: "TEST",
    },
  });
  const user = await prisma.user.create({
    data: {
      id: userId,
      name: "M12 Auth User",
      email: `${userId}@example.test`,
    },
  });

  assert(user.role === "USER", "New OAuth identities must default to USER.");
  assert(
    user.isDemo === false,
    "New OAuth identities must never default to demo.",
  );

  await prisma.account.create({
    data: {
      userId,
      type: "oauth",
      provider: "github",
      providerAccountId: `github-${suffix}`,
    },
  });
  const firstSession = await prisma.session.create({
    data: {
      userId,
      sessionToken: `session-${suffix}`,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const portfolio = await prisma.portfolio.create({
    data: { userId, name: "M12 deletion fixture" },
  });
  const holding = await prisma.holding.create({
    data: {
      portfolioId: portfolio.id,
      stockId: stock.id,
      shares: 1,
      averageCost: 1,
      costBasis: 1,
    },
  });
  const snapshotTimestamp = new Date("2026-07-15T12:00:00.000Z");
  const portfolioSnapshot = await prisma.portfolioSnapshot.create({
    data: {
      portfolioId: portfolio.id,
      timestamp: snapshotTimestamp,
      totalValue: 1,
      totalCostBasis: 1,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
    },
  });
  const holdingSnapshot = await prisma.holdingSnapshot.create({
    data: {
      holdingId: holding.id,
      timestamp: snapshotTimestamp,
      price: 1,
      marketValue: 1,
      gainLoss: 0,
      gainLossPercent: 0,
    },
  });
  await prisma.watchlistItem.create({ data: { userId, stockId: stock.id } });
  await prisma.alert.create({
    data: {
      userId,
      portfolioId: portfolio.id,
      stockId: stock.id,
      type: AlertType.CONCENTRATION,
      severity: AlertSeverity.LOW,
      title: "M12 deletion fixture",
      message: "M12 deletion fixture",
    },
  });
  const researchJob = await prisma.researchJob.create({
    data: {
      userId,
      stockId: stock.id,
      requestedAgents: [AgentName.NEWS],
    },
  });
  const agentRun = await prisma.agentRun.create({
    data: {
      researchJobId: researchJob.id,
      agentName: AgentName.NEWS,
      status: AgentStatus.COMPLETED,
      summary: "M12 deletion fixture",
      findingsJson: [],
      sourcesJson: [],
      warningsJson: [],
    },
  });
  const researchReport = await prisma.researchReport.create({
    data: {
      researchJobId: researchJob.id,
      stockId: stock.id,
      overview: "M12 deletion fixture",
      bullCaseJson: [],
      bearCaseJson: [],
      risksJson: [],
      missingDataJson: [],
      confidence: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const privateStockDeleteRules = await prisma.$queryRaw`
    SELECT tc.constraint_name AS "constraintName", rc.delete_rule AS "deleteRule"
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = tc.constraint_schema
     AND rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_schema = current_schema()
      AND tc.constraint_name IN (
        'WatchlistItem_stockId_fkey',
        'ResearchJob_stockId_fkey',
        'ResearchReport_stockId_fkey'
      )
  `;
  assert(
    privateStockDeleteRules.length === 3 &&
      privateStockDeleteRules.every(
        (constraint) => constraint.deleteRule === "RESTRICT",
      ),
    "Private stock relations must restrict shared catalog deletion.",
  );

  let restrictedDeleteError;
  try {
    await prisma.stock.delete({ where: { id: stockId } });
  } catch (error) {
    restrictedDeleteError = error;
  }
  assert(
    restrictedDeleteError instanceof Prisma.PrismaClientKnownRequestError &&
      restrictedDeleteError.code === "P2003",
    "Deleting a shared stock with private references must be rejected.",
  );

  const persisted = await prisma.session.findUnique({
    where: { sessionToken: firstSession.sessionToken },
    include: { user: true },
  });
  assert(
    persisted?.user.id === userId,
    "Database session did not persist its user.",
  );

  await prisma.session.delete({
    where: { sessionToken: firstSession.sessionToken },
  });
  assert(
    (await prisma.session.findUnique({
      where: { sessionToken: firstSession.sessionToken },
    })) === null,
    "Session revocation did not remove the active session.",
  );

  await prisma.session.create({
    data: {
      userId,
      sessionToken: `second-session-${suffix}`,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.user.delete({ where: { id: userId } });

  const [
    deletedUser,
    accounts,
    sessions,
    portfolios,
    holdings,
    portfolioSnapshots,
    holdingSnapshots,
    watchlistItems,
    alerts,
    researchJobs,
    agentRuns,
    researchReports,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.account.count({ where: { userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.portfolio.count({ where: { userId } }),
    prisma.holding.count({ where: { id: holding.id } }),
    prisma.portfolioSnapshot.count({ where: { id: portfolioSnapshot.id } }),
    prisma.holdingSnapshot.count({ where: { id: holdingSnapshot.id } }),
    prisma.watchlistItem.count({ where: { userId } }),
    prisma.alert.count({ where: { userId } }),
    prisma.researchJob.count({ where: { userId } }),
    prisma.agentRun.count({ where: { id: agentRun.id } }),
    prisma.researchReport.count({ where: { id: researchReport.id } }),
  ]);

  assert(deletedUser === null, "Account deletion left the user row behind.");
  assert(
    [
      accounts,
      sessions,
      portfolios,
      holdings,
      portfolioSnapshots,
      holdingSnapshots,
      watchlistItems,
      alerts,
      researchJobs,
      agentRuns,
      researchReports,
    ].every((count) => count === 0),
    "Account deletion left dependent private records behind.",
  );

  console.log("Auth persistence, revocation, role, and cascade checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
