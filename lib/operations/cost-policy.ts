export const monthlyCostPolicy = {
  budgetUsd: 30,
  expectedUsd: { minimum: 1, maximum: 2 },
  services: [
    {
      name: "Neon",
      measure: "Compute, storage, transfer, and restore history",
      guardrail: "Remain on Free until reliability or measured use requires Launch.",
      dashboardUrl: "https://console.neon.tech/",
    },
    {
      name: "Cloudflare R2",
      measure: "Stored bytes plus Class A and Class B operations",
      guardrail: "Keep Standard storage within the free allowance and bounded backup retention.",
      dashboardUrl: "https://dash.cloudflare.com/",
    },
    {
      name: "Upstash",
      measure: "Redis storage/commands and QStash messages",
      guardrail: "Keep schedules and per-run work bounded; configure a budget before any paid plan.",
      dashboardUrl: "https://console.upstash.com/",
    },
    {
      name: "Vercel",
      measure: "Function invocations, duration, transfer, and build use",
      guardrail: "Review before crossing Hobby terms or enabling paid usage.",
      dashboardUrl: "https://vercel.com/dashboard",
    },
    {
      name: "Sentry",
      measure: "Errors, transactions, and source-map releases",
      guardrail: "Start tracing at zero and sample only within the free event budget.",
      dashboardUrl: "https://sentry.io/",
    },
    {
      name: "PostHog",
      measure: "Schema-approved product events",
      guardrail: "No autocapture or replay; review volume before adding events.",
      dashboardUrl: "https://app.posthog.com/",
    },
    {
      name: "GitHub Actions",
      measure: "CI, Playwright, backup, CodeQL, and Gitleaks minutes",
      guardrail: "Use the public-repository allowance and keep scheduled workflows bounded.",
      dashboardUrl: "https://github.com/settings/billing",
    },
  ],
} as const;

export function getCostReview(
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment.LAST_COST_REVIEW_AT?.trim();
  const timestamp = value ? new Date(value) : null;
  return {
    ...monthlyCostPolicy,
    lastReviewedAt:
      timestamp && !Number.isNaN(timestamp.getTime())
        ? timestamp.toISOString()
        : null,
    reference: environment.LAST_COST_REVIEW_REFERENCE?.trim() || null,
  };
}
