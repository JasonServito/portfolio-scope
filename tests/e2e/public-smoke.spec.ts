import { expect, test } from "@playwright/test";

test.describe("public production smoke @smoke", () => {
  test("landing page enters the read-only recruiter demo", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /know what moved your portfolio/i,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/no account required/i),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /explore the read-only demo/i })
      .click();
    await expect(page).toHaveURL(/\/dashboard\?demo=true/);
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(/north star portfolio · read-only demo/i),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /follow the evidence/i }),
    ).toBeVisible();
  });

  test("public technical pages expose the architecture and methodology", async ({
    page,
  }) => {
    await page.goto("/architecture");
    await expect(
      page.getByRole("heading", {
        name: /one deployable system/i,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByText("PostgreSQL authority", { exact: false })).toBeVisible();

    await page.getByRole("link", { name: "Methodology" }).first().click();
    await expect(page).toHaveURL(/\/methodology/);
    await expect(
      page.getByRole("heading", {
        name: /transparent inputs/i,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByText("missing ≠ zero", { exact: true })).toBeVisible();
  });

  test("sample research remains public and explicitly deterministic", async ({
    page,
  }) => {
    await page.goto("/research");

    await expect(
      page.getByRole("heading", {
        name: /research that keeps the evidence visible/i,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/does not make external llm calls/i),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /open full stock detail/i }),
    ).toBeVisible();
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
    await expect(
      page.getByText("Fundamentals: SEC EDGAR", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /follow the evidence/i }),
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

  test("sitemap and robots expose only the intended public surface", async ({
    request,
  }) => {
    const [sitemap, robots] = await Promise.all([
      request.get("/sitemap.xml"),
      request.get("/robots.txt"),
    ]);
    const [sitemapBody, robotsBody] = await Promise.all([
      sitemap.text(),
      robots.text(),
    ]);

    expect(sitemap.status()).toBe(200);
    expect(sitemapBody).toContain("/architecture");
    expect(sitemapBody).toContain("/data-sources");

    expect(robots.status()).toBe(200);
    expect(robotsBody).toContain("Disallow: /admin");
    expect(robotsBody).toContain("Disallow: /app");
  });

  test("public and demo navigation remain usable at a mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(
      page.getByRole("navigation", {
        name: "Public navigation on small screens",
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Try demo" }).click();

    await expect(
      page.getByRole("navigation", { name: "Public navigation on small screens" }),
    ).toBeHidden();
    await expect(
      page.getByRole("navigation", {
        name: "Demo workspace navigation on small screens",
      }),
    ).toBeVisible();
  });
});
