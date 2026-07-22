import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentRating,
  AgentStatus,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Prisma,
  ResearchStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteUserAccount } from "@/lib/auth/account-service";
import {
  AuthorizationErrorCode,
  requireMutableUser,
  requireOwnedAlert,
  requireOwnedHolding,
  requireOwnedPortfolio,
  requireOwnedResearchJob,
  requireOwnedResearchReport,
  requireOwnedWatchlistItem,
} from "@/lib/auth/authorization";
import { db } from "@/lib/db";
import { demoPortfolioName } from "@/lib/demo";
import type { JobPublisher } from "@/lib/jobs/qstash";
import {
  listUserAlerts,
  updateAlertStatus,
} from "@/lib/portfolio/alerts-service";
import {
  getDemoPortfolioAnalytics,
  getOwnedPortfolioAnalytics,
} from "@/lib/portfolio/analytics";
import {
  createHolding,
  createPortfolio,
  createWatchlistItem,
  deleteHolding,
  deletePortfolio,
  deleteWatchlistItem,
  getDemoWatchlist,
  getPortfolio,
  getUserWatchlist,
  listHoldings,
  listPortfolios,
  updateHolding,
  updatePortfolio,
  updateWatchlistItem,
} from "@/lib/portfolio/management";
import {
  getLatestResearch,
  getLatestResearchForUser,
  getOwnedResearchJob,
  listResearchJobs,
  runResearch,
} from "@/lib/research/orchestrator";
import { seededResearchProvider } from "@/lib/research/providers/seeded-provider";

const runId = randomUUID().replaceAll("-", "");
const fixtureTicker = `Z${runId.slice(0, 9).toUpperCase()}`;
const missingResourceId = `m13-missing-${runId}`;

const ids = {
  userA: `m13-user-a-${runId}`,
  userB: `m13-user-b-${runId}`,
  admin: `m13-admin-${runId}`,
  stock: `m13-stock-${runId}`,
  portfolioA: `m13-portfolio-a-${runId}`,
  portfolioB: `m13-portfolio-b-${runId}`,
  portfolioAdmin: `m13-portfolio-admin-${runId}`,
  holdingAaplA: `m13-holding-aapl-a-${runId}`,
  holdingFixtureA: `m13-holding-fixture-a-${runId}`,
  holdingAaplB: `m13-holding-aapl-b-${runId}`,
  holdingAdmin: `m13-holding-admin-${runId}`,
  watchlistAaplA: `m13-watchlist-aapl-a-${runId}`,
  watchlistFixtureA: `m13-watchlist-fixture-a-${runId}`,
  watchlistAaplB: `m13-watchlist-aapl-b-${runId}`,
  watchlistAdmin: `m13-watchlist-admin-${runId}`,
  alertA: `m13-alert-a-${runId}`,
  alertB: `m13-alert-b-${runId}`,
  alertMismatched: `m13-alert-mismatched-${runId}`,
  alertAdmin: `m13-alert-admin-${runId}`,
  researchA: `m13-research-a-${runId}`,
  researchB: `m13-research-b-${runId}`,
  researchAdmin: `m13-research-admin-${runId}`,
  reportA: `m13-report-a-${runId}`,
  reportB: `m13-report-b-${runId}`,
  reportAdmin: `m13-report-admin-${runId}`,
  agentA: `m13-agent-a-${runId}`,
  agentB: `m13-agent-b-${runId}`,
  agentAdmin: `m13-agent-admin-${runId}`,
  accountAdmin: `m13-account-admin-${runId}`,
  sessionAdmin: `m13-session-admin-${runId}`,
  portfolioSnapshotAdmin: `m13-portfolio-snapshot-admin-${runId}`,
  holdingSnapshotAdmin: `m13-holding-snapshot-admin-${runId}`,
};

const alertTitles = {
  userA: `M13 User A scoped alert ${runId}`,
  userB: `M13 User B scoped alert ${runId}`,
};

const fixtureEmails = {
  userA: `${ids.userA}@portfolioscope.invalid`,
  userB: `${ids.userB}@portfolioscope.invalid`,
  admin: `${ids.admin}@portfolioscope.invalid`,
};

const backgroundTestEnvironment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://portfolioscope.invalid",
  BACKGROUND_JOBS_ENABLED: "true",
} as NodeJS.ProcessEnv;

const backgroundTestPublisher: JobPublisher = {
  publishJSON: async () => ({ messageId: `m13-${randomUUID()}` }),
};

type StockReference = {
  id: string;
  ticker: string;
};

type DemoIdentity = {
  id: string;
  email: string | null;
};

type ForeignKeyRule = {
  constraintName: string;
  deleteRule: string;
};

let aaplStock: StockReference;
let msftStock: StockReference;
let demoUser: DemoIdentity;
let demoStateCaptured = false;
let demoStateBefore: unknown;
let demoAnalyticsBefore: unknown;
let demoWatchlistBefore: unknown;
let demoResearchBefore: unknown;

function serializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function setEnvironmentVariable(
  name: "NODE_ENV" | "VERCEL_ENV",
  value: string | undefined,
) {
  const environment: Record<string, string | undefined> = process.env;
  if (value === undefined) {
    delete environment[name];
  } else {
    environment[name] = value;
  }
}

async function readPrivateState(userId: string) {
  return serializable(
    await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isDemo: true,
        updatedAt: true,
        accounts: {
          orderBy: { id: "asc" },
          select: { id: true, provider: true, providerAccountId: true },
        },
        sessions: {
          orderBy: { id: "asc" },
          select: { id: true, sessionToken: true, expires: true },
        },
        portfolios: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            name: true,
            baseCurrency: true,
            updatedAt: true,
            holdings: {
              orderBy: { id: "asc" },
              select: {
                id: true,
                stockId: true,
                shares: true,
                averageCost: true,
                costBasis: true,
                updatedAt: true,
                _count: { select: { snapshots: true } },
              },
            },
            _count: { select: { snapshots: true } },
          },
        },
        watchlistItems: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            stockId: true,
            targetPrice: true,
            notes: true,
            updatedAt: true,
          },
        },
        alerts: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            stockId: true,
            portfolioId: true,
            status: true,
            title: true,
            resolvedAt: true,
          },
        },
        researchJobs: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            stockId: true,
            status: true,
            completedAt: true,
            requestedAgents: true,
            agentRuns: {
              orderBy: { id: "asc" },
              select: { id: true, status: true, summary: true },
            },
            report: {
              select: {
                id: true,
                stockId: true,
                overview: true,
                generatedAt: true,
                expiresAt: true,
              },
            },
          },
        },
      },
    }),
  );
}

async function createResearchFixture({
  agentRunId,
  completedAt,
  jobId,
  label,
  reportId,
  stockId,
  userId,
}: {
  agentRunId: string;
  completedAt: Date;
  jobId: string;
  label: string;
  reportId: string;
  stockId: string;
  userId: string;
}) {
  const expiresAt = new Date(completedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

  return db.researchJob.create({
    data: {
      id: jobId,
      userId,
      stockId,
      status: ResearchStatus.COMPLETED,
      requestedAgents: [AgentName.NEWS],
      createdAt: completedAt,
      completedAt,
      agentRuns: {
        create: {
          id: agentRunId,
          agentName: AgentName.NEWS,
          status: AgentStatus.COMPLETED,
          rating: AgentRating.NEUTRAL,
          confidence: 0.5,
          summary: label,
          findingsJson: [],
          sourcesJson: [],
          warningsJson: [],
          startedAt: completedAt,
          completedAt,
        },
      },
      report: {
        create: {
          id: reportId,
          stockId,
          overview: label,
          bullCaseJson: [],
          bearCaseJson: [],
          risksJson: [],
          missingDataJson: [],
          confidence: 0.5,
          generatedAt: completedAt,
          expiresAt,
        },
      },
    },
  });
}

async function expectAuthorizationFailure(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  await expect(promise).rejects.toMatchObject({ code, status });
}

async function expectNotFound(promise: Promise<unknown>) {
  await expectAuthorizationFailure(
    promise,
    AuthorizationErrorCode.RESOURCE_NOT_FOUND,
    404,
  );
}

async function expectBadRequest(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ status: 400 });
}

async function cleanupFixtures() {
  await db.backgroundJob.deleteMany({
    where: { userId: { in: [ids.userA, ids.userB, ids.admin] } },
  });
  await db.user.deleteMany({
    where: {
      OR: [
        { id: ids.userA, email: fixtureEmails.userA },
        { id: ids.userB, email: fixtureEmails.userB },
        { id: ids.admin, email: fixtureEmails.admin },
      ],
    },
  });
  await db.stock.deleteMany({
    where: { id: ids.stock, ticker: fixtureTicker },
  });
}

beforeAll(async () => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("M13 integration tests must not run against production.");
  }

  const markedDemoUsers = await db.user.findMany({
    where: { isDemo: true },
    select: { id: true, email: true },
  });
  if (markedDemoUsers.length !== 1) {
    throw new Error(
      "M13 integration tests require exactly one marked demo user after seeding.",
    );
  }
  demoUser = markedDemoUsers[0];

  const demoPortfolio = await db.portfolio.findFirst({
    where: { userId: demoUser.id, name: demoPortfolioName },
    select: { id: true },
  });
  if (!demoPortfolio) {
    throw new Error("The marked demo user is missing the demo portfolio.");
  }

  [aaplStock, msftStock] = await Promise.all(
    ["AAPL", "MSFT"].map(async (ticker) => {
      const stock = await db.stock.findUnique({
        where: { ticker },
        select: { id: true, ticker: true },
      });
      if (!stock) {
        throw new Error(`The demo seed is missing required stock ${ticker}.`);
      }
      return stock;
    }),
  );

  demoStateBefore = await readPrivateState(demoUser.id);
  demoStateCaptured = true;
  demoAnalyticsBefore = serializable(await getDemoPortfolioAnalytics("1M"));
  demoWatchlistBefore = serializable(await getDemoWatchlist());
  demoResearchBefore = serializable(await getLatestResearch("AAPL"));
  if (!demoAnalyticsBefore || !demoResearchBefore) {
    throw new Error(
      "The demo seed must include analytics and AAPL research before M13 integration tests run.",
    );
  }

  await db.stock.create({
    data: {
      id: ids.stock,
      ticker: fixtureTicker,
      companyName: "M13 isolation fixture",
      sector: "Test",
      industry: "Integration",
      exchange: "TEST",
      prices: {
        create: [
          {
            timestamp: new Date("2026-07-01T00:00:00.000Z"),
            open: 90,
            high: 101,
            low: 89,
            close: 100,
            volume: BigInt(1_000),
          },
          {
            timestamp: new Date("2026-07-02T00:00:00.000Z"),
            open: 100,
            high: 111,
            low: 99,
            close: 110,
            volume: BigInt(1_100),
          },
          {
            timestamp: new Date("2026-07-03T00:00:00.000Z"),
            open: 110,
            high: 121,
            low: 109,
            close: 120,
            volume: BigInt(1_200),
          },
        ],
      },
    },
  });

  await db.$transaction([
    db.user.create({
      data: {
        id: ids.userA,
        name: "M13 User A",
        email: fixtureEmails.userA,
      },
    }),
    db.user.create({
      data: {
        id: ids.userB,
        name: "M13 User B",
        email: fixtureEmails.userB,
      },
    }),
    db.user.create({
      data: {
        id: ids.admin,
        name: "M13 Admin",
        email: fixtureEmails.admin,
        role: "ADMIN",
      },
    }),
  ]);

  await db.portfolio.create({
    data: {
      id: ids.portfolioA,
      userId: ids.userA,
      name: demoPortfolioName,
      holdings: {
        create: [
          {
            id: ids.holdingAaplA,
            stockId: aaplStock.id,
            shares: 2,
            averageCost: 100,
            costBasis: 200,
          },
          {
            id: ids.holdingFixtureA,
            stockId: ids.stock,
            shares: 8,
            averageCost: 100,
            costBasis: 800,
          },
        ],
      },
      snapshots: {
        create: {
          timestamp: new Date("2099-01-01T00:00:00.000Z"),
          totalValue: 1_000,
          totalCostBasis: 1_000,
          totalGainLoss: 0,
          totalGainLossPercent: 0,
        },
      },
    },
  });

  await db.portfolio.create({
    data: {
      id: ids.portfolioB,
      userId: ids.userB,
      name: "M13 User B private portfolio",
      holdings: {
        create: {
          id: ids.holdingAaplB,
          stockId: aaplStock.id,
          shares: 4,
          averageCost: 50,
          costBasis: 200,
        },
      },
    },
  });

  await db.portfolio.create({
    data: {
      id: ids.portfolioAdmin,
      userId: ids.admin,
      name: "M13 admin cascade portfolio",
      holdings: {
        create: {
          id: ids.holdingAdmin,
          stockId: ids.stock,
          shares: 1,
          averageCost: 100,
          costBasis: 100,
        },
      },
    },
  });

  await db.$transaction([
    db.watchlistItem.create({
      data: {
        id: ids.watchlistAaplA,
        userId: ids.userA,
        stockId: aaplStock.id,
        notes: "M13 User A",
      },
    }),
    db.watchlistItem.create({
      data: {
        id: ids.watchlistFixtureA,
        userId: ids.userA,
        stockId: ids.stock,
        notes: "M13 RESTRICT fixture",
      },
    }),
    db.watchlistItem.create({
      data: {
        id: ids.watchlistAaplB,
        userId: ids.userB,
        stockId: aaplStock.id,
        notes: "M13 User B",
      },
    }),
    db.watchlistItem.create({
      data: {
        id: ids.watchlistAdmin,
        userId: ids.admin,
        stockId: ids.stock,
        notes: "M13 admin cascade fixture",
      },
    }),
    db.alert.create({
      data: {
        id: ids.alertA,
        userId: ids.userA,
        portfolioId: ids.portfolioA,
        stockId: aaplStock.id,
        type: AlertType.CONCENTRATION,
        severity: AlertSeverity.HIGH,
        title: alertTitles.userA,
        message: "Only User A should see this alert.",
      },
    }),
    db.alert.create({
      data: {
        id: ids.alertB,
        userId: ids.userB,
        portfolioId: ids.portfolioB,
        stockId: aaplStock.id,
        type: AlertType.CONCENTRATION,
        severity: AlertSeverity.MEDIUM,
        title: alertTitles.userB,
        message: "Only User B should see this alert.",
      },
    }),
    db.alert.create({
      data: {
        id: ids.alertMismatched,
        userId: ids.userA,
        portfolioId: ids.portfolioB,
        stockId: aaplStock.id,
        type: AlertType.CONCENTRATION,
        severity: AlertSeverity.HIGH,
        title: "M13 mismatched related portfolio",
        message: "Malformed legacy data must fail closed.",
      },
    }),
    db.alert.create({
      data: {
        id: ids.alertAdmin,
        userId: ids.admin,
        portfolioId: ids.portfolioAdmin,
        stockId: ids.stock,
        type: AlertType.CONCENTRATION,
        severity: AlertSeverity.LOW,
        title: "M13 admin cascade alert",
        message: "M13 admin cascade fixture",
      },
    }),
  ]);

  await createResearchFixture({
    agentRunId: ids.agentA,
    completedAt: new Date("2099-01-02T00:00:00.000Z"),
    jobId: ids.researchA,
    label: "M13 User A private AAPL research",
    reportId: ids.reportA,
    stockId: aaplStock.id,
    userId: ids.userA,
  });
  await createResearchFixture({
    agentRunId: ids.agentB,
    completedAt: new Date("2099-01-03T00:00:00.000Z"),
    jobId: ids.researchB,
    label: "M13 User B private AAPL research",
    reportId: ids.reportB,
    stockId: aaplStock.id,
    userId: ids.userB,
  });
  await createResearchFixture({
    agentRunId: ids.agentAdmin,
    completedAt: new Date("2099-01-04T00:00:00.000Z"),
    jobId: ids.researchAdmin,
    label: "M13 admin cascade research",
    reportId: ids.reportAdmin,
    stockId: ids.stock,
    userId: ids.admin,
  });

  const snapshotAt = new Date("2099-01-04T00:00:00.000Z");
  await db.$transaction([
    db.account.create({
      data: {
        id: ids.accountAdmin,
        userId: ids.admin,
        type: "oauth",
        provider: "github",
        providerAccountId: `m13-admin-${runId}`,
      },
    }),
    db.session.create({
      data: {
        id: ids.sessionAdmin,
        userId: ids.admin,
        sessionToken: `m13-admin-session-${runId}`,
        expires: new Date("2100-01-01T00:00:00.000Z"),
      },
    }),
    db.portfolioSnapshot.create({
      data: {
        id: ids.portfolioSnapshotAdmin,
        portfolioId: ids.portfolioAdmin,
        timestamp: snapshotAt,
        totalValue: 120,
        totalCostBasis: 100,
        totalGainLoss: 20,
        totalGainLossPercent: 0.2,
      },
    }),
    db.holdingSnapshot.create({
      data: {
        id: ids.holdingSnapshotAdmin,
        holdingId: ids.holdingAdmin,
        timestamp: snapshotAt,
        price: 120,
        marketValue: 120,
        gainLoss: 20,
        gainLossPercent: 0.2,
      },
    }),
  ]);
}, 60_000);

afterAll(async () => {
  try {
    if (demoStateCaptured) {
      expect(await readPrivateState(demoUser.id)).toEqual(demoStateBefore);
    }
  } finally {
    await cleanupFixtures();
    await db.$disconnect();
  }
}, 60_000);

describe.sequential("M13 real PostgreSQL user isolation", () => {
  it("supports owner-scoped portfolio, holding, watchlist, alert, and research workflows", async () => {
    const portfolios = await listPortfolios(ids.userA);
    expect(portfolios.map((portfolio) => portfolio.id)).toContain(
      ids.portfolioA,
    );
    expect(portfolios.map((portfolio) => portfolio.id)).not.toContain(
      ids.portfolioB,
    );

    const portfolio = await getPortfolio(ids.userA, ids.portfolioA);
    expect(portfolio).toMatchObject({
      id: ids.portfolioA,
      name: demoPortfolioName,
    });
    await updatePortfolio(ids.userA, ids.portfolioA, {
      baseCurrency: "CAD",
    });
    expect(await getPortfolio(ids.userA, ids.portfolioA)).toMatchObject({
      baseCurrency: "CAD",
    });
    await updatePortfolio(ids.userA, ids.portfolioA, {
      baseCurrency: "USD",
    });

    const analytics = await getOwnedPortfolioAnalytics(
      ids.userA,
      ids.portfolioA,
      "1M",
    );
    expect(analytics?.portfolio.id).toBe(ids.portfolioA);

    const ownerPortfolio = await createPortfolio(ids.userA, {
      name: `M13 owner workflow ${runId}`,
      baseCurrency: "USD",
    });
    expect(ownerPortfolio.userId).toBe(ids.userA);

    const ownerHolding = await createHolding(ids.userA, {
      portfolioId: ownerPortfolio.id,
      ticker: fixtureTicker,
      shares: 1,
      averageCost: 100,
    });
    expect(ownerHolding.portfolioId).toBe(ownerPortfolio.id);
    const updatedHolding = await updateHolding(ids.userA, ownerHolding.id, {
      shares: 2,
      averageCost: 110,
    });
    expect(Number(updatedHolding.costBasis)).toBe(220);
    expect(
      (await listHoldings(ids.userA, ownerPortfolio.id))?.holdings.map(
        (holding) => holding.id,
      ),
    ).toContain(ownerHolding.id);
    await deleteHolding(ids.userA, ownerHolding.id);
    await deletePortfolio(ids.userA, ownerPortfolio.id);

    const watchlistItem = await createWatchlistItem(ids.userA, {
      ticker: msftStock.ticker,
      targetPrice: 500,
      notes: "M13 owner workflow",
    });
    expect(watchlistItem.userId).toBe(ids.userA);
    await expect(
      updateWatchlistItem(ids.userA, watchlistItem.id, {
        notes: "M13 owner workflow updated",
        targetPrice: 510,
      }),
    ).resolves.toMatchObject({ id: watchlistItem.id });
    await deleteWatchlistItem(ids.userA, watchlistItem.id);

    await expect(
      updateAlertStatus(ids.userA, ids.alertA, {
        status: AlertStatus.RESOLVED,
      }),
    ).resolves.toMatchObject({ status: AlertStatus.RESOLVED });
    await updateAlertStatus(ids.userA, ids.alertA, {
      status: AlertStatus.ACTIVE,
    });

    expect(await getOwnedResearchJob(ids.userA, ids.researchA)).toMatchObject({
      id: ids.researchA,
      ticker: "AAPL",
    });
    expect((await getLatestResearchForUser(ids.userA, "AAPL"))?.jobId).toBe(
      ids.researchA,
    );

    const generatedResearch = await runResearch(ids.userA, "MSFT", {
      publisher: backgroundTestPublisher,
      environment: backgroundTestEnvironment,
    });
    expect(generatedResearch?.ticker).toBe("MSFT");
    expect(generatedResearch?.status).toBe(ResearchStatus.PENDING);
    expect((await listResearchJobs(ids.userA)).map((job) => job.id)).toContain(
      generatedResearch?.jobId,
    );
  });

  it("prevents User A from reading or mutating User B private records", async () => {
    const userBBefore = await readPrivateState(ids.userB);

    expect(await getPortfolio(ids.userA, ids.portfolioB)).toBeNull();
    expect(await listHoldings(ids.userA, ids.portfolioB)).toBeNull();
    expect(
      (await getUserWatchlist(ids.userA)).map((item) => item.id),
    ).not.toContain(ids.watchlistAaplB);
    expect(
      (await listUserAlerts(ids.userA)).map((alert) => alert.id),
    ).not.toContain(ids.alertB);
    expect(
      (await listUserAlerts(ids.userA)).map((alert) => alert.id),
    ).not.toContain(ids.alertMismatched);
    expect(await getOwnedResearchJob(ids.userA, ids.researchB)).toBeNull();

    await expectNotFound(requireOwnedPortfolio(ids.userA, ids.portfolioB));
    await expectNotFound(requireOwnedHolding(ids.userA, ids.holdingAaplB));
    await expectNotFound(
      requireOwnedWatchlistItem(ids.userA, ids.watchlistAaplB),
    );
    await expectNotFound(requireOwnedAlert(ids.userA, ids.alertB));
    await expectNotFound(requireOwnedAlert(ids.userA, ids.alertMismatched));
    await expectNotFound(requireOwnedResearchJob(ids.userA, ids.researchB));
    await expectNotFound(requireOwnedResearchReport(ids.userA, ids.reportB));

    await expectNotFound(
      updatePortfolio(ids.userA, ids.portfolioB, {
        name: "Cross-user portfolio update",
      }),
    );
    await expectNotFound(deletePortfolio(ids.userA, ids.portfolioB));
    await expectNotFound(
      updateHolding(ids.userA, ids.holdingAaplB, {
        shares: 99,
        averageCost: 99,
      }),
    );
    await expectNotFound(deleteHolding(ids.userA, ids.holdingAaplB));
    await expectNotFound(deleteWatchlistItem(ids.userA, ids.watchlistAaplB));
    await expectNotFound(
      updateWatchlistItem(ids.userA, ids.watchlistAaplB, {
        notes: "Cross-user update",
      }),
    );
    await expectNotFound(
      updateAlertStatus(ids.userA, ids.alertB, {
        status: AlertStatus.RESOLVED,
      }),
    );
    await expectNotFound(
      updateAlertStatus(ids.userA, ids.alertMismatched, {
        status: AlertStatus.RESOLVED,
      }),
    );

    expect(await readPrivateState(ids.userB)).toEqual(userBBefore);
  });

  it("rejects a forged User B portfolio ID before creating a User A holding", async () => {
    const holdingCountBefore = await db.holding.count({
      where: { portfolioId: ids.portfolioB },
    });

    await expectNotFound(
      createHolding(ids.userA, {
        portfolioId: ids.portfolioB,
        ticker: msftStock.ticker,
        shares: 1,
        averageCost: 100,
      }),
    );

    expect(
      await db.holding.count({ where: { portfolioId: ids.portfolioB } }),
    ).toBe(holdingCountBefore);
  });

  it("rejects forged client userId fields instead of accepting client ownership", async () => {
    const forgedPortfolioName = `M13 forged owner ${runId}`;
    const holdingCountBefore = await db.holding.count({
      where: { portfolioId: ids.portfolioA },
    });
    const watchlistCountBefore = await db.watchlistItem.count({
      where: { userId: ids.userA },
    });

    await expectBadRequest(
      createPortfolio(ids.userA, {
        name: forgedPortfolioName,
        baseCurrency: "USD",
        userId: ids.userB,
      }),
    );
    await expectBadRequest(
      updatePortfolio(ids.userA, ids.portfolioA, {
        name: "Forged update",
        userId: ids.userB,
      }),
    );
    await expectBadRequest(
      createHolding(ids.userA, {
        portfolioId: ids.portfolioA,
        ticker: "TSLA",
        shares: 1,
        averageCost: 100,
        userId: ids.userB,
      }),
    );
    await expectBadRequest(
      createWatchlistItem(ids.userA, {
        ticker: "TSLA",
        notes: "Forged owner",
        userId: ids.userB,
      }),
    );
    await expectBadRequest(
      updateWatchlistItem(ids.userA, ids.watchlistAaplA, {
        notes: "Forged owner",
        userId: ids.userB,
      }),
    );
    await expectBadRequest(
      updateAlertStatus(ids.userA, ids.alertA, {
        status: AlertStatus.RESOLVED,
        userId: ids.userB,
      }),
    );

    expect(
      await db.portfolio.count({
        where: { userId: ids.userA, name: forgedPortfolioName },
      }),
    ).toBe(0);
    expect(
      await db.holding.count({ where: { portfolioId: ids.portfolioA } }),
    ).toBe(holdingCountBefore);
    expect(await db.watchlistItem.count({ where: { userId: ids.userA } })).toBe(
      watchlistCountBefore,
    );
    expect(
      await db.alert.findUnique({ where: { id: ids.alertA } }),
    ).toMatchObject({ status: AlertStatus.ACTIVE });
  });

  it("enforces a single database-marked demo owner", async () => {
    const candidateId = `m13-second-demo-${runId}`;

    try {
      await expect(
        db.user.create({
          data: {
            id: candidateId,
            email: `${candidateId}@portfolioscope.invalid`,
            isDemo: true,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await db.user.deleteMany({ where: { id: candidateId } });
    }

    expect(await db.user.count({ where: { isDemo: true } })).toBe(1);
  });

  it("returns 403 for demo mutation guards in test, development, preview, and production contexts", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVercelEnv = process.env.VERCEL_ENV;

    const contexts = [
      { nodeEnv: "test", vercelEnv: undefined },
      { nodeEnv: "development", vercelEnv: "development" },
      { nodeEnv: "production", vercelEnv: "preview" },
      { nodeEnv: "production", vercelEnv: "production" },
    ];

    try {
      for (const context of contexts) {
        setEnvironmentVariable("NODE_ENV", context.nodeEnv);
        setEnvironmentVariable("VERCEL_ENV", context.vercelEnv);

        const safeMutationAttempts: Array<
          [label: string, operation: () => Promise<unknown>]
        > = [
          ["central mutation guard", () => requireMutableUser(demoUser.id)],
          [
            "portfolio update",
            () =>
              updatePortfolio(demoUser.id, missingResourceId, {
                name: "Rejected demo mutation",
              }),
          ],
          [
            "portfolio delete",
            () => deletePortfolio(demoUser.id, missingResourceId),
          ],
          [
            "holding create",
            () =>
              createHolding(demoUser.id, {
                portfolioId: missingResourceId,
                ticker: fixtureTicker,
                shares: 1,
                averageCost: 1,
              }),
          ],
          [
            "holding update",
            () =>
              updateHolding(demoUser.id, missingResourceId, {
                shares: 1,
                averageCost: 1,
              }),
          ],
          [
            "holding delete",
            () => deleteHolding(demoUser.id, missingResourceId),
          ],
          [
            "watchlist create",
            () =>
              createWatchlistItem(demoUser.id, {
                ticker: "NOEXIST",
              }),
          ],
          [
            "watchlist delete",
            () => deleteWatchlistItem(demoUser.id, missingResourceId),
          ],
          [
            "watchlist update",
            () =>
              updateWatchlistItem(demoUser.id, missingResourceId, {
                notes: "Rejected demo mutation",
              }),
          ],
          [
            "alert update",
            () =>
              updateAlertStatus(demoUser.id, missingResourceId, {
                status: AlertStatus.RESOLVED,
              }),
          ],
          ["research create", () => runResearch(demoUser.id, "NOEXIST")],
        ];

        for (const [label, operation] of safeMutationAttempts) {
          try {
            await operation();
            throw new Error(`${label} unexpectedly succeeded.`);
          } catch (error) {
            expect(
              error,
              `${label} did not return the demo read-only response in ${context.nodeEnv}/${context.vercelEnv ?? "local"}.`,
            ).toMatchObject({
              code: AuthorizationErrorCode.DEMO_READ_ONLY,
              status: 403,
            });
          }
        }
      }
    } finally {
      setEnvironmentVariable("NODE_ENV", originalNodeEnv);
      setEnvironmentVariable("VERCEL_ENV", originalVercelEnv);
    }

    expect(await readPrivateState(demoUser.id)).toEqual(demoStateBefore);
  });

  it("does not let an ADMIN role bypass private ownership", async () => {
    expect(
      await db.user.findUnique({
        where: { id: ids.admin },
        select: { role: true },
      }),
    ).toEqual({ role: "ADMIN" });

    expect(await getPortfolio(ids.admin, ids.portfolioB)).toBeNull();
    expect(await getOwnedResearchJob(ids.admin, ids.researchB)).toBeNull();
    await expectNotFound(requireOwnedPortfolio(ids.admin, ids.portfolioB));
    await expectNotFound(requireOwnedHolding(ids.admin, ids.holdingAaplB));
    await expectNotFound(
      requireOwnedWatchlistItem(ids.admin, ids.watchlistAaplB),
    );
    await expectNotFound(requireOwnedAlert(ids.admin, ids.alertB));
    await expectNotFound(requireOwnedResearchJob(ids.admin, ids.researchB));
    await expectNotFound(requireOwnedResearchReport(ids.admin, ids.reportB));
    await expectNotFound(
      updatePortfolio(ids.admin, ids.portfolioB, {
        name: "Admin must not bypass ownership",
      }),
    );
    await expectNotFound(deletePortfolio(ids.admin, ids.portfolioB));
  });

  it("keeps public demo analytics, watchlist, and research isolated from same-name private data", async () => {
    expect(
      await db.portfolio.findUnique({
        where: { id: ids.portfolioA },
        select: { name: true, user: { select: { isDemo: true } } },
      }),
    ).toEqual({ name: demoPortfolioName, user: { isDemo: false } });
    expect(
      await db.watchlistItem.count({
        where: { userId: ids.userA, stockId: aaplStock.id },
      }),
    ).toBe(1);
    expect(
      await db.researchJob.count({
        where: { userId: ids.userA, stockId: aaplStock.id },
      }),
    ).toBe(1);

    expect(serializable(await getDemoPortfolioAnalytics("1M"))).toEqual(
      demoAnalyticsBefore,
    );
    expect(serializable(await getDemoWatchlist())).toEqual(demoWatchlistBefore);
    expect(serializable(await getLatestResearch("AAPL"))).toEqual(
      demoResearchBefore,
    );
  });

  it("scopes seeded-provider holdings and alerts to the requested user", async () => {
    const [userAData, userBData, adminData] = await Promise.all([
      seededResearchProvider.getResearchData("AAPL", { userId: ids.userA }),
      seededResearchProvider.getResearchData("AAPL", { userId: ids.userB }),
      seededResearchProvider.getResearchData("AAPL", { userId: ids.admin }),
    ]);

    expect(userAData?.risk.activeAlerts).toEqual([alertTitles.userA]);
    expect(userBData?.risk.activeAlerts).toEqual([alertTitles.userB]);
    expect(adminData?.risk.activeAlerts).toEqual([]);
    expect(userAData?.risk.activeAlerts).not.toContain(alertTitles.userB);
    expect(userBData?.risk.activeAlerts).not.toContain(alertTitles.userA);
    expect(userAData?.risk.portfolioWeight).toBeCloseTo(0.2, 6);
    expect(userBData?.risk.portfolioWeight).toBeCloseTo(1, 6);
    expect(adminData?.risk.portfolioWeight).toBeNull();
  });

  it("enforces intentional Stock RESTRICT foreign keys", async () => {
    const rules = await db.$queryRaw<ForeignKeyRule[]>`
      SELECT
        tc.constraint_name AS "constraintName",
        rc.delete_rule AS "deleteRule"
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_schema = tc.constraint_schema
       AND rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = current_schema()
        AND tc.constraint_name IN (
          'Holding_stockId_fkey',
          'WatchlistItem_stockId_fkey',
          'ResearchJob_stockId_fkey',
          'ResearchReport_stockId_fkey'
        )
    `;
    expect(rules).toHaveLength(4);
    expect(rules.every((rule) => rule.deleteRule === "RESTRICT")).toBe(true);

    let deleteError: unknown;
    try {
      await db.stock.delete({ where: { id: ids.stock } });
    } catch (error) {
      deleteError = error;
    }
    expect(deleteError).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(deleteError).toMatchObject({ code: "P2003" });
    expect(
      await db.stock.findUnique({ where: { id: ids.stock } }),
    ).not.toBeNull();
  });

  it("cascades an owner deletion while preserving shared Stock records", async () => {
    await deleteUserAccount(ids.admin);

    const [
      user,
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
      sharedStock,
    ] = await Promise.all([
      db.user.findUnique({ where: { id: ids.admin } }),
      db.account.count({ where: { userId: ids.admin } }),
      db.session.count({ where: { userId: ids.admin } }),
      db.portfolio.count({ where: { userId: ids.admin } }),
      db.holding.count({ where: { id: ids.holdingAdmin } }),
      db.portfolioSnapshot.count({ where: { id: ids.portfolioSnapshotAdmin } }),
      db.holdingSnapshot.count({ where: { id: ids.holdingSnapshotAdmin } }),
      db.watchlistItem.count({ where: { userId: ids.admin } }),
      db.alert.count({ where: { userId: ids.admin } }),
      db.researchJob.count({ where: { userId: ids.admin } }),
      db.agentRun.count({ where: { id: ids.agentAdmin } }),
      db.researchReport.count({ where: { id: ids.reportAdmin } }),
      db.stock.findUnique({ where: { id: ids.stock }, select: { id: true } }),
    ]);

    expect(user).toBeNull();
    expect([
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
    ]).toEqual(Array.from({ length: 11 }, () => 0));
    expect(sharedStock).toEqual({ id: ids.stock });
    expect(
      await db.user.findUnique({ where: { id: demoUser.id } }),
    ).not.toBeNull();
  });
});
