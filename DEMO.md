# PortfolioScope demo script

This script keeps a recruiter or interviewer walkthrough focused on the product's strongest engineering signals. Allow about two minutes.

## Before the demo

1. Start PostgreSQL and apply the current migrations.
2. Run `npm run db:seed` so the dataset is deterministic.
3. Run the final quality checks and start the app.
4. Use a desktop viewport around 1440 x 900 and a clean browser window.
5. Open `/` and keep `/dashboard?demo=true` available as a fallback.

Do not describe the seeded market data as live. Do not frame research output as financial advice or a recommendation.

## Walkthrough

### 1. Position the product - 20 seconds

From the landing page, explain that PortfolioScope emphasizes period-based portfolio analytics and source-backed research rather than trading. Select **Explore the read-only demo**. No OAuth or account setup is required.

### 2. Show portfolio analytics - 35 seconds

On the dashboard, use step one of **Follow the evidence**. Call out total value, cost basis, selected-period return, allocation, and alerts. Change the period once to demonstrate that the chart and rankings use the same typed analytics layer rather than component-local calculations.

### 3. Open a holding - 30 seconds

Select **Inspect holdings**, then open AAPL. Show the comparable return windows and explain that deterministic snapshots make the demo repeatable and calculations testable.

### 4. Trace the evidence - 25 seconds

On stock detail, distinguish the attributed TradingView widget from the persisted SEC facts. Point out filing period, accession, retrieval time, units, normalization version, freshness, and explicit missing-data states.

### 5. Inspect research - 20 seconds

Open the research section or `/research`. Explain that this M17 sample is deterministic and makes no external LLM calls. Show that findings, counterpoints, risks, missing data, and sources remain separate and visible.

### 6. Close on engineering depth - 10 seconds

Use the final tour step to open `/architecture`, then follow the repository link if time permits. Summarize the boundaries: Next.js routes, typed services, provider adapters, Prisma/PostgreSQL authority, signed jobs, ephemeral Redis coordination, tests, and CI.

## Checked-in recruiter assets

- Screenshots: `public/screenshots/landing.png`, `dashboard.png`, `holdings.png`, `alerts.png`, `stock-detail.png`, `research.png`, and `architecture.png`
- Short recording: `public/demo/recruiter-tour.webm`
- Social preview: `public/og.png`

With the local seeded app running on port 3100, regenerate the assets and run the repeatable browser lab with:

```powershell
$env:E2E_BASE_URL = "http://127.0.0.1:3100"
npm run demo:capture
npm run demo:vitals
```

The browser lab is a local regression signal, not a substitute for deployed Core Web Vitals or real-user testing.

## Screenshot checklist

Store approved images in `public/screenshots/` with descriptive kebab-case names.

- `landing.png` — hero, demo CTA, and product preview visible
- `dashboard.png` — summary, period selector, chart, and supporting cards
- `holdings.png` — table headers and several complete rows
- `alerts.png` — multiple severities and at least one ticker link
- `stock-detail.png` — stock context, chart, position, and related risks
- `research.png` — overview plus visible specialist navigation
- `architecture.png` — rendered README architecture diagram, if a static asset is needed
- `ci.png` - optional; add only from a real passing workflow with no sensitive repository details

Capture only real application states. Avoid cropped labels, transient loading states, browser notifications, local paths, secrets, and placeholder data. Re-capture screenshots whenever seeded values or primary layouts materially change.

## Fallbacks

- If the demo redirect is slow, open `/dashboard?demo=true` directly.
- If a chart animation distracts from the walkthrough, wait for it to settle before speaking or capturing.
- If the database is unavailable, stop and restore the seeded environment; do not present error states as the intended demo.
