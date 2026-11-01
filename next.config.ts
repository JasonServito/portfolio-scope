import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
const distDir =
  requestedDistDir && /^[A-Za-z0-9._-]+$/.test(requestedDistDir)
    ? requestedDistDir
    : ".next";

const nextConfig: NextConfig = {
  distDir,
  output: process.env.VERCEL ? undefined : "standalone",
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
