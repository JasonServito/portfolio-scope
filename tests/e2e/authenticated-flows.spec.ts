import { randomUUID } from "node:crypto";

import {
  AgentName,
  AgentStatus,
  ResearchGenerationMode,
  ResearchStatus,
  type UpcomingEarningsState,
} from "@prisma/client";
import { expect, test, type BrowserContext } from "@playwright/test";

import { db } from "@/lib/db";

const runId = randomUUID();
const emailA = `e2e-m16-a-${runId}@example.test`;
const emailB = `e2e-m16-b-${runId}@example.test`;
const tokenA = `e2e-m16-a-${runId}`;
const tokenB = `e2e-m16-b-${runId}`;
let userAId = "";
let userBId = "";
let portfolioAId = "";
let currentResearchJobId = "";
let previousEarningsState: UpcomingEarningsState | null = null;
let earningsStockId = "";

async function createResearchFixture(input: {
  userId: string;
  stockId: string;
  createdAt: Date;
  statement: string;
  snapshotHash: string;
}) {
  const job = await db.researchJob.create({
    data: {
      userId: input.userId,
      stockId: input.stockId,
      status: ResearchStatus.COMPLETED,
      generationMode: ResearchGenerationMode.EXTERNAL,
      requestedAgents: [AgentName.SYNTHESIS],
      generationFingerprint: `${runId}-${input.snapshotHash}`,
      sourceDataVersion: `${input.snapshotHash}-source`,
      inputDataVersion: `${input.snapshotHash}-input`,
      retrievalVersion: "m18-lexical-e2e",
      calculationVersion: "portfolio-e2e",
      sourceSnapshotSha256: input.snapshotHash.padEnd(64, "a").slice(0, 64),
      createdAt: input.createdAt,
      startedAt: input.createdAt,
      completedAt: new Date(input.createdAt.getTime() + 60_000),
      correlationId: `${runId}-${input.snapshotHash}`,
    },
  });
  const synthesis = await db.agentRun.create({
    data: {
      researchJobId: job.id,
      agentName: AgentName.SYNTHESIS,
      status: AgentStatus.COMPLETED,
      rating: "MIXED",
      confidence: 0.72,
      summary: input.statement,
      findingsJson: [],
      sourcesJson: [],
      warningsJson: [],
      claimsJson: [],
      missingDataJson: ["Licensed current news"],
      provider: "openai",
      model: "gpt-5-mini-2025-08-07",
      promptVersion: "m18-research-e2e",
      outputSchemaVersion: "m18-claims-e2e",
      agentVersion: "m18-synthesis-e2e",
      completedAt: new Date(input.createdAt.getTime() + 60_000),
    },
  });
  const report = await db.researchReport.create({
    data: {
      researchJobId: job.id,
      stockId: input.stockId,
      overview: input.statement,
      rating: "MIXED",
      bullCaseJson: [input.statement],
      bearCaseJson: ["Liability evidence remains a counterpoint."],
      risksJson: ["Evidence coverage is bounded."],
      missingDataJson: ["Licensed current news"],
      disagreementsJson: ["Revenue and liability context diverge."],
      confidence: 0.72,
      provider: "openai",
      model: "gpt-5-mini-2025-08-07",
      modelConfigJson: { maxOutputTokens: 1_500 },
      promptVersion: "m18-research-e2e",
      retrievalVersion: "m18-lexical-e2e",
      calculationVersion: "portfolio-e2e",
      inputDataVersion: `${input.snapshotHash}-input`,
      outputSchemaVersion: "m18-claims-e2e",
      sourceSnapshotSha256: input.snapshotHash.padEnd(64, "a").slice(0, 64),
      inputTokens: 120,
      outputTokens: 45,
      estimatedCostUsd: 0.00012,
      reportVersion: "m18-report-e2e",
      generatedAt: new Date(input.createdAt.getTime() + 60_000),
      expiresAt: new Date(input.createdAt.getTime() + 31 * 24 * 60 * 60_000),
    },
  });
  await db.researchClaim.create({
    data: {
      reportId: report.id,
      agentRunId: synthesis.id,
      claimKey: `${input.snapshotHash}-revenue-claim`,
      category: "SUPPORTIVE",
      statement: input.statement,
      confidence: 0.78,
      assumptionsJson: ["Reported periods are comparable."],
      sourceDate: new Date("2026-06-30T00:00:00.000Z"),
      asOfDate: new Date("2026-08-11T00:00:00.000Z"),
      ordinal: 0,
      evidence: {
        create: {
          role: "SUPPORTING",
          referenceKey: `ev_${input.snapshotHash}_revenue`,
          ordinal: 0,
          sourceKind: "SEC_FACT",
          title: "AAPL revenue filing evidence",
          sourceReference: `sec://e2e/${input.snapshotHash}/revenue`,
          accessionNumber: "0000320193-26-000001",
          section: "Revenue",
          sourceUrl: "https://www.sec.gov/Archives/e2e-revenue",
          sourceDate: new Date("2026-06-30T00:00:00.000Z"),
          excerpt:
            "The filing reports bounded revenue evidence for the period.",
          metadataJson: { fixture: "authenticated-e2e" },
        },
      },
    },
  });
  return job;
}

function safeLocalDatabase() {
  if (process.env.E2E_BASE_URL?.trim()) return false;
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]") &&
      /portfolio[_-]scope/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

async function authenticate(context: BrowserContext, token: string) {
  const url = new URL(
    process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000",
  );
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
      expires: Math.floor(Date.now() / 1_000) + 60 * 60,
    },
  ]);
}

test.describe("authenticated production boundaries", () => {
  test.skip(
    !safeLocalDatabase(),
    "Authenticated E2E fixtures require a loopback PortfolioScope database.",
  );

  test.beforeAll(async () => {
    const expires = new Date(Date.now() + 60 * 60 * 1_000);
    const [userA, userB] = await Promise.all([
      db.user.create({
        data: {
          email: emailA,
          name: "E2E User A",
          sessions: { create: { sessionToken: tokenA, expires } },
        },
      }),
      db.user.create({
        data: {
          email: emailB,
          name: "E2E User B",
          sessions: { create: { sessionToken: tokenB, expires } },
        },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    const portfolio = await db.portfolio.create({
      data: {
        userId: userA.id,
        name: "User A private boundary",
        baseCurrency: "USD",
      },
    });
    portfolioAId = portfolio.id;
    const stock = await db.stock.findUniqueOrThrow({
      where: { ticker: "AAPL" },
      select: { id: true },
    });
    earningsStockId = stock.id;
    previousEarningsState = await db.upcomingEarningsState.findUnique({
      where: { stockId: stock.id },
    });
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 14);
    eventDate.setUTCHours(0, 0, 0, 0);
    await Promise.all([
      db.holding.create({
        data: {
          portfolioId: portfolio.id,
          stockId: stock.id,
          shares: 1,
          averageCost: 150,
          costBasis: 150,
        },
      }),
      db.upcomingEarningsState.upsert({
        where: { stockId: stock.id },
        update: {
          eventDate,
          fetchedAt: new Date(),
          marketSession: "AFTER_MARKET",
          source: "M26 persisted browser fixture",
        },
        create: {
          stockId: stock.id,
          eventDate,
          fetchedAt: new Date(),
          marketSession: "AFTER_MARKET",
          source: "M26 persisted browser fixture",
        },
      }),
    ]);
    await db.alert.create({
      data: {
        userId: userB.id,
        stockId: stock.id,
        type: "WATCHLIST_MOVE",
        severity: "MEDIUM",
        title: "Review AAPL target",
        message: "AAPL reached the configured review point.",
      },
    });
    const currentCreatedAt = new Date();
    await createResearchFixture({
      userId: userA.id,
      stockId: stock.id,
      createdAt: new Date(currentCreatedAt.getTime() - 24 * 60 * 60_000),
      statement: "Prior-period revenue evidence was bounded.",
      snapshotHash: "previous",
    });
    const current = await createResearchFixture({
      userId: userA.id,
      stockId: stock.id,
      createdAt: currentCreatedAt,
      statement: "Current revenue evidence supports a bounded claim.",
      snapshotHash: "current",
    });
    currentResearchJobId = current.id;
  });

  test.afterAll(async () => {
    if (userAId || userBId) {
      await db.user.deleteMany({
        where: {
          id: { in: [userAId, userBId].filter(Boolean) },
          email: { in: [emailA, emailB] },
        },
      });
    }
    if (earningsStockId) {
      await db.upcomingEarningsState.deleteMany({
        where: { stockId: earningsStockId },
      });
      if (previousEarningsState) {
        await db.upcomingEarningsState.create({ data: previousEarningsState });
      }
    }
    await db.$disconnect();
  });

  test("an authenticated user creates a private portfolio", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.goto("/app");
    const privateNavigation = page.getByRole("navigation", {
      name: "Private workspace navigation",
    });
    await expect(privateNavigation).toBeVisible();
    await expect(
      privateNavigation.getByRole("link", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(
      privateNavigation.getByRole("link", { name: "Watchlist" }),
    ).toBeVisible();
    await expect(
      privateNavigation.getByRole("link", { name: "Earnings" }),
    ).toBeVisible();
    await expect(
      privateNavigation.getByRole("link", { name: "Alerts" }),
    ).toBeVisible();
    await expect(
      privateNavigation.getByRole("link", { name: "Research" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Architecture" })).toHaveCount(
      0,
    );
    await page.getByLabel("Portfolio name").fill("E2E long-term portfolio");
    await page.getByLabel("Base currency").fill("CAD");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(
      page.getByText("E2E long-term portfolio", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/CAD.*0 holdings/i)).toBeVisible();

    await page.getByRole("link", { name: "Open", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "E2E long-term portfolio" }),
    ).toBeVisible();
    await page.getByLabel("Name").fill("E2E managed portfolio");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Portfolio settings were saved.",
    );

    await page.getByLabel("Ticker").fill("AAPL");
    await page.getByLabel("Shares").fill("2");
    await page.getByLabel("Average cost").fill("150");
    await page.getByRole("button", { name: "Add holding" }).click();
    await expect(page.getByText("Apple Inc.", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "AAPL was added to this portfolio.",
    );
  });

  test("an authenticated user adds, edits, and removes a watchlist item", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.goto("/app/watchlist");

    await page.getByLabel("Ticker").fill("MSFT");
    await page.getByLabel("Target price").fill("500");
    await page.getByLabel("Notes").fill("Review cloud growth.");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "MSFT was added to your watchlist.",
    );
    await expect(page.getByText("Review cloud growth.")).toBeVisible();
    await expect(
      page.getByText("Latest price:", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Cached demo price.*stale/i)).toBeVisible();
    await expect(page.getByText(/\$[\d,.]+ USD/).first()).toBeVisible();

    await page.getByRole("button", { name: "Edit MSFT" }).click();
    await page.getByLabel("MSFT target price").fill("510");
    await page.getByLabel("MSFT notes").fill("Updated cloud thesis.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText(
      "MSFT target price and notes were updated.",
    );
    await expect(page.getByText("Updated cloud thesis.")).toBeVisible();
    await expect(page.getByText("$510.00")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove MSFT" }).click();
    await expect(page.getByRole("status")).toContainText(
      "MSFT was removed from your watchlist.",
    );
    await expect(page.getByText(/your watchlist is empty/i)).toBeVisible();

    await page.getByLabel("Ticker").fill("JPM");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "JPM was added to your watchlist.",
    );
    await expect(
      page.getByText("Latest price: Unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No cached demo observation is available."),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove JPM" }).click();
    await expect(page.getByText(/your watchlist is empty/i)).toBeVisible();
  });

  test("an authenticated user resolves and reopens an owned alert", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.goto("/app/alerts");

    await expect(page.getByText("Review AAPL target")).toBeVisible();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Review AAPL target was resolved.",
    );
    await expect(page.getByText("resolved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Review AAPL target was reopened.",
    );
    await expect(page.getByText("active", { exact: true })).toBeVisible();
  });

  test("authenticated Create and Add controls fit a mobile viewport", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    await page.goto("/app/watchlist");
    await expect(
      page.getByRole("button", { name: "Add", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });

  test("a second user cannot open another user's portfolio", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    const response = await page.goto(`/app/portfolios/${portfolioAId}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByText(/page could not be found/i)).toBeVisible();
  });

  test("a standard user is rejected from admin diagnostics", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/auth\/denied/);
    await expect(
      page.getByRole("heading", {
        name: /administrator access required/i,
      }),
    ).toBeVisible();
  });

  test("an owner opens research history, report diff, and a claim citation", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenA);
    await page.goto("/app/research");
    await expect(
      page.getByRole("heading", { name: "Your research" }),
    ).toBeVisible();
    await page
      .locator(`a[href="/app/research/${currentResearchJobId}"]`, {
        hasText: "Open private report",
      })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/app/research/${currentResearchJobId}$`),
    );
    await expect(
      page.getByText("AI-assisted", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Changes from previous report")).toBeVisible();
    await expect(
      page
        .getByText("Current revenue evidence supports a bounded claim.")
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Report: m18-report-e2e")).toHaveCount(0);

    await page
      .getByRole("button", { name: "AAPL revenue filing evidence" })
      .click();
    await expect(
      page.getByText("Source registry", { exact: true }),
    ).toBeVisible();
    const evidence = page.locator("[id^='evidence-ev_current_revenue']");
    await expect(evidence).toBeVisible();
    await expect(evidence).toBeFocused();
  });

  test("an owner sees the persisted earnings observation for a holding", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenA);
    await page.goto("/app/earnings");

    await expect(
      page.getByRole("heading", { name: "Upcoming earnings" }),
    ).toBeVisible();
    const earnings = page.locator("[data-upcoming-earnings]");
    await expect(earnings.getByText("AAPL", { exact: true })).toBeVisible();
    await expect(earnings.getByText("Expected", { exact: true })).toBeVisible();
    await expect(earnings.getByText("After market close")).toBeVisible();
    await expect(earnings.getByText("Holding", { exact: true })).toBeVisible();
    await expect(
      earnings.getByText(/M26 persisted browser fixture/),
    ).toBeVisible();
  });

  test("a second user cannot open another user's research report", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    const response = await page.goto(`/app/research/${currentResearchJobId}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByText(/page could not be found/i)).toBeVisible();
  });

  test("sign-out revokes the browser session", async ({ context, page }) => {
    await authenticate(context, tokenB);
    await page.goto("/app");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect
      .poll(() =>
        db.session.findUnique({
          where: { sessionToken: tokenB },
          select: { id: true },
        }),
      )
      .toBeNull();

    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});
