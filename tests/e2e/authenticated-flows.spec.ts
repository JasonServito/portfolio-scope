import { randomUUID } from "node:crypto";

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
    await db.$disconnect();
  });

  test("an authenticated user creates a private portfolio", async ({
    context,
    page,
  }) => {
    await authenticate(context, tokenB);
    await page.goto("/app");
    await page.getByLabel("Portfolio name").fill("E2E long-term portfolio");
    await page.getByLabel("Base currency").fill("CAD");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(
      page.getByText("E2E long-term portfolio", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/CAD.*0 holdings/i)).toBeVisible();
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
