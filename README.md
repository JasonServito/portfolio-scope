# PortfolioScope

PortfolioScope is a full-stack portfolio analytics and explainable stock-research demo built for long-term investors. It combines period-based performance, holding contribution analysis, deterministic risk alerts, and specialist research agents in a polished recruiter-ready experience.

> This is an educational analytics demo, not a brokerage or financial-advice product. PortfolioScope fundamentals come from SEC EDGAR when ingested, market charts are attributed TradingView widgets, and portfolio/research fixtures remain deterministic and seeded. Optional AI research interprets only supplied public evidence; it is disabled by default and is not itself a financial-data source. The app does not place trades, predict prices, or issue buy/sell/hold recommendations.

## Product highlights

- Portfolio performance across 1D, 1W, 1M, 3M, and 1Y periods
- Holding-level returns, gain/loss, allocation, and contribution analysis
- Winners, losers, sector allocation, and portfolio value history
- Explainable, rule-based concentration, drawdown, price-move, and watchlist alerts
- Stock detail views with attributed TradingView charts and SEC-derived fundamentals
- Filing-level source, period, retrieval, freshness, and normalization provenance
- Private R2 retention for raw SEC submissions and Company Facts payloads
- Evidence-grounded research agents with claim citations, counter-evidence, missing-data states, history, and report diffs
- Deterministic and recorded model providers plus a default-off, budget-capped OpenAI provider
- Deterministic seeded data for a stable, repeatable demo
- GitHub and Google OAuth through Auth.js with revocable database sessions
- Server-controlled USER and ADMIN roles, protected routes, and account deletion
- Owner-scoped private portfolios, holdings, watchlists, alerts, and research history
- A database-marked public demo that stays read-only in every environment
- PostgreSQL-authoritative jobs with signed QStash delivery, bounded retries, attempt history, and admin controls
- Redis-backed short caches, per-company locks, and per-user/IP abuse limits without permanent Redis state
- Responsive Next.js UI backed by typed services, APIs, Prisma, and PostgreSQL

## Product tour

The public landing page leads directly into a four-step, read-only recruiter journey: portfolio overview, holding detail, source-backed evidence, and architecture. The checked-in assets are generated from the real seeded application with `npm run demo:capture`; the narration and fallback path are in [`DEMO.md`](DEMO.md).

![PortfolioScope landing page](public/screenshots/landing.png)

| View         | What it demonstrates                                            |
| ------------ | --------------------------------------------------------------- |
| Landing      | Clear product positioning and one-click demo entry              |
| Dashboard    | Period analytics, allocation, winners/losers, and alert context |
| Holdings     | Comparable return windows and position-level performance        |
| Alerts       | Transparent risk rules with links to affected securities        |
| Stock detail | Price, position, risks, and explainable specialist research     |
| Architecture | System boundaries, source flow, security, and reliability       |

The short walkthrough recording is available at [`public/demo/recruiter-tour.webm`](public/demo/recruiter-tour.webm).

### Resume-ready project summary

- Built a production-oriented Next.js 15 portfolio analytics platform with typed period-return and contribution services, Prisma/PostgreSQL persistence, responsive visualizations, and deterministic fixtures.
- Designed owner-scoped Auth.js workflows, a server-enforced read-only public demo, explicit admin authorization, signed/idempotent background jobs, and privacy-safe observability.
- Integrated SEC EDGAR provenance and private raw-source retention while preserving ambiguity, freshness, and missing-data states alongside attributed TradingView market context.

## Architecture

```mermaid
flowchart LR
  UI[Next.js App Router UI] --> API[Route handlers]
  UI --> TV[Attributed TradingView widget]
  API --> Services[Portfolio, research, and SEC services]
  Services --> Jobs[Durable job dispatcher]
  Jobs --> QStash[Signed QStash delivery]
  QStash --> Worker[Verified worker route]
  Worker --> Services
  Services --> Redis[(Ephemeral Redis cache, limits, locks)]
  Services --> Providers[Seeded and SEC provider adapters]
  Services --> Prisma[Prisma ORM]
  Providers --> SEC[SEC EDGAR]
  Providers --> R2[(Private Cloudflare R2)]
  Providers --> Agents[Specialist research agents]
  Evidence[Versioned public evidence snapshot] --> Agents
  Agents -. default-off .-> Model[OpenAI Responses API]
  Agents --> Synthesis[Research synthesis]
  Prisma --> Postgres[(PostgreSQL)]
```

The application keeps presentation, orchestration, domain calculations, providers, and persistence separate. Providers supply facts; specialist agents interpret structured inputs; synthesis combines their outputs while preserving findings, confidence, warnings, and sources.

## Tech stack

- Next.js 15, React 19, and TypeScript
- Tailwind CSS and shadcn/ui-style components
- Recharts for portfolio and stock visualizations
- Prisma ORM and PostgreSQL
- Auth.js with the Prisma adapter and GitHub/Google OAuth
- Zod for runtime validation
- SEC EDGAR submissions and Company Facts APIs
- Cloudflare R2 through the server-only AWS S3 client
- Upstash Redis and QStash for ephemeral coordination and signed delivery
- Attributed TradingView widgets for public market charts
- Vitest for unit and route-level integration tests
- ESLint, Docker, and GitHub Actions

## Run locally

Prerequisites: Node.js 20.19+, npm, and Docker Desktop (or another PostgreSQL 16 instance).

```bash
git clone <your-repository-url>
cd PortfolioScope
cp .env.example .env
npm ci
docker compose up -d postgres
npm run db:deploy
npm run db:seed
npm run dev
```

On Windows PowerShell, replace the copy command with `Copy-Item .env.example .env`.

Open [http://localhost:3000](http://localhost:3000), then select **Continue as demo investor**. The default `.env.example` credentials match the local Docker database.

The demo does not require OAuth. To test real sign-in locally, generate
`AUTH_SECRET`, create local GitHub and Google OAuth applications, and configure
the callback URLs documented in [`RUNBOOK.md`](RUNBOOK.md). Never reuse
Production OAuth credentials in Preview or local environments.

SEC ingestion is optional for the seeded local demo. To exercise M14, configure
the SEC and R2 values from `.env.example`, apply migrations and seed the
supported-company registry, assign a trusted test identity `ADMIN`, then use the
single-ticker `POST /api/admin/sec/ingest` operation documented in
[`RUNBOOK.md`](RUNBOOK.md). Page rendering never makes a live SEC request.

M15 background work is also opt-in. Keep its three feature flags `false` for
the normal seeded demo. To exercise jobs, configure environment-isolated Redis
and QStash credentials, apply both M15 migrations, verify the signed callback,
then enable workloads in the order documented in [`RUNBOOK.md`](RUNBOOK.md).

M18 external research is separately opt-in and is not needed for the local
demo. Keep `AI_RESEARCH_ENABLED=false` unless the additive M18 migration,
public-evidence boundary, OpenAI credential, provider-side billing alerts, and
the application quotas have been verified in that environment. See
[`docs/ai-research.md`](docs/ai-research.md) for the activation and rollback
sequence.

Local verification has successfully applied migrations
`20260811120000_m18_ai_research_foundation` and
`20260811130000_m18_bind_ai_generation_config`; all eight dedicated M18
database integration cases pass. Preview and Production must still apply and
verify both migrations independently with external AI disabled.

## Quality checks

```bash
npm run verify
```

Run the deeper checks when the changed surface requires them:

```bash
npm run verify:db
npm run test:integration
npm run test:e2e
npm run verify:security
```

CI uses the same package entrypoints against an isolated PostgreSQL service after
applying migrations and loading deterministic demo data.

## Demo guide

The focused recruiter walkthrough takes about two minutes:

1. Start on the landing page and enter the read-only demo without OAuth.
2. Use the guided dashboard prompt to inspect period analytics and a holding.
3. Distinguish attributed TradingView market context from persisted SEC facts and provenance.
4. Open the deterministic sample research and finish on the public architecture page or repository.

Detailed talking points, fallback steps, and screenshot framing are in [`DEMO.md`](DEMO.md).

## Deployment

The M11 deployment foundation targets Vercel and Neon PostgreSQL. Runtime traffic uses the pooled `DATABASE_URL`; Prisma migration commands use the direct `DIRECT_URL`. Preview and production must use different Neon databases and environment-scoped Vercel variables.

The repository includes:

- GitHub Actions checks backed by PostgreSQL
- Safe, repeatable Prisma migrations and an idempotent demo-seed integration check
- `GET /api/health` for liveness and `GET /api/ready` for database readiness
- Optional Sentry client, server, edge, and App Router error instrumentation
- Durable demo-owner identification with collision-safe legacy seed adoption
- Auth.js GitHub/Google OAuth, database sessions, protected application/admin routes, and account lifecycle controls
- Centralized authorization helpers plus cross-user route, service, and PostgreSQL isolation tests
- A curated 25-company ticker/CIK registry and controlled admin-only SEC ingestion
- Private content-addressed R2 raw-source storage and normalized PostgreSQL facts
- Explicit missing, ambiguous, stale, failed, and unsupported fundamentals states
- Durable SEC, deterministic research, snapshot, and maintenance jobs with signed callbacks and admin diagnostics
- A versioned evidence-retrieval and structured-generation layer with normalized claims/citations, bounded repair, report reuse/diff utilities, and offline evaluation
- PostgreSQL-authoritative global, per-user, and per-job AI reservations with a checked-in `$5 USD` monthly application maximum and a default-off external-call kill switch
- Redis cache/lock/rate-limit policies plus two bounded QStash maintenance schedules
- Privacy-safe structured logs, request correlation, Sentry release/error context, and an admin-only dependency dashboard
- Explicit PostHog event contracts with autocapture, replay, and person profiles disabled
- CSP and production security headers with deliberate TradingView allowances
- Scheduled compressed PostgreSQL backups in private R2 storage, guarded non-production restore tooling, and retention tests
- Playwright critical-journey coverage plus Dependabot, CodeQL, Gitleaks, and dependency-audit automation
- A multi-stage production `Dockerfile` and local PostgreSQL in `docker-compose.yml`

Follow [`RUNBOOK.md`](RUNBOOK.md) for the environment matrix, first deployment, monitoring, smoke tests, and rollback procedure.

No public demo URL is claimed here until a deployment is verified.

## Project documentation

- [`README.md`](README.md) — product, architecture, setup, deployment, and roadmap
- [`DEMO.md`](DEMO.md) — recruiter walkthrough and screenshot capture checklist

- [`RUNBOOK.md`](RUNBOOK.md) — production deployment, monitoring, and rollback
- [`docs/sec-data.md`](docs/sec-data.md) — SEC contracts, normalization, provenance, freshness, and operations

- [`docs/ai-research.md`](docs/ai-research.md) — M18 grounding, privacy, providers, budgets, activation, and rollback
- [`docs/ai-evaluation.md`](docs/ai-evaluation.md) — offline metrics, curated cases, and manual review rubric

## Roadmap

- M17 frontend and recruiter-demo experience implemented in the repository
- M18 repository completion gates and local migrations verified; external OpenAI activation and deployed evidence remain pending
- Activate and verify the implemented Redis/QStash M15 layer in Preview and Production
- Activate and externally verify M16 monitors, analytics, backup delivery, restore evidence, and rollback controls
- Complete deployed UX/accessibility checks and the M18 controlled Preview evaluation before any Production AI activation
- Replaceable licensed market-data providers when justified
- Benchmarking, dividends, and portfolio import

Brokerage connectivity, trading, price prediction, and investment recommendations remain outside the product’s scope.
