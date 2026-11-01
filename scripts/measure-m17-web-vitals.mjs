import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3100";
const routes = ["/", "/dashboard?demo=true", "/stocks/aapl"];
const browser = await chromium.launch({ headless: true });
const results = [];

for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__m17Vitals = { cls: 0, lcp: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__m17Vitals.lcp = entry.startTime;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__m17Vitals.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(new URL(route, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(route.startsWith("/stocks/") ? 2_500 : 1_200);
  results.push(
    await page.evaluate((pathname) => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const firstContentfulPaint = performance
        .getEntriesByName("first-contentful-paint")
        .at(0);
      return {
        route: pathname,
        ttfbMs: Math.round(navigation?.responseStart ?? 0),
        fcpMs: Math.round(firstContentfulPaint?.startTime ?? 0),
        lcpMs: Math.round(window.__m17Vitals?.lcp ?? 0),
        cls: Number((window.__m17Vitals?.cls ?? 0).toFixed(4)),
      };
    }, route),
  );
  await page.close();
}

await browser.close();
console.table(results);
