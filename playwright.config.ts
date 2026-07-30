import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL?.trim();
const localPort = process.env.E2E_PORT?.trim() || (process.env.CI ? "3000" : "3100");
const baseURL = externalBaseUrl || `http://127.0.0.1:${localPort}`;

if (!externalBaseUrl) {
  process.env.AUTH_URL = baseURL;
  process.env.NEXT_PUBLIC_APP_URL = baseURL;
  process.env.AUTH_TRUST_HOST = "true";
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${localPort}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
