import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3100";
const screenshotsDir = path.resolve("public", "screenshots");
const demoDir = path.resolve("public", "demo");

await Promise.all([
  mkdir(screenshotsDir, { recursive: true }),
  mkdir(demoDir, { recursive: true }),
]);

const browser = await chromium.launch({ headless: true });

const screenshotContext = await browser.newContext({
  colorScheme: "light",
  deviceScaleFactor: 1,
  viewport: { width: 1440, height: 1000 },
});
const screenshotPage = await screenshotContext.newPage();

const captures = [
  { route: "/", filename: "landing.png", fullPage: false },
  {
    route: "/dashboard?demo=true",
    filename: "dashboard.png",
    fullPage: false,
  },
  { route: "/holdings", filename: "holdings.png", fullPage: false },
  { route: "/alerts", filename: "alerts.png", fullPage: false },
  {
    route: "/stocks/aapl",
    filename: "stock-detail.png",
    fullPage: false,
  },
  { route: "/research", filename: "research.png", fullPage: true },
  { route: "/watchlist", filename: "watchlist.png", fullPage: false },
];

for (const { route, filename, fullPage } of captures) {
  await screenshotPage.goto(new URL(route, baseUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  if (route.startsWith("/dashboard")) {
    await screenshotPage.waitForSelector(".recharts-surface", {
      timeout: 10_000,
    });
  }
  await screenshotPage.waitForTimeout(
    route.startsWith("/stocks/") ? 2_500 : 1_500,
  );
  await screenshotPage.evaluate(() => window.scrollTo(0, 0));
  await screenshotPage.screenshot({
    animations: "disabled",
    fullPage,
    path: path.join(screenshotsDir, filename),
  });
}

await screenshotContext.close();

const videoWorkDir = path.join(demoDir, ".capture");
await rm(videoWorkDir, { recursive: true, force: true });
await mkdir(videoWorkDir, { recursive: true });
const videoContext = await browser.newContext({
  colorScheme: "light",
  recordVideo: {
    dir: videoWorkDir,
    size: { width: 1280, height: 720 },
  },
  viewport: { width: 1280, height: 720 },
});
const videoPage = await videoContext.newPage();
const video = videoPage.video();

await videoPage.goto(new URL("/", baseUrl).toString(), {
  waitUntil: "domcontentloaded",
});
await videoPage.waitForTimeout(1_400);
await videoPage
  .getByRole("link", { name: /explore the read-only demo/i })
  .click();
await videoPage.waitForTimeout(1_400);
await videoPage.goto(new URL("/holdings", baseUrl).toString(), {
  waitUntil: "domcontentloaded",
});
await videoPage.waitForTimeout(1_400);
await videoPage.goto(new URL("/stocks/aapl", baseUrl).toString(), {
  waitUntil: "domcontentloaded",
});
await videoPage.waitForTimeout(1_600);
await videoPage.locator("#fundamentals").scrollIntoViewIfNeeded();
await videoPage.waitForTimeout(1_400);
await videoPage.locator("#research").scrollIntoViewIfNeeded();
await videoPage.waitForTimeout(1_400);

await videoPage.close();
await videoContext.close();

if (!video) {
  throw new Error("Playwright did not create a recruiter-tour recording.");
}

const recordedPath = await video.path();
const finalVideoPath = path.join(demoDir, "recruiter-tour.webm");
await rm(finalVideoPath, { force: true });
try {
  await rename(recordedPath, finalVideoPath);
} catch {
  await copyFile(recordedPath, finalVideoPath);
}
await rm(videoWorkDir, { recursive: true, force: true });
await browser.close();

console.log(`Captured ${captures.length} screenshots in ${screenshotsDir}`);
console.log(`Captured recruiter tour at ${finalVideoPath}`);
