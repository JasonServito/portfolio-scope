import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3200";
const runs = Number.parseInt(
  process.env.M22_MEASUREMENT_RUNS?.trim() || "5",
  10,
);
const databaseUrl = process.env.DATABASE_URL?.trim();

function assertSafeMeasurementEnvironment() {
  const target = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("M22 measurements require a loopback application URL.");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for authenticated measurements.");
  }
  const database = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) {
    throw new Error("M22 measurements require a loopback PostgreSQL database.");
  }
  if (!Number.isInteger(runs) || runs < 2 || runs > 20) {
    throw new Error("M22_MEASUREMENT_RUNS must be an integer from 2 to 20.");
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function summarize(samples, fields) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      {
        median: round(median(samples.map((sample) => sample[field]))),
        samples: samples.map((sample) => round(sample[field])),
      },
    ]),
  );
}

function representativeRequestTrace(samples) {
  return samples.at(-1)?.requests ?? [];
}

function collectApplicationRequests(page) {
  const requests = [];
  const target = new URL(baseUrl);
  const listener = (request) => {
    const url = new URL(request.url());
    if (
      url.origin === target.origin &&
      !url.pathname.startsWith("/_next/static/") &&
      !url.pathname.startsWith("/_next/image/")
    ) {
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  };
  page.on("request", listener);
  return {
    requests,
    stop: () => page.off("request", listener),
  };
}

async function blockExternalTraffic(page) {
  const target = new URL(baseUrl);
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== target.origin) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function measureRoute(context, scenario) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const page = await context.newPage();
    await blockExternalTraffic(page);
    const trace = collectApplicationRequests(page);
    const startedAt = performance.now();
    const response = await page.goto(
      new URL(scenario.path, baseUrl).toString(),
      {
        waitUntil: "domcontentloaded",
      },
    );
    await scenario.ready(page);
    const readyMs = performance.now() - startedAt;
    await page.waitForTimeout(500);
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry
        ? {
            ttfbMs: entry.responseStart,
            responseMs: entry.responseEnd,
            domContentLoadedMs: entry.domContentLoadedEventEnd,
          }
        : { ttfbMs: 0, responseMs: 0, domContentLoadedMs: 0 };
    });
    trace.stop();
    samples.push({
      ...navigation,
      readyMs,
      requestCount: trace.requests.length,
      requests: trace.requests,
      status: response?.status() ?? 0,
    });
    await page.close();
  }
  return {
    name: scenario.name,
    path: scenario.path,
    requestTrace: representativeRequestTrace(samples),
    status: samples.map((sample) => sample.status),
    metrics: summarize(samples, [
      "ttfbMs",
      "responseMs",
      "domContentLoadedMs",
      "readyMs",
      "requestCount",
    ]),
  };
}

async function measureClientNavigation(context) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const page = await context.newPage();
    await page.goto(new URL("/app", baseUrl).toString());
    await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
    await page.waitForTimeout(500);
    const trace = collectApplicationRequests(page);
    const startedAt = await page.evaluate(() => performance.now());
    await page
      .getByRole("navigation", { name: "Private workspace navigation" })
      .getByRole("link", { name: "Watchlist" })
      .evaluate((link) => link.click());
    await page.waitForFunction(
      () =>
        document.querySelector('main[aria-label="Loading account view"]') ||
        [...document.querySelectorAll("h1")].some(
          (heading) => heading.textContent === "Your watchlist",
        ),
    );
    const feedbackMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page
      .getByRole("heading", { name: "Your watchlist", level: 1 })
      .waitFor();
    const readyMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page.waitForTimeout(300);
    trace.stop();
    samples.push({
      feedbackMs,
      readyMs,
      requestCount: trace.requests.length,
      requests: trace.requests,
    });
    await page.close();
  }
  return {
    name: "authenticated dashboard to watchlist",
    requestTrace: representativeRequestTrace(samples),
    metrics: summarize(samples, ["feedbackMs", "readyMs", "requestCount"]),
  };
}

async function measurePortfolioCreation(context, db, userId) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    await db.portfolio.deleteMany({ where: { userId } });
    const page = await context.newPage();
    await page.goto(new URL("/app", baseUrl).toString());
    await page.waitForTimeout(500);
    const name = `M22 measured portfolio ${run + 1}`;
    await page.getByLabel("Portfolio name").fill(name);
    const trace = collectApplicationRequests(page);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/portfolios",
    );
    const startedAt = await page.evaluate(() => performance.now());
    await page
      .getByRole("button", { name: "Create" })
      .evaluate((button) => button.click());
    const response = await responsePromise;
    const apiMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page.getByText(name, { exact: true }).waitFor();
    const settledMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page.waitForTimeout(300);
    trace.stop();
    samples.push({
      apiMs,
      settledMs,
      requestCount: trace.requests.length,
      requests: trace.requests,
      status: response.status(),
    });
    await page.close();
  }
  await db.portfolio.deleteMany({ where: { userId } });
  return {
    name: "authenticated portfolio creation",
    requestTrace: representativeRequestTrace(samples),
    status: samples.map((sample) => sample.status),
    metrics: summarize(samples, ["apiMs", "settledMs", "requestCount"]),
  };
}

async function measureWatchlistCreation(context, db, userId, stockId) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    await db.watchlistItem.deleteMany({ where: { userId, stockId } });
    const page = await context.newPage();
    await page.goto(new URL("/app/watchlist", baseUrl).toString());
    await page.waitForTimeout(500);
    await page.getByLabel("Ticker").fill("AAPL");
    const trace = collectApplicationRequests(page);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/watchlist",
    );
    const startedAt = await page.evaluate(() => performance.now());
    await page
      .getByRole("button", { name: "Add", exact: true })
      .evaluate((button) => button.click());
    const response = await responsePromise;
    const apiMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page.getByRole("link", { name: /AAPL/ }).waitFor();
    const settledMs = await page.evaluate(
      (started) => performance.now() - started,
      startedAt,
    );
    await page.waitForTimeout(300);
    trace.stop();
    samples.push({
      apiMs,
      settledMs,
      requestCount: trace.requests.length,
      requests: trace.requests,
      status: response.status(),
    });
    await page.close();
  }
  await db.watchlistItem.deleteMany({ where: { userId, stockId } });
  return {
    name: "authenticated watchlist creation",
    requestTrace: representativeRequestTrace(samples),
    status: samples.map((sample) => sample.status),
    metrics: summarize(samples, ["apiMs", "settledMs", "requestCount"]),
  };
}

assertSafeMeasurementEnvironment();

const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const runId = randomUUID();
const sessionToken = `m22-${runId}`;
let userId;

try {
  const user = await db.user.create({
    data: {
      email: `m22-${runId}@example.test`,
      name: "M22 Measurement User",
      sessions: {
        create: {
          sessionToken,
          expires: new Date(Date.now() + 60 * 60 * 1_000),
        },
      },
    },
  });
  userId = user.id;
  const stock = await db.stock.findUniqueOrThrow({
    where: { ticker: "AAPL" },
    select: { id: true },
  });

  const anonymousContext = await browser.newContext();
  const authenticatedContext = await browser.newContext();
  const applicationUrl = new URL(baseUrl);
  await authenticatedContext.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: applicationUrl.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: applicationUrl.protocol === "https:",
      expires: Math.floor(Date.now() / 1_000) + 60 * 60,
    },
  ]);

  const routeResults = [];
  for (const scenario of [
    {
      name: "public landing",
      path: "/",
      ready: (page) =>
        page
          .getByRole("heading", {
            name: /know what moved your portfolio/i,
            level: 1,
          })
          .waitFor(),
    },
    {
      name: "public stock detail",
      path: "/stocks/aapl",
      ready: (page) =>
        page.getByRole("heading", { name: "AAPL", level: 1 }).waitFor(),
    },
    {
      name: "read-only demo dashboard",
      path: "/dashboard?demo=true",
      ready: (page) =>
        page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor(),
    },
  ]) {
    routeResults.push(await measureRoute(anonymousContext, scenario));
  }
  routeResults.push(
    await measureRoute(authenticatedContext, {
      name: "authenticated dashboard",
      path: "/app",
      ready: (page) =>
        page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor(),
    }),
  );
  routeResults.push(
    await measureRoute(authenticatedContext, {
      name: "authenticated watchlist",
      path: "/app/watchlist",
      ready: (page) =>
        page
          .getByRole("heading", { name: "Your watchlist", level: 1 })
          .waitFor(),
    }),
  );

  const result = {
    conditions: {
      baseUrl,
      database: "isolated loopback PostgreSQL",
      externalTraffic: "blocked",
      browser: "headless Chromium",
      mode: process.env.NODE_ENV || "unspecified",
      runs,
    },
    routes: routeResults,
    interactions: [
      await measureClientNavigation(authenticatedContext),
      await measurePortfolioCreation(authenticatedContext, db, user.id),
      await measureWatchlistCreation(
        authenticatedContext,
        db,
        user.id,
        stock.id,
      ),
    ],
  };

  await anonymousContext.close();
  await authenticatedContext.close();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  if (userId) {
    await db.user.deleteMany({ where: { id: userId } });
  }
  await db.$disconnect();
}
