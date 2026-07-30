import { expect, test } from "@playwright/test";

test.describe("public production smoke @smoke", () => {
  test("landing page enters the read-only recruiter demo", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "PortfolioScope", level: 1 }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /continue as demo investor/i })
      .click();
    await expect(page).toHaveURL(/\/dashboard\?demo=true/);
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Demo portfolio", { exact: true })).toBeVisible();
  });

  test("public stock page preserves SEC and TradingView boundaries", async ({
    page,
  }) => {
    await page.route(/tradingview\.com/, (route) => route.abort());
    await page.goto("/stocks/AAPL");

    await expect(
      page.getByRole("heading", { name: "AAPL", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("SEC-derived fundamentals", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/market chart and quote data are provided by tradingview/i),
    ).toBeVisible();
  });

  test("authentication entry and protected redirect remain controlled", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fapp/);
    await expect(
      page.getByRole("heading", { name: "Sign in to PortfolioScope" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /continue with the read-only demo/i }),
    ).toBeVisible();
  });

  test("health responds with correlation and security headers", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "portfolioscope",
    });
    expect(response.headers()["x-request-id"]).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
