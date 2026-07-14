# PortfolioScope demo script

This script keeps a recruiter or interviewer walkthrough focused on the product's strongest engineering signals. Allow about three minutes.

## Before the demo

1. Start PostgreSQL and apply the current migrations.
2. Run `npm run db:seed` so the dataset is deterministic.
3. Run the final quality checks and start the app.
4. Use a desktop viewport around 1440 x 900 and a clean browser window.
5. Open `/` and keep `/dashboard` available as a fallback.

Do not describe the seeded market data as live. Do not frame research output as financial advice or a recommendation.

## Walkthrough

### 1. Position the product — 20 seconds

From the landing page, explain that PortfolioScope emphasizes period-based portfolio analytics and explainable research rather than trading. Select **Continue as demo investor**.

### 2. Show portfolio analytics — 45 seconds

On the dashboard, call out total value, selected-period return, allocation, and winners/losers. Change the period once to demonstrate that the chart and rankings use the same typed analytics layer rather than component-local calculations.

### 3. Compare holdings — 30 seconds

Open **Holdings**. Show the return windows, market value, and total gain/loss columns. Explain that deterministic snapshots make the demo repeatable and calculations testable.

### 4. Explain a risk — 30 seconds

Open **Alerts**, choose a seeded alert, and follow its ticker link. Emphasize that each risk has a visible trigger and severity instead of an opaque score.

### 5. Trace research evidence — 45 seconds

On the stock detail page, open the research area. Move from the overview to one specialist tab and then sources. Explain the pipeline: seeded providers supply facts, focused agents shape findings, and synthesis combines those outputs while retaining warnings and evidence.

### 6. Close on engineering depth — 10 seconds

Summarize the boundaries: Next.js route handlers, domain services, deterministic providers, Prisma/PostgreSQL persistence, focused tests, Docker, and CI. Note that live providers or LLMs can replace seeded adapters later without moving business logic into the UI.

## Screenshot checklist

Store approved images in `public/screenshots/` with descriptive kebab-case names.

- `landing.png` — hero, demo CTA, and product preview visible
- `dashboard.png` — summary, period selector, chart, and supporting cards
- `holdings.png` — table headers and several complete rows
- `alerts.png` — multiple severities and at least one ticker link
- `stock-detail.png` — stock context, chart, position, and related risks
- `research.png` — overview plus visible specialist navigation
- `architecture.png` — rendered README architecture diagram, if a static asset is needed
- `ci.png` — a real passing workflow run with no sensitive repository details

Capture only real application states. Avoid cropped labels, transient loading states, browser notifications, local paths, secrets, and placeholder data. Re-capture screenshots whenever seeded values or primary layouts materially change.

## Fallbacks

- If the demo redirect is slow, open `/dashboard?demo=true` directly.
- If a chart animation distracts from the walkthrough, wait for it to settle before speaking or capturing.
- If the database is unavailable, stop and restore the seeded environment; do not present error states as the intended demo.
