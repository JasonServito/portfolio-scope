# PortfolioScope demo script

This script keeps a recruiter or interviewer walkthrough focused on an
understandable stock-dashboard product first, with engineering depth available
in the repository. Allow about two minutes.

Product screens stay focused on investor tasks. Use the repository documentation
when a reviewer wants implementation, security, data-source, or operational detail.

## Before the demo

1. Start PostgreSQL and apply the current migrations.
2. Run `npm run db:seed` so the dataset is deterministic.
3. Run the final quality checks and start the app.
4. Use a desktop viewport around 1440 x 900 and a clean browser window.
5. Open `/` and keep `/dashboard?demo=true` available as a fallback.

Do not describe the seeded market data as live. Do not frame research output as financial advice or a recommendation.

## Walkthrough

### 1. Position the product - 20 seconds

From the landing page, explain that PortfolioScope is a stock dashboard for
managing portfolios, following stocks, and simplifying stock research rather
than trading. Select **Explore the read-only demo**. No account setup is required.

### 2. Show portfolio analytics - 35 seconds

On the dashboard, use step one of **Explore the dashboard**. Call out total
value, cost basis, selected-period return, allocation, and alerts. Change the
period once and show that the chart and rankings update together.

### 3. Open a holding - 30 seconds

Select **Inspect holdings**, then open AAPL. Show the comparable return windows and explain that deterministic snapshots make the demo repeatable and calculations testable.

### 4. Show understandable stock analysis - 25 seconds

On stock detail, distinguish the attributed TradingView market context from the
persisted financial facts. Focus on what the values mean and on clear
missing/stale states. Mention that detailed SEC lineage is preserved internally
and documented in the repository rather than walking through accession and
normalization metadata.

### 5. Inspect research - 20 seconds

Open the research section or `/research`. Explain that the public sample is
prebuilt and read-only. Walk through Summary, Strengths, Risks, and What to
Watch. Expand **Evidence / Sources** and follow a claim citation to its source
details to show that important claims remain reviewable.

### 6. Close with the repository - 10 seconds

Open the repository documentation. Summarize the boundaries: Next.js routes,
typed services, provider adapters, Prisma/PostgreSQL authority, signed jobs,
ephemeral Redis coordination, tests, and CI. External AI remains default-off.

## Checked-in recruiter assets

- Screenshots: `public/screenshots/landing.png`, `dashboard.png`, `holdings.png`, `watchlist.png`, `alerts.png`, `stock-detail.png`, and `research.png`
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
- `research.png` — summary, strengths, risks, what to watch, and the Evidence /
  Sources disclosure
- `watchlist.png` — followed companies with notes and target context
- `ci.png` - optional; add only from a real passing workflow with no sensitive repository details

Capture only real application states. Avoid cropped labels, transient loading states, browser notifications, local paths, secrets, and placeholder data. Re-capture screenshots whenever seeded values or primary layouts materially change.

## Fallbacks

- If the demo redirect is slow, open `/dashboard?demo=true` directly.
- If a chart animation distracts from the walkthrough, wait for it to settle before speaking or capturing.
- If the database is unavailable, stop and restore the seeded environment; do not present error states as the intended demo.
