# PortfolioScope Production Runbook

This runbook covers the M11 deployment foundation through the default-off M18
AI research path: Vercel hosting, Neon PostgreSQL, environment separation, the
deterministic demo, CI, health checks, monitoring, domain setup, Auth.js, OAuth,
database sessions, owner-scoped private resources, SEC/R2 activation, Redis,
signed QStash jobs, maintenance, diagnostics, analytics, security, backups,
recovery, release verification, evidence-grounded model activation, budgets,
and rollback.

M18 repository implementation does not prove external activation. Account-side
monitors, a real backup upload, restore/rollback drills, an OpenAI project and
billing control, a bounded live call, source/privacy review, and usage
reconciliation must still be evidenced by an operator.

## Service inventory and cost

| Service | Purpose | Initial tier | Expected monthly change |
| --- | --- | --- | ---: |
| Vercel | Next.js production and preview deployments | Hobby, while non-commercial terms apply | $0 |
| Neon | Separate production and non-production PostgreSQL | Free | $0 |
| GitHub Actions | Pull-request and main-branch validation | Public-repository allowance | $0 |
| Sentry | Initial client and server error capture | Free | $0 |
| Better Stack | Homepage and health uptime checks | Free | $0 |
| Auth.js | GitHub/Google OAuth and database session management | Open source | $0 |
| Cloudflare | Domain registration and DNS | Domain registration only | About $1–2, annualized |
| Cloudflare R2 | Private raw SEC submissions and Company Facts | Free allowance | $0 expected |
| SEC EDGAR | Authoritative submissions, filings, and Company Facts | Public access | $0 |
| TradingView | Attributed public market chart widget | Free public widget | $0 |
| Upstash Redis | Ephemeral caches, locks, and rate limits | Free | $0 expected |
| Upstash QStash | Signed background delivery and two bounded schedules | Free | $0 expected |
| PostHog | Explicit privacy-safe product events | Free | $0 expected |
| Playwright | Critical browser journeys in GitHub Actions | Open source | $0 |
| OpenAI Responses API | Optional evidence interpretation; default-off | Usage-based | $0 disabled; application maximum $5 |

Expected non-AI monthly infrastructure total: approximately `$1-2 USD`,
primarily the annualized domain cost while the reviewed free allowances hold.
The M18 application hard maximum is `$5 USD` per UTC month, so the estimated
configured maximum total is approximately `$6-7 USD`, below the `$30 USD`
project limit. OpenAI is a new usage-based service; verify current pricing and
the actual provider invoice. The backup retention policy is 7 daily, 4 weekly,
and 3 monthly objects. Do not enable an uncapped paid tier.

## Environment matrix

Configure each environment independently. Never copy production database credentials into Preview.

| Variable | Local | Preview | Production | Secret |
| --- | --- | --- | --- | ---: |
| `DATABASE_URL` | Local pooled/runtime URL | Non-production Neon pooled URL | Production Neon pooled URL | Yes |
| `DIRECT_URL` | Local direct URL | Non-production Neon direct URL | Production Neon direct URL | Yes |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Stable staging URL or current preview origin | Canonical HTTPS origin | No |
| `AUTH_SECRET` | Unique local secret | Unique Preview secret | Unique Production secret | Yes |
| `AUTH_TRUST_HOST` | `true` | `true` after host review | `true` for the canonical deployment host | No |
| `AUTH_GITHUB_ID` | Local GitHub OAuth app | Staging GitHub OAuth app | Production GitHub OAuth app | Treat as configuration |
| `AUTH_GITHUB_SECRET` | Local GitHub secret | Staging GitHub secret | Production GitHub secret | Yes |
| `AUTH_GOOGLE_ID` | Local Google OAuth client | Staging Google OAuth client | Production Google OAuth client | Treat as configuration |
| `AUTH_GOOGLE_SECRET` | Local Google secret | Staging Google secret | Production Google secret | Yes |
| `AUTH_GOOGLE_ENABLED` | Explicit local choice | `false` until callback proof | Explicit Production choice | No |
| `DEMO_USER_EMAIL` | Dedicated demo identity | Dedicated non-production demo identity | Dedicated production demo identity | No |
| `SEC_USER_AGENT` | `PortfolioScope/1.0` | Environment-identifying app name | Production-identifying app name | No |
| `SEC_CONTACT_EMAIL` | Monitored developer contact | Monitored operator contact | Monitored production contact | Treat as contact configuration |
| `R2_ACCOUNT_ID` | Development account | Non-production account | Production account | Treat as server configuration |
| `R2_ACCESS_KEY_ID` | Development bucket token | Preview bucket token | Production bucket token | Yes |
| `R2_SECRET_ACCESS_KEY` | Development bucket secret | Preview bucket secret | Production bucket secret | Yes |
| `R2_BUCKET_NAME` | Development bucket | Isolated Preview bucket | Private Production bucket | Treat as server configuration |
| `R2_ENDPOINT` | Blank or local-compatible endpoint | Blank unless overridden | Blank unless overridden | No |
| `SEC_LOCAL_MANUAL_INGESTION_ENABLED` | `false`; temporarily `true` for controlled localhost validation | Always `false` | Always `false` | No |
| `UPSTASH_REDIS_REST_URL` | Blank unless testing jobs | Non-production Redis REST URL | Production Redis REST URL | Treat as server configuration |
| `UPSTASH_REDIS_REST_TOKEN` | Blank unless testing jobs | Non-production Redis token | Production Redis token | Yes |
| `QSTASH_TOKEN` | Blank unless testing jobs | Non-production QStash token | Production QStash token | Yes |
| `QSTASH_CURRENT_SIGNING_KEY` | Blank unless testing jobs | Non-production current key | Production current key | Yes |
| `QSTASH_NEXT_SIGNING_KEY` | Blank unless testing jobs | Non-production next key | Production next key | Yes |
| `BACKGROUND_JOBS_ENABLED` | `false` until configured | `false` until callback proof | `false` until callback proof | No |
| `SEC_INGESTION_ENABLED` | `false` until configured | Independent opt-in | Independent opt-in | No |
| `PUBLIC_STOCK_PAGES_ENABLED` | Explicit local choice | Independent opt-in | Independent opt-in | No |
| `RESEARCH_GENERATION_ENABLED` | `false` until configured | Independent opt-in | Independent opt-in | No |
| `AI_RESEARCH_ENABLED` | `false` | `false` until controlled proof | `false` until separately approved | No |
| `OPENAI_API_KEY` | Blank by default | Environment-scoped key only for proof | Separate Production key only after approval | Yes |
| `OPENAI_RESEARCH_MODEL` | Checked-in allowlisted default | Reviewed allowlisted model | Same reviewed model/version | No |
| `AI_MONTHLY_BUDGET_USD` | `5` maximum | `5` maximum, preferably lower for proof | `5` maximum | No |
| `AI_USER_MONTHLY_BUDGET_USD` | `1` | At most global limit | At most global limit | No |
| `AI_MAX_COST_PER_JOB_USD` | `0.25` | At most user limit | At most user limit | No |
| `AI_MAX_TOKENS_PER_JOB` | `50000` | Reviewed bound | Reviewed bound | No |
| `AI_MAX_OUTPUT_TOKENS_PER_CALL` | `1500` | Reviewed bound | Reviewed bound | No |
| `AI_PROVIDER_TIMEOUT_MS` | `20000` | At most `25000` | At most `25000` | No |
| `AI_USER_MONTHLY_REPORT_LIMIT` | `5` | Reviewed quota | Reviewed quota | No |
| `PORTFOLIO_EXPORT_ENABLED` | `false` | `false` | `false` until implemented | No |
| `MAINTENANCE_MODE` | `false` | `false` | Emergency kill switch | No |
| `SENTRY_DSN` | Blank or development project | Preview project/DSN | Production project/DSN | Treat as server configuration |
| `NEXT_PUBLIC_SENTRY_DSN` | Blank or development project | Preview project/DSN | Production project/DSN | No; DSNs are client-visible |
| `SENTRY_ENVIRONMENT` | `local` | `preview` | `production` | No |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `local` | `preview` | `production` | No |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | Blank or local revision | Same Preview commit SHA | Same Production commit SHA | No |
| `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `0` | Reviewed value from `0` to `1` | Reviewed value from `0` to `1` | No |
| `SENTRY_ORG` | Blank unless uploading source maps | Sentry organization slug | Sentry organization slug | No |
| `SENTRY_PROJECT` | Blank unless uploading source maps | Preview project slug | Production project slug | No |
| `SENTRY_AUTH_TOKEN` | Blank | Build-only token | Build-only token | Yes |
| `NEXT_PUBLIC_POSTHOG_KEY` | Blank or development project key | Preview project key | Production project key | No; client-visible |
| `NEXT_PUBLIC_POSTHOG_HOST` | Blank or assigned regional host | Assigned regional host | Assigned regional host | No |
| `BETTER_STACK_WORKER_HEARTBEAT_URL` | Blank | Preview heartbeat URL | Production heartbeat URL | Yes |
| `BETTER_STACK_BACKUP_HEARTBEAT_URL` | Blank | Preview heartbeat URL | Production heartbeat URL | Yes |
| `BETTER_STACK_BACKUP_FAILURE_HEARTBEAT_URL` | Blank | Preview failure URL | Production failure URL | Yes |
| `LAST_RESTORE_DRILL_AT` | Blank | ISO-8601 completion time | Last approved non-production drill time | No |
| `LAST_RESTORE_DRILL_REFERENCE` | Blank | Non-secret evidence reference | Non-secret evidence reference | No |
| `LAST_COST_REVIEW_AT` | Blank | ISO-8601 review time | Latest monthly review time | No |
| `LAST_COST_REVIEW_REFERENCE` | Blank | Non-secret evidence reference | Non-secret evidence reference | No |

Rules:

- `DATABASE_URL` is the pooled connection used by Prisma Client in serverless functions.
- `DIRECT_URL` is the non-pooled connection used by Prisma CLI migrations.
- Give `SENTRY_AUTH_TOKEN` only to build environments that upload source maps. Never prefix it with `NEXT_PUBLIC_`.
- Leave Sentry DSNs blank to disable reporting without changing code.
- Vercel Preview and Production values must point to separate Neon projects or databases.
- Generate a different high-entropy `AUTH_SECRET` for each environment. Never copy the Production value to Preview.
- OAuth client secrets are server-only. Do not prefix them with `NEXT_PUBLIC_` or expose them in readiness responses, logs, or error pages.
- The public demo is read-only in every environment. Authorization uses the server-controlled database `isDemo` marker; `NODE_ENV`, UI controls, portfolio names, and email addresses are not security boundaries.
- SEC and R2 credentials are used only by Node.js server modules. Never prefix them with `NEXT_PUBLIC_`, return them from readiness, or expose raw R2 object keys in public UI.
- `R2_ENDPOINT` may remain blank; the application derives the account S3 endpoint. Use a custom endpoint only for a controlled compatible test service.
- `SEC_LOCAL_MANUAL_INGESTION_ENABLED` is a narrow localhost-only validation
  switch. The server also requires an HTTP loopback `NEXT_PUBLIC_APP_URL` and
  rejects this mode in Vercel Preview and Production. Never configure it in
  either deployed environment.
- Redis and QStash credentials are server-only and must be different between
  Preview and Production. Redis is never authoritative for users, portfolios,
  financial facts, research reports, final job state, or audit events.
- `OPENAI_API_KEY` is server-only and must be independently scoped for Preview
  and Production. Do not expose provider prompts, evidence, request IDs, or the
  key through readiness, client variables, analytics, or application logs.
- The external model receives only bounded public-company evidence. Holdings,
  quantities, values, allocations, cost basis, alerts, notes, email, sessions,
  and `userId` remain outside the provider request.
- PostgreSQL owns AI budget reservations and settled/unconfirmed usage. Redis
  rate limits supplement but never replace global, user, and job accounting.
- Keep all M15 flags `false` until the stable HTTPS origin and signed worker
  callback have been verified in that environment.
- Every listed feature flag must be set explicitly in Production. An absent or
  invalid Production flag fails closed. `MAINTENANCE_MODE` preserves health,
  readiness, authentication, internal worker, and administrator access while
  returning a controlled maintenance response for public/application traffic.
- Better Stack heartbeat URLs are secrets because possessing one can falsify
  monitor state. Server and backup tooling accept only HTTPS heartbeat URLs in
  Production and never log them.
- PostHog is disabled unless both public values are present. Autocapture,
  session replay, automatic page views, and person profiles remain disabled;
  only the runtime-validated event taxonomy may be sent.
- Cost and restore evidence variables are administrator-facing operational
  metadata. They must contain only timestamps and non-secret references.

References: [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Prisma configuration](https://docs.prisma.io/docs/orm/reference/prisma-config-reference), and [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables).

## First deployment

### 1. Create Neon databases

1. Create one Neon Free project or isolated database for Production.
2. Create a separate Neon project or database for Preview.
3. In each Neon dashboard, copy both connection forms:
   - pooled endpoint (`-pooler` hostname) to `DATABASE_URL`;
   - direct endpoint to `DIRECT_URL`.
4. Use least-privilege application credentials where practical.
5. Record the Neon region and choose a nearby Vercel function region.

Do not run `prisma db push` against either hosted database.

### 2. Create the Vercel project

1. Import the GitHub repository into Vercel.
2. Select Next.js and Node.js `20.19` or newer.
3. Keep `npm ci` as the install command and `npm run build` as the build command.
4. Set `main` as the Production branch.
5. Keep pull-request Preview deployments enabled.
6. Add every variable in the matrix separately to Preview and Production scopes.
7. Confirm Preview values use only the non-production Neon database.

Git-connected pull requests should produce Preview deployments automatically after the repository is imported.

### 3. Validate the production database

From a trusted operator environment with production `DATABASE_URL` and `DIRECT_URL` loaded:

```bash
npm ci
npm run db:generate
npx prisma validate
npm run db:deploy
npm run db:seed
```

The seed uses deterministic upserts, updates only the marked demo identity and shared seeded catalog, and does not delete non-demo users. It can adopt a verified legacy demo owner at `DEMO_USER_EMAIL` without rewriting that user's primary key. It aborts on multiple markers, an unexpected configured-email owner, a conflicting stable ID, or deterministic alert/research IDs owned by another user. Changing `DEMO_USER_EMAIL` updates only the already marked identity when the new address is unclaimed. `npm run test:integration` is intentionally blocked when `NODE_ENV` or `VERCEL_ENV` is `production`; run that check only against local or Preview databases.

Apply migrations before promoting the matching application. M12 migration `20260714190000_m12_authentication` adds Auth.js identity/session tables and updates `User`; M13 migration `20260715120000_m13_user_isolation` adds the demo marker, the owner-history index, and restrictive stock foreign keys, and `20260715123000_m13_single_demo_owner` adds the partial unique index that permits only one marked demo identity. Run the seed after all migrations and before promoting M13 code so the existing demo owner is marked. Test against Preview first, back up before destructive work, and prefer a forward fix over a production down migration.

M14 migration `20260715160000_m14_sec_edgar_platform` follows both M13
migrations. It adds only nullable security linkage and new SEC tables. Rerun the
idempotent seed after deployment to create/link the 25-company registry; the
seed performs no network or R2 access. Existing unsupported securities remain
valid. After a real backfill, preserve the SEC tables and use a forward fix
rather than dropping facts or raw-object references.

M18 migrations `20260811120000_m18_ai_research_foundation` and
`20260811130000_m18_bind_ai_generation_config` follow the existing auth,
isolation, SEC, and durable-job migrations. Apply them with
`AI_RESEARCH_ENABLED=false`. It adds nullable research provenance/version fields
and new budget, usage, claim, and evidence tables. It requires no seed or data
backfill, and it leaves historical reports classified as deterministic. Preserve
these additive records during rollback so usage can be reconciled.

Repository/local verification (2026-08-11): `npm run db:deploy` successfully
applied both M18 migrations, and all eight dedicated M18 database integration
cases pass. They cover JSONB snapshot integrity, recorded and zero-network
metered end-to-end persistence/privacy, citation-safe partial fallback, fresh
reuse, explicit regeneration, active-run deduplication, usage reconciliation,
and concurrent global/user/job budget enforcement. This does not verify the Preview or
Production migration state or any live external provider.

### 4. Deploy and promote

1. Confirm GitHub Actions is green.
2. Open the Vercel Preview deployment and run the Preview checklist below.
3. Merge only after Preview uses the non-production database.
4. Confirm the Production build succeeds.
5. Promote the deployment or allow the configured `main` deployment to become current.
6. Run the Production checklist.

## Domain and HTTPS

1. Add the intended apex and `www` domains in Vercel Project Settings.
2. Copy the exact DNS records Vercel reports into Cloudflare DNS; do not assume generic values.
3. Choose one canonical hostname and configure the other as a redirect.
4. Keep Cloudflare DNSSEC enabled.
5. Wait for Vercel domain verification and certificate provisioning.
6. Verify the canonical redirect, HTTPS certificate, and absence of mixed content.
7. Set Production `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin and redeploy.

Use Vercel's current [custom-domain setup guide](https://vercel.com/docs/domains/set-up-custom-domain) when dashboard instructions differ.

## Authentication activation

Auth.js uses the Prisma adapter and an explicit database-session strategy. New
identities default to `USER`; `ADMIN` must be assigned by a trusted operator in
PostgreSQL. No public request or client form accepts a role value.

### Local Docker authentication

Docker Compose requires `AUTH_SECRET` from the ignored local `.env` file and
fails before starting the app when it is absent. Generate a high-entropy local
value, keep it out of `.env.example`, and use `http://localhost:3000` for both
`AUTH_URL` and `NEXT_PUBLIC_APP_URL`. Compose enables `AUTH_TRUST_HOST` only for
this reviewed local container configuration; Production values remain managed
separately by the deployment environment.

The app image copies source code during `docker compose build` and has no source
bind mount. After changing routes, layouts, Auth.js configuration, or other app
code, rebuild and recreate the app container before testing:

```bash
docker compose build app
docker compose up -d --force-recreate app
```

The Dockerfile uses `/workspace` deliberately. Do not change its work directory
to `/app`: with the nested `app/app` protected route, that path causes the Linux
production build to assign the root and protected layouts the same module ID and
apply the protected layout globally.

Use a normal `GET`, not `curl -I`, when checking Auth.js routes. Verify that
`/auth/signin?callbackUrl=%2Fapp` returns `200`, `/app` redirects once to that
page, and `/api/auth/session` returns `200`. If every page redirects to sign-in,
compare `docker compose images` with the latest source change before changing
route protection.

When local OAuth credentials are intentionally blank, one disposable non-demo
identity can be enabled for a bounded manual validation window. Add this exact
ignored `.env` value alongside the existing HTTP loopback
`NEXT_PUBLIC_APP_URL`:

```dotenv
LOCAL_DISPOSABLE_AUTH_ENABLED="true"
```

The path is unavailable unless the flag is exactly `true`, `AUTH_SECRET` is
configured, `NEXT_PUBLIC_APP_URL` is an HTTP loopback origin, the browser Origin
matches that configured origin, and `VERCEL_ENV` is neither `preview` nor
`production`. When `AUTH_URL` is set, it must match the same loopback origin. It
does not use `NODE_ENV`, add a password, or change OAuth. The
first sign-in generates one `sec-validation-<uuid>@local.portfolioscope.invalid`
user with the schema-default `USER` role and a fixed `local-disposable` account
marker; later sign-ins can reuse only that marked, non-demo identity. Each
sign-in revokes any older session for this dedicated identity, creates one
normal 30-day database session, and sets the standard HTTP-only Auth.js
localhost session cookie.

Rebuild and recreate the app, open
`http://localhost:3000/auth/signin?callbackUrl=%2Fapp`, and select **Create or
reuse local validation identity**. Confirm `/app/account` shows the generated
email and `USER`; `/admin` must still redirect to access denied.

Promote only the marked identity with one of these trusted operator methods:

1. Run `npx prisma studio`, open `Account`, and locate the row whose provider is
   `local-disposable`, provider account ID is
   `localhost-manual-sec-validation-v1`, and type is `local`. Follow its User
   relation; verify `isDemo` is false and the email matches the local validation
   namespace, then change only that User's role from `USER` to `ADMIN`.
2. Or run this marker-scoped PostgreSQL command:

```powershell
docker compose exec postgres psql -v ON_ERROR_STOP=1 -U portfolio_scope -d portfolio_scope -c 'UPDATE "User" AS u SET role = ''ADMIN'', "updatedAt" = CURRENT_TIMESTAMP FROM "Account" AS a WHERE a."userId" = u.id AND a.provider = ''local-disposable'' AND a."providerAccountId" = ''localhost-manual-sec-validation-v1'' AND a.type = ''local'' AND u."isDemo" = false AND u.email LIKE ''sec-validation-%@local.portfolioscope.invalid'' RETURNING u.email, u.role, u."isDemo";'
```

Exactly one returned row is required. Refresh `/app/account` and confirm the
role badge is `ADMIN`, then open `/admin`; the existing database session reads
the current database role, so another sign-in is not required. Normal Auth.js
sign-out deletes this session row and clears its cookie.

After validation, sign out, return the flag to `false`, and rebuild/recreate the
app. Then remove only the marker-linked disposable User (its Account and any
remaining Sessions cascade) with Prisma Studio after the same checks, or:

```powershell
docker compose exec postgres psql -v ON_ERROR_STOP=1 -U portfolio_scope -d portfolio_scope -c 'DELETE FROM "User" AS u USING "Account" AS a WHERE a."userId" = u.id AND a.provider = ''local-disposable'' AND a."providerAccountId" = ''localhost-manual-sec-validation-v1'' AND a.type = ''local'' AND u."isDemo" = false AND u.email LIKE ''sec-validation-%@local.portfolioscope.invalid'' RETURNING u.email;'
```

Exactly one returned row confirms cleanup. With the flag disabled, the local
button is absent and direct action attempts fail closed.

For OAuth identities, assign `ADMIN` only from a trusted operator connection
after verifying the exact OAuth email and user ID. Record the operator and
reason outside the application; M12 intentionally does not expose a
role-mutation route.

### GitHub OAuth

Create separate OAuth applications for local development and Production. Use a
stable staging application only when Preview OAuth testing is required.

Callback URLs:

```txt
http://localhost:3000/api/auth/callback/github
https://portfolioscope.dev/api/auth/callback/github
```

Set the matching client ID and secret as `AUTH_GITHUB_ID` and
`AUTH_GITHUB_SECRET` in the same environment as the callback origin.

### Google OAuth

Create separate OAuth clients for local development and Production. Configure
the OAuth consent screen for the intended non-commercial audience and add only
the required identity scopes.

Authorized redirect URIs:

```txt
http://localhost:3000/api/auth/callback/google
https://portfolioscope.dev/api/auth/callback/google
```

Set the matching client ID and secret as `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET`. PortfolioScope rejects Google profiles whose email is not
verified.

### Preview strategy

GitHub and Google callback allowlists do not naturally fit arbitrary Vercel
Preview URLs. Prefer a stable staging hostname with isolated OAuth credentials.
When that is unavailable, keep the demo and automated fixture tests active but
do not claim real Preview OAuth verification.

### Session and account policy

- Sessions persist in PostgreSQL for 30 days and are refreshed at most once per day.
- Sign-out deletes the current database session and invalidates its cookie.
- Account settings can revoke every session immediately.
- Account deletion signs out the current session, then deletes the user. Foreign-key cascades delete linked accounts, remaining sessions, portfolios and holdings, watchlist items, alerts, research jobs, agent runs, and reports. Shared stock catalog data remains.
- The marked demo identity is excluded from account deletion and OAuth account linking.
- Account deletion retains no application audit row, minimizing personal-data retention. Record only the operational completion timestamp outside the deleted account. M13 introduces no privileged mutable admin operation, so no speculative audit table is created.
- OAuth access, refresh, and ID tokens are discarded after provider identity linking because PortfolioScope does not call provider APIs on a user's behalf.
- Auth.js secure-cookie behavior is used without custom cookie overrides; HTTPS is required in Production.
- Matching email addresses are not automatically linked while signed out. A user must sign in with the provider already linked to that identity; future explicit provider linking must start from an authenticated session.

After deploying credentials, verify `/auth/signin`, both provider callbacks,
`/app`, `/app/account`, `/admin` rejection for a `USER`, sign-out, all-session
revocation, account deletion with a disposable test identity, and independent
`/demo` access.

### User-isolation smoke test

Use disposable, non-production User A and User B identities:

1. User A creates a portfolio, holding, watchlist item, and research job.
2. Record the generated resource IDs without recording financial values in logs.
3. Sign in as User B and request User A's portfolio, holding, watchlist item, alert, and research-job URLs or APIs directly.
4. Confirm reads and mutations return the same controlled `404` used for a missing ID.
5. Submit User A's portfolio ID while User B creates a holding and confirm no relationship is created.
6. Confirm an anonymous private API request returns `401`, the marked demo identity receives `403` for mutations, and a standard user receives access denial for `/admin`.
7. Give a disposable identity `ADMIN` in Preview and confirm normal private-resource APIs still expose only that admin identity's own records.

Never run the automated isolation suite against Production; it creates and deletes fixtures. Use the manual smoke test with disposable records and remove them through the normal account lifecycle.

## SEC EDGAR and R2 activation

### 1. Create private object storage

1. Create separate Preview and Production R2 buckets, or strictly isolated
   prefixes and tokens when separate buckets are unavailable.
2. Generate an R2 S3 API token limited to object read/write for the intended
   bucket. Do not grant account administration.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
   `R2_BUCKET_NAME` in Vercel's server environment. Leave `R2_ENDPOINT` blank
   unless a reviewed S3-compatible endpoint override is required.
4. Keep public access disabled. PortfolioScope does not need a public bucket or
   a browser CORS policy for M14.

### 2. Identify SEC traffic

Set `SEC_USER_AGENT` to a stable application identifier and
`SEC_CONTACT_EMAIL` to a monitored operator mailbox. The client sends both in
the request `User-Agent`, spaces request starts at eight per second, applies a
10-second timeout, and makes bounded transient retries. Do not configure a
parallel backfill; the SEC's published aggregate maximum is 10 requests per
second and may change.

### 3. Run one controlled ingestion

After applying the M14 migration and seed, assign a verified disposable
operator `ADMIN` from a trusted database connection. While signed in on the
same origin, issue one request from the browser console or an authenticated
operator client:

```js
await fetch("/api/admin/sec/ingest", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ticker: "AAPL" }),
}).then((response) => response.json());
```

The endpoint accepts one ticker only. It derives the operator from the database
session, rejects the marked demo identity even if its role is changed, and
resolves CIK/source/object keys server-side.

For local M14 validation without Redis or QStash, keep
`BACKGROUND_JOBS_ENABLED=false`, `SEC_INGESTION_ENABLED=false`, all Redis and
QStash values blank, and temporarily set only:

```dotenv
NEXT_PUBLIC_APP_URL="http://localhost:3000"
SEC_LOCAL_MANUAL_INGESTION_ENABLED="true"
```

Rebuild and recreate the app because Compose has no source bind mount:

```bash
docker compose build app
docker compose up -d --force-recreate app
```

The successful request returns HTTP `200` only after the `SecIngestionRun` is
terminal, with this non-sensitive shape:

```json
{
  "runId": "<run-id>",
  "ticker": "AAPL",
  "correlationId": "<correlation-id>",
  "status": "COMPLETED",
  "filingsProcessed": 0,
  "factsProcessed": 0,
  "factsSelected": 0,
  "ambiguousFacts": 0
}
```

The counts vary with the current SEC payload. This path calls the existing M14
ingestion service directly and creates no `BackgroundJob`; it does not publish
to QStash, verify a worker callback, acquire a Redis lock, or enable schedules.
The SEC client retains its process-local fair-access gate, and unconfigured
Redis cache/coordination calls degrade to no-ops. The normal Redis-backed admin
rate limit is skipped only inside this loopback-only manual mode;
authentication, ADMIN authorization, persisted demo protection, same-origin
checking, and single-ticker validation still apply.

Inspect the returned run without exposing object keys:

```bash
docker compose exec postgres psql -U portfolio_scope -d portfolio_scope -c 'SELECT id, status, trigger, "correlationId", "filingsProcessed", "factsProcessed", "factsSelected", "ambiguousFacts", "errorCode", "startedAt", "completedAt" FROM "SecIngestionRun" WHERE id = ''<run-id>'';'
```

The `/admin` freshness card shows the ticker's last completed synchronization,
but local manual runs do not appear in the durable-job table. Repeating the
browser request is the supported local retry: it creates a new auditable run
while filing accessions, fact external keys, and content-addressed raw metadata
remain idempotent. Return the manual flag to `false` and rebuild/recreate the app
after validation.

When M15 is enabled in a configured Preview or Production environment, the same
endpoint preserves its durable behavior: a new job returns `202` with job ID,
correlation ID, and queued state; an active duplicate returns `200` and reuses
the job. Follow it in `/admin`, then use its correlation ID to inspect the
completed `SecIngestionRun`. Do not record session cookies, raw responses,
private bucket names, or credential values in operational notes.

### 4. Validate before continuing

For each company, compare at least revenue, net income, assets, liabilities,
period end, period kind, form, accession, filed date, and SEC source link with
the filing. Confirm exactly two content-addressed JSON objects exist for the
current raw payloads and that their PostgreSQL metadata has matching SHA-256
digests. Stop on ambiguous or misclassified values; never override them with a
manual guess.

Proceed sequentially through
[`data/supported-companies.json`](data/supported-companies.json). M14 has no
schedule or broad-backfill endpoint; after M15 activation, the bounded
freshness schedule queues at most five stale companies per pass. Keep the
schedule disabled until this controlled path is proven.

### Failure and recovery

- Missing SEC/R2 configuration fails the run without exposing variable names or
  credentials to the client.
- `429`, `5xx`, timeouts, and connection failures return a controlled provider
  failure after bounded attempts.
- An R2 failure prevents Company Facts from becoming normalized facts.
- If submissions and filing metadata succeeded before a later failure, the run
  is `PARTIALLY_COMPLETED` and the useful filing state is preserved.
- Repeating a ticker is safe: filings use unique accessions, facts use stable
  external keys, and raw JSON uses content-addressed keys.
- SEC/R2 are not readiness dependencies for page traffic. Existing normalized
  facts remain visible after refresh failure with their original timestamps.

See [`docs/sec-data.md`](docs/sec-data.md) for concept mapping, period and
amendment rules, freshness thresholds, provenance, and test fixtures.

## Redis and QStash activation

### 1. Apply the durable-job migrations

Keep `BACKGROUND_JOBS_ENABLED`, `SEC_INGESTION_ENABLED`, and
`RESEARCH_GENERATION_ENABLED` set to `false`. Apply migrations in their checked-
in order:

Before deployment, confirm there is no more than one legacy `PENDING` or
`RUNNING` research request per `(userId, stockId)`. Resolve any duplicate stuck
rows deliberately; the second migration adds a partial unique index and will
stop rather than guess which user request to retain.

```bash
npm run db:deploy
```

Confirm `20260721115500_m15_job_enum_extensions` completes before
`20260721120000_m15_caching_jobs_resilience`. The first commits the new research
and agent enum values; the second adds durable job tables and partial active-job
indexes. No seed or data backfill is required.

### 2. Configure isolated Upstash resources

Create separate Preview and Production Redis databases and QStash credentials.
Set all five Upstash secrets from `.env.example` in the matching server
environment. Set `NEXT_PUBLIC_APP_URL` to that environment's stable HTTPS
origin; QStash signs the full callback URL, so a mismatched host causes a
controlled `401`.

The Redis keys are prefixed by environment and private identifiers are hashed.
Cache failure degrades to the provider or PostgreSQL where safe. Mutation,
research, and admin rate limits fail closed because silently losing an abuse
boundary is unsafe.

### 3. Prove signed delivery before enabling publishers

1. Deploy with all M15 flags still `false`.
2. POST an unsigned body to `/api/internal/jobs/worker` and confirm `401`.
3. Temporarily set `BACKGROUND_JOBS_ENABLED=true` in Preview only.
4. From an authenticated Preview administrator, queue one supported SEC ticker
   only after SEC/R2 are configured, or queue one deterministic research job.
5. Confirm `/admin` shows `QUEUED`, an attempt, a correlation ID, and terminal
   `COMPLETED`. Confirm replaying the same delivery does not create another
   attempt or duplicate permanent work.
6. Rotate or test the next signing key through the Upstash-supported rotation
   procedure before Production activation.

An unsigned callback must never reach database claim logic. Do not place a
shared secret in the callback URL and do not bypass signature verification for
manual testing.

### 4. Enable workloads independently

- Set `BACKGROUND_JOBS_ENABLED=true` only after signed delivery succeeds.
- Set `SEC_INGESTION_ENABLED=true` only after the M14 SEC identity, R2 bucket,
  and controlled single-company review are complete.
- Set `RESEARCH_GENERATION_ENABLED=true` only after Redis user/IP limits and
  deterministic specialist/synthesis completion are verified.

Portfolio mutations retain their synchronous historical snapshot behavior.
Their current-snapshot refresh is an additional durable job; a dispatch outage
does not roll back a mutation that already committed.

### 5. Configure bounded schedules

Review the destination and UTC cron values in
`scripts/configure-qstash-schedules.mjs`, then run:

```bash
npm run jobs:schedules
```

The fixed IDs make the operation repeatable: rerunning overwrites those two
schedules instead of creating duplicates.

| Schedule ID | UTC cadence | Bound |
|---|---|---|
| `portfolioscope-recover-stale-jobs` | Hourly at minute 0 | At most 100 stale running jobs examined |
| `portfolioscope-refresh-stale-sec` | 02:15 and 14:15 daily | At most 5 missing or >24-hour stale companies queued per run |

Do not create a per-company high-frequency schedule. Review Redis commands,
QStash deliveries, and Vercel function usage monthly; pause the two schedules
before any usage can exceed the free allowances.

### Failure and recovery

- QStash publish failure leaves a PostgreSQL `FAILED` job with
  `JOB_PUBLISH_FAILED`; an administrator may retry it after delivery recovers.
- Hourly maintenance marks a queued job without recorded delivery metadata
  failed after 15 minutes, covering a database outage during dispatch metadata
  recording without risking an immediate duplicate publish.
- Retryable worker failures use 15, 30, 60, 120, then at most 300 seconds of
  backoff and stop at the job's configured maximum attempts.
- Permanent validation/normalization failures stop retrying and preserve a
  sanitized error code/message in the job and attempt history.
- Redis lock conflict is retryable. Redis unavailability cannot erase job,
  SEC, portfolio, or research state; PostgreSQL active-job constraints remain
  the fallback duplicate defense.
- Cancel only `QUEUED` or `RETRYING` jobs. Cancelling a research child cancels
  its queued/retrying siblings and parent request coherently. A running child
  must observe the cancelled parent or finish safely; permanent writes are not
  interrupted halfway.
- For rollback, disable SEC and research first, then background publishing;
  pause the two named schedules; preserve job rows; and forward-fix the
  additive schema.

## M18 external-AI activation

M18 is a default-off interpretation layer over public evidence. SEC EDGAR fact
excerpts and filing metadata, application catalog data, and deterministic signals
remain the sources. OpenAI is not a financial-data source and the provider does
not browse. Unsupported news and political-activity inputs remain explicit
missing states. Generated output is educational and may not include buy, sell,
or hold advice.

### 1. Satisfy prerequisites

- Authentication and cross-user isolation tests pass.
- The M14 migration, private R2 boundary, SEC identity, controlled company
  ingestion, provenance links, and manual source review are verified.
- M15 migrations, Redis limits, signed QStash callback, duplicate-work defense,
  and deterministic specialist/synthesis completion are verified.
- M16 monitoring, a backup, non-production restore, and a rollback target are
  evidenced. Deployed M17 research/citation states are usable.
- The `$5 USD` maximum and current OpenAI pricing are approved.

Repository implementation can be reviewed before those external prerequisites;
external calls cannot be called active until they pass.

### 2. Apply and verify the foundation

1. Back up the isolated Preview database.
2. Keep `AI_RESEARCH_ENABLED=false` and run `npm run db:deploy`.
3. Confirm both M18 migrations applied in order.
4. Run schema, type, unit, provider-contract, grounding, budget, reuse/diff, and
   offline evaluation checks with deterministic/recorded providers.
5. Verify old reports remain deterministic and do not gain invented provider or
   version metadata.

### 3. Configure the provider and limits

Create separate Preview and Production OpenAI projects or keys. Set the complete
M18 variable set from `.env.example` in the server environment. The checked-in
defaults are `$5` global/month, `$1` user/month, `$0.25` per job, 50,000 tokens
per job, 1,500 output tokens per call, a 20-second call timeout, and five user
reports per UTC month. Runtime and database constraints reject a global value
above `$5`.

Open the provider console and record the reviewed pricing date/version. Configure
a provider-side alert or spending stop at or below the approved allowance. The
application's versioned cost estimate and provider accounting are independent
controls; neither should be treated as the other.

### 4. Prove privacy, grounding, and accounting in Preview

1. Review a recorded-provider case and the curated offline evaluation. Treat any
   schema, grounding, recommendation, unsupported material claim, numerical, or
   missing-data failure as a stop.
2. Inspect the outbound request contract and confirm it contains only bounded
   public-company evidence. It must not contain holdings, quantities, values,
   allocations, cost basis, alerts, private notes/history, name, email, OAuth
   identity, session data, or `userId`.
3. Confirm provider prompts/evidence and secrets do not appear in logs, Sentry,
   PostHog, diagnostics, readiness, or browser payloads.
4. Enable `AI_RESEARCH_ENABLED=true` only in Preview after base background and
   research flags are already proven. Request one report for one supported
   company and controlled user.
5. Review every material claim against its cited excerpt/source. Confirm
   counter-evidence, disagreements, missing data, model/report versions, and the
   source snapshot are visible and persisted.
6. Match token counts, estimated cost, reservation settlement, and provider
   request ID to the actual OpenAI console charge. Investigate `UNCONFIRMED`
   usage before more calls.
7. Confirm a repeat reuses eligible work; explicit regeneration still consumes
   quotas; a changed source/version fingerprint produces history/diff metadata.
8. Exercise timeout and malformed-output behavior, then set the AI flag false
   during a controlled attempt. The runner rechecks before each call/repair and
   ordinary stock pages remain usable.

### 5. Production decision

Record the Preview job/report IDs, source-review notes, privacy evidence,
version tuple, provider usage/charge, kill-switch result, reviewer, and rollback
target. Only then repeat one bounded Production proof. Do not call the service
live merely because the key and flag exist. Review global/user/job reservations,
actual cost, unconfirmed usage, provider pricing, and report quality at least
monthly. The detailed methodology and rubric are in
[`docs/ai-research.md`](docs/ai-research.md) and
[`docs/ai-evaluation.md`](docs/ai-evaluation.md).

## Health and readiness

`GET /api/health` proves the Next.js process can respond. It does not contact PostgreSQL.

Expected response:

```json
{
  "status": "ok",
  "service": "portfolioscope",
  "timestamp": "2026-07-14T18:00:00.000Z"
}
```

`GET /api/ready` verifies that required runtime database configuration exists and that PostgreSQL answers a minimal query.

- Ready: HTTP `200`, status `ready`.
- Missing configuration or unavailable database: HTTP `503`, status `not_ready`.
- Production responses omit dependency-level details and never include connection strings, hosts, environment-variable names, stack traces, or provider credentials.
- Both endpoints send `Cache-Control: no-store, max-age=0`.
- Both endpoints return `x-request-id` and `x-correlation-id`; use either value
  to connect an alert with structured runtime logs.

Do not add SEC, TradingView, or other expensive external requests to readiness.
Administrators can inspect coarse database, Redis, R2, QStash, Sentry, PostHog,
heartbeat, backup, restore, feature-flag, job, and freshness status at `/admin`
or `GET /api/admin/diagnostics`. These probes do not return connection strings,
credentials, database hosts, user financial data, or raw provider responses.

## Sentry activation

1. Create separate Preview and Production Sentry projects or distinguish them with the configured environment tags.
2. Set the DSN and environment values from the matrix.
3. Set `SENTRY_ORG`, `SENTRY_PROJECT`, and a build-only `SENTRY_AUTH_TOKEN` when source-map upload is enabled. Set the same commit SHA in `SENTRY_RELEASE` and `NEXT_PUBLIC_SENTRY_RELEASE`.
4. Leave both trace sample rates at `0` initially. Increase them only after reviewing event volume and the free-tier budget.
5. Redeploy; environment changes do not affect already-built deployments.
6. In a temporary Preview-only change, trigger one controlled client error using Sentry's documented verification pattern.
7. Confirm the issue has the `preview` environment, release, request/correlation tags where applicable, and a readable application stack.
8. Remove the temporary trigger before merging.
9. Repeat with a controlled server error and failed disposable job in Preview.

The checked-in SDK configuration sends no default PII, strips cookies, request
bodies, and sensitive headers, hashes application user IDs, and defaults tracing
to zero. Follow the official [Sentry Next.js manual setup and verification guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) for the temporary test.

## Better Stack activation

Create HTTP monitors for:

| Monitor | URL | Expected result |
| --- | --- | --- |
| Homepage | Canonical production origin | HTTP 200 |
| Liveness | `/api/health` | HTTP 200 and `"status":"ok"` |
| Readiness | `/api/ready` | HTTP 200 and `"status":"ready"` |
| Authentication entry | `/auth/signin` | HTTP 200 and sign-in heading |

Create separate worker, successful-backup, and failed-backup heartbeat monitors.
Store their push URLs only in the secret stores described by the environment
matrix and database-backup workflow. The bounded maintenance worker signals the
worker heartbeat after successful cleanup; the backup script signals the
success heartbeat only after upload and retention, and signals the failure
heartbeat when the command exits unsuccessfully.

Use a free-tier interval, enable SSL verification, configure an owned
notification destination, and send a test notification. Treat readiness
database wake-up alerts separately when they would be noisy. In Preview, pause
one controlled monitor and omit one disposable heartbeat to prove outage,
missed-heartbeat, recovery, and notification delivery before activating the
Production monitors. Better Stack supports expected-status and keyword monitors;
see its [monitor API reference](https://betterstack.com/docs/uptime/api/create-a-new-monitor/).

## PostHog activation

1. Create environment-separated PostHog projects or a reviewed environment
   property policy, then configure the assigned regional ingestion host.
2. Set both `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`; leaving
   either blank disables analytics.
3. Verify only these events arrive: `demo_opened`, `sign_in_started`,
   `sign_in_completed`, `portfolio_created`, `stock_page_viewed`,
   `research_report_viewed`, and `architecture_page_viewed` when that page
   exists.
4. Inspect event payloads and browser storage in Preview. Confirm there are no
   portfolio values, position quantities, transaction amounts, OAuth/session
   data, research contents, email addresses, or arbitrary user properties.
5. Keep autocapture, automatic page views, page leaves, replay, and person
   profiles disabled. Update the runtime schemas and privacy notice before
   adding any new event or property.

## Logical database backup

The scheduled `.github/workflows/database-backup.yml` workflow runs at 06:17
UTC daily with a non-overlapping concurrency group. Protect its `production`
GitHub environment and configure these environment secrets:

```txt
DIRECT_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ENDPOINT, only when required
BETTER_STACK_BACKUP_HEARTBEAT_URL
BETTER_STACK_BACKUP_FAILURE_HEARTBEAT_URL
```

The token must be restricted to the private PortfolioScope R2 bucket. The script
runs `pg_dump` against `DIRECT_URL`, creates a gzip-compressed plain SQL export,
records a SHA-256 checksum in object metadata, and writes these prefixes:

```txt
backups/postgres/{environment}/daily/
backups/postgres/{environment}/weekly/
backups/postgres/{environment}/monthly/
```

It retains the newest 7 daily, 4 weekly, and 3 monthly objects. Sunday creates a
weekly generation and the first UTC day of a month creates a monthly generation.
Run a manual backup from a trusted operator host with PostgreSQL client tools
installed:

```bash
npm ci
npm run backup:postgres
```

Load the same variables as the workflow and set `BACKUP_ENVIRONMENT` explicitly.
Never paste command output containing connection strings into tickets.

## Non-production restore drill

Create a clean, isolated database that does not share a host with either
application database. The restore script intentionally refuses Production,
non-empty databases, unapproved hosts, application-database hosts, and
unrecognized R2 keys. It downloads into a guarded temporary directory and
verifies the archive against its SHA-256 object metadata before sending SQL to
PostgreSQL.

```bash
RESTORE_CONFIRMATION=RESTORE_NON_PRODUCTION \
RESTORE_TARGET_ENVIRONMENT=restore-drill \
RESTORE_ALLOWED_HOSTS=exact-restore-host.example \
RESTORE_DATABASE_URL=postgresql://... \
BACKUP_OBJECT_KEY=backups/postgres/production/daily/...sql.gz \
npm run restore:postgres
```

Also load the server-only `R2_*` values. Then:

1. Run `npx prisma validate` and `npm run db:deploy` against the restored target.
2. Start the application with the restored target as both local runtime and
   migration URLs.
3. Run the Playwright smoke tests.
4. Verify one disposable OAuth/database session, the read-only demo, latest job
   states, SEC facts, and persisted research reports.
5. Remove the isolated drill database through its provider controls.
6. Record the timestamp and non-secret evidence reference as
   `LAST_RESTORE_DRILL_AT` and `LAST_RESTORE_DRILL_REFERENCE`, then redeploy so
   administrators can see the latest evidence.

Do not set these evidence variables until every validation step succeeds. A
repository test proves the command guards and retention policy; it does not
replace the real restore drill.

## Security and pull-request automation

GitHub Actions runs database-backed checks and Playwright critical journeys.
Dependabot proposes bounded dependency and Actions updates. CodeQL scans
JavaScript/TypeScript, and Gitleaks scans repository history for committed
secrets. The CodeQL workflow uses the current v4 action family with only
`actions: read`, `contents: read`, and `security-events: write`; keep the
`pull_request` trigger for safe fork and Dependabot analysis rather than using
`pull_request_target` to execute untrusted code. Merge Dependabot updates with
repository auto-merge using a merge commit rather than a Dependabot-authored
squash commit, which can leave the subsequent `push` run with a read-only token.
In repository settings:

1. Protect `main`.
2. Require pull requests and the CI, CodeQL, and Gitleaks status checks.
3. Require branches to be current before merge.
4. Prevent force pushes and deletion.
5. Enable GitHub secret scanning and push protection where the repository plan
   supports them.
6. Review high/critical dependency findings before release; do not use a forced
   semver-major audit fix without a compatibility review.

## Release record

For every Production release record the commit SHA, operator, migrations,
feature-flag changes, backup evidence, Preview checks, deployment URL, smoke
test time, Sentry release, monitor state, and rollback target. Incident notes
must include the first observed time, user impact, request/correlation IDs,
mitigation, data-integrity assessment, recovery evidence, and follow-up owner.

At least monthly, open every provider link in the administrator cost panel,
compare current usage with the service free allowance and the `<$30 USD` hard
budget, reconcile OpenAI application reservations against its console when
enabled, and record the review timestamp/reference. Do not add billing API
credentials merely to automate this low-frequency review.

## Verification checklists

### Preview

- [ ] GitHub Actions passed install, Prisma generation, schema validation, migration, seed safety, lint, typecheck, tests, and build.
- [ ] Preview URL loads over HTTPS.
- [ ] Preview uses the non-production Neon database.
- [ ] No production user or demo changes appear in Preview.
- [ ] Landing, demo, dashboard, holdings, watchlist, alerts, stock detail, and research tabs render.
- [ ] Supported stock detail shows SEC missing/provenance states without a live page-time SEC request; unsupported Shopify is labelled unsupported.
- [ ] TradingView attribution remains visible and widget failure leaves SEC and demo content usable.
- [ ] `/auth/signin` renders controlled provider availability and the demo fallback.
- [ ] A signed-out request to `/app` redirects to sign-in.
- [ ] A `USER` session is rejected from `/admin`.
- [ ] GitHub and Google callbacks are tested only when the stable staging credentials are configured.
- [ ] Holding, watchlist, and research mutations return controlled `403` read-only responses.
- [ ] `/api/health` returns `200`.
- [ ] `/api/ready` returns `200` with a working Preview database.
- [ ] A failed database check returns controlled `503` without sensitive details.
- [ ] Preview Sentry receives a controlled test error.
- [ ] A Preview `ADMIN` can ingest one fixture/review ticker into the non-production R2 bucket; a `USER` and anonymous request are rejected.
- [ ] An unsigned QStash worker request returns `401` before job access.
- [ ] A signed Preview job records its attempt and reaches a terminal PostgreSQL state; replay is acknowledged without duplicate work.
- [ ] Redis limits return controlled `429` responses, recover after their window, and do not leak identifiers in keys.
- [ ] Admin job details, retry/cancel authorization, correlation IDs, and ticker freshness render correctly.
- [ ] Both named schedules exist once with the reviewed HTTPS destination and UTC cadence.
- [ ] M18 migration is applied with AI disabled; historical reports remain deterministic.
- [ ] Offline AI evaluation and recorded-provider cases pass with no private inputs.
- [ ] One bounded external Preview report is source-reviewed; citations,
  counter-evidence, missing data, versions, history/diff, and partial failures render.
- [ ] AI reservation/settlement and provider request usage match the OpenAI console;
  no unresolved `UNCONFIRMED` charge remains before further activation.
- [ ] Toggling `AI_RESEARCH_ENABLED=false` stops the next provider/repair attempt
  without breaking stock pages or deterministic history.
- [ ] Playwright public and authenticated journeys pass against the isolated Preview database.
- [ ] CSP, HSTS, frame, referrer, permissions, and content-type headers match policy; TradingView remains usable.
- [ ] Preview Sentry client/server/job errors carry the reviewed release and correlation context without private payloads.
- [ ] PostHog receives only schema-approved events and no private financial or identity values.
- [ ] Better Stack controlled outage, missed heartbeat, and recovery notifications were received.
- [ ] A logical backup exists under each generation that is due, with checksum metadata.
- [ ] A clean non-production restore drill completed and its evidence was recorded.
- [ ] An administrator can view dependency status, flags, backup/restore evidence, job failures, and freshness without secrets.

### Production

- [ ] Canonical domain and redirect use HTTPS.
- [ ] Homepage and one-click demo work without registration.
- [ ] GitHub and Google sign-in each create or reuse the expected user, linked account, and database session.
- [ ] Sign-out invalidates the current session; account settings can revoke all sessions.
- [ ] OAuth denial/callback failures render `/auth/error` without provider secrets or stack traces.
- [ ] Account deletion is verified with a disposable user and leaves the demo identity intact.
- [ ] `/app` rejects anonymous visitors and `/admin` rejects a normal `USER`.
- [ ] Dashboard period selector and all major M10 pages render.
- [ ] Public demo mutation attempts are rejected server-side.
- [ ] Deterministic seeded data is clearly labelled and persists across deployments.
- [ ] Supported stock pages display reviewed SEC facts with period, form, accession, filed/retrieved dates, freshness, and source link.
- [ ] Raw submissions and Company Facts objects exist only in the private Production R2 bucket.
- [ ] The latest selected facts for every backfilled ticker were manually compared with the linked filing; ambiguous facts remain unavailable.
- [ ] TradingView attribution is visible and no widget values are stored as PortfolioScope data.
- [ ] `/api/health` and `/api/ready` return `200`.
- [ ] Production Sentry environment is correct.
- [ ] Better Stack homepage and health monitors are green and notifications were tested.
- [ ] Browser source and network payloads contain no server secrets.
- [ ] Production M15 flags were enabled in documented order after signed delivery proof.
- [ ] A duplicate active SEC/research request reuses existing work and a completed QStash replay is a no-op.
- [ ] Upstash usage remains inside the reviewed free allowances.
- [ ] If external AI is approved, its separately scoped Production key, provider
  billing control, `$5` application maximum, source/privacy review, one bounded
  report, usage reconciliation, and kill-switch proof are recorded.
- [ ] The previous Vercel production deployment is identifiable for rollback.
- [ ] Production CSP/security headers are active and the TradingView widget still renders.
- [ ] Sentry release/source-map mapping and privacy scrubbing are verified.
- [ ] PostHog event volume and properties match the approved taxonomy.
- [ ] Worker, backup-success, and backup-failure heartbeats are visible.
- [ ] The latest scheduled R2 backup is visible in admin diagnostics and retention remains within policy.
- [ ] The last successful non-production restore drill is visible in admin diagnostics.
- [ ] Dependabot, CI, CodeQL, Gitleaks, branch protection, and required checks are active.
- [ ] Neon, R2, Redis, QStash, Vercel, Sentry, PostHog, OpenAI when enabled, and CI usage remains inside the monthly budget.

## Rollback and forward fix

### Application failure

1. Record the failing deployment, time, and visible symptom.
2. Use Vercel deployment history or `vercel rollback` to restore the previous production deployment.
3. Verify the homepage, demo, `/api/health`, and `/api/ready`.
4. Confirm Better Stack recovery and annotate the Sentry incident.

Vercel Hobby currently limits CLI rollback to the previous production deployment; confirm current platform behavior in the [Vercel rollback documentation](https://vercel.com/docs/cli/rollback).

### Database failure

- Do not reset production.
- Stop the release before deploying incompatible application code.
- Prefer an additive forward-fix migration.
- If an application rollback would be incompatible with an already-applied migration, keep the compatible application deployed and forward-fix the database or code.
- Rerun `npm run db:deploy`; committed Prisma migrations are designed to be repeatable.
- Rerun `npm run db:seed` only when deterministic demo records need repair. The seed is demo-scoped and idempotent.

### Job or cache failure

1. Set `AI_RESEARCH_ENABLED=false` first. If credentials or unexpected billing
   may be involved, revoke/rotate the OpenAI key and apply the provider spending
   stop. The runner checks the flag before every external attempt and repair.
2. Set `SEC_INGESTION_ENABLED=false` and
   `RESEARCH_GENERATION_ENABLED=false` to stop expensive publishers.
3. Pause `portfolioscope-recover-stale-jobs` and
   `portfolioscope-refresh-stale-sec` in QStash.
4. Set `BACKGROUND_JOBS_ENABLED=false` if generic delivery itself is unsafe.
5. Do not delete job, attempt, usage, claim, evidence, or control-event rows.
   Preserve provider request IDs and reconcile `UNCONFIRMED` charges. Use `/admin` to capture
   correlation IDs and sanitized errors.
6. Allow running work to finish or time out. Cancel only queued/retrying work.
7. Forward-fix code or configuration, redeploy, prove one signed Preview job,
   then retry eligible failed jobs and restore flags/schedules gradually.

Do not down-migrate the additive M18 tables during an incident. A compatible
application rollback may ignore them; otherwise deploy a forward fix.

### Monitoring failure

Sentry and Better Stack are optional application dependencies. A monitoring outage must not make PortfolioScope unready. Confirm the application directly, record the monitoring outage, and restore monitoring without changing user data.

## External activation record

Complete this table during the real deployment. Do not mark an item complete without direct evidence.

| Item | Status | Evidence |
| --- | --- | --- |
| Vercel project connected | Not verified | Deployment URL and timestamp |
| Preview deployment isolated | Not verified | Preview URL and non-production database confirmation |
| Neon production database provisioned | Not verified | Project/branch recorded outside source control |
| Production migrations applied | Not verified | Command output or deployment log |
| Production seed completed | Not verified | Demo smoke test |
| GitHub OAuth callback verified | Not verified | Disposable sign-in and callback timestamp |
| Google OAuth callback verified | Not verified | Disposable sign-in and callback timestamp |
| Session revocation verified | Not verified | Disposable multi-session test |
| Account deletion verified | Not verified | Disposable user and cascade check |
| Private R2 bucket and least-privilege token verified | Not verified | Bucket policy and test object metadata |
| SEC user-agent/contact verified | Not verified | Controlled request and operator review |
| M15 migrations applied | Not verified | Deployment log showing both ordered migration names |
| Preview/Production M18 migration applied with AI disabled | Not verified | Environment-specific migration log and historical deterministic-report check; local deployment already passes |
| OpenAI Preview project/key and billing control configured | Not verified | Non-secret project reference, pricing review, and alert/spending-stop evidence |
| Offline AI evaluation and manual rubric passed | Not verified | Versioned regression result and reviewer record |
| External-AI private-data exclusion reviewed | Not verified | Outbound-contract/log/browser/analytics inspection record |
| Bounded Preview AI report source-reviewed | Not verified | Job/report IDs, version tuple, cited-source checklist, and reviewer |
| Preview AI usage reconciled | Not verified | Reservation/settlement, provider request ID, and console charge |
| AI kill switch and degradation verified | Not verified | Controlled test time and stock-page/deterministic-history result |
| Production AI explicitly approved and bounded | Not verified | Approval, one report ID, source/privacy/usage proof; leave disabled otherwise |
| Preview Redis/QStash isolated | Not verified | Resource identifiers recorded outside source control |
| Signed QStash delivery verified | Not verified | Preview job ID, attempt, and terminal status |
| M15 rate limits verified | Not verified | Controlled `429` and recovery timestamp |
| Maintenance schedules configured | Not verified | Two named schedule IDs and reviewed UTC cadence |
| M14 migration and supported registry seed applied | Not verified | Migration log and 25-company count |
| Initial SEC backfill reviewed | Not verified | Per-ticker run IDs and filing comparison checklist |
| TradingView attribution/failure state verified | Not verified | Production stock-page smoke test |
| Custom domain and HTTPS active | Not verified | Canonical URL and certificate check |
| Sentry controlled error received | Not verified | Sentry event ID |
| Better Stack monitor active | Not verified | Monitor ID and test notification |
| Better Stack worker heartbeat active | Not verified | Heartbeat ID, success, missed signal, and recovery timestamps |
| Better Stack backup heartbeats active | Not verified | Success/failure heartbeat IDs and notification evidence |
| PostHog privacy review complete | Not verified | Event/property export reviewed in Preview |
| First automated R2 backup complete | Not verified | Object key prefix, timestamp, size, and checksum metadata |
| Non-production restore drill complete | Not verified | Timestamp and non-secret evidence reference |
| Security headers and TradingView CSP verified | Not verified | Header capture and widget smoke-test timestamp |
| Security automation and branch protection active | Not verified | Required-check names and repository settings review |
| Previous Vercel deployment restored/tested | Not verified | Rollback drill date and deployment ID |
