# PortfolioScope Production Runbook

This runbook covers M11 only: Vercel hosting, Neon PostgreSQL, environment separation, the deterministic demo, CI, health checks, initial Sentry error monitoring, Better Stack uptime monitoring, domain setup, release verification, and rollback.

Authentication, SEC ingestion, Redis, QStash, R2 source storage, external AI, and later production controls are not part of M11.

## Service inventory and cost

| Service | M11 purpose | Initial tier | Expected monthly change |
| --- | --- | --- | ---: |
| Vercel | Next.js production and preview deployments | Hobby, while non-commercial terms apply | $0 |
| Neon | Separate production and non-production PostgreSQL | Free | $0 |
| GitHub Actions | Pull-request and main-branch validation | Public-repository allowance | $0 |
| Sentry | Initial client and server error capture | Free | $0 |
| Better Stack | Homepage and health uptime checks | Free | $0 |
| Cloudflare | Domain registration and DNS | Domain registration only | About $1–2, annualized |

Expected M11 monthly infrastructure change: approximately `$1–2 USD`, entirely from the annualized domain cost. Do not enable a paid tier or uncapped usage without updating this table and the project cost review.

## Environment matrix

Configure each environment independently. Never copy production database credentials into Preview.

| Variable | Local | Preview | Production | Secret |
| --- | --- | --- | --- | ---: |
| `DATABASE_URL` | Local pooled/runtime URL | Non-production Neon pooled URL | Production Neon pooled URL | Yes |
| `DIRECT_URL` | Local direct URL | Non-production Neon direct URL | Production Neon direct URL | Yes |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Stable staging URL or current preview origin | Canonical HTTPS origin | No |
| `DEMO_USER_EMAIL` | Dedicated demo identity | Dedicated non-production demo identity | Dedicated production demo identity | No |
| `SENTRY_DSN` | Blank or development project | Preview project/DSN | Production project/DSN | Treat as server configuration |
| `NEXT_PUBLIC_SENTRY_DSN` | Blank or development project | Preview project/DSN | Production project/DSN | No; DSNs are client-visible |
| `SENTRY_ENVIRONMENT` | `local` | `preview` | `production` | No |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `local` | `preview` | `production` | No |
| `SENTRY_ORG` | Blank unless uploading source maps | Sentry organization slug | Sentry organization slug | No |
| `SENTRY_PROJECT` | Blank unless uploading source maps | Preview project slug | Production project slug | No |
| `SENTRY_AUTH_TOKEN` | Blank | Build-only token | Build-only token | Yes |

Rules:

- `DATABASE_URL` is the pooled connection used by Prisma Client in serverless functions.
- `DIRECT_URL` is the non-pooled connection used by Prisma CLI migrations.
- Give `SENTRY_AUTH_TOKEN` only to build environments that upload source maps. Never prefix it with `NEXT_PUBLIC_`.
- Leave Sentry DSNs blank to disable reporting without changing code.
- Vercel Preview and Production values must point to separate Neon projects or databases.
- The public demo is read-only whenever `NODE_ENV=production`, including Vercel preview and production builds. Local and automated-test CRUD remains available.

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

The seed uses deterministic upserts, updates only the configured demo identity and shared seeded catalog, and does not delete non-demo users. `npm run test:integration` is intentionally blocked when `NODE_ENV` or `VERCEL_ENV` is `production`; run that check only against local or Preview databases.

For the first M11 release, apply migrations and seed before promoting the application. For future schema changes, use additive migrations, test against Preview first, back up before destructive work, and prefer a forward fix over a production down migration.

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

Do not add SEC, TradingView, or other expensive external requests to readiness.

## Sentry activation

1. Create separate Preview and Production Sentry projects or distinguish them with the configured environment tags.
2. Set the DSN and environment values from the matrix.
3. Set `SENTRY_ORG`, `SENTRY_PROJECT`, and a build-only `SENTRY_AUTH_TOKEN` when source-map upload is enabled.
4. Redeploy; environment changes do not affect already-built deployments.
5. In a temporary Preview-only change, trigger one controlled client error using Sentry's documented verification pattern.
6. Confirm the issue has the `preview` environment and a readable application stack.
7. Remove the temporary trigger before merging.
8. Repeat with a controlled server error in Preview if server capture also needs verification.

The checked-in SDK configuration sends no default PII and enables neither tracing nor session replay. Follow the official [Sentry Next.js manual setup and verification guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) for the temporary test.

## Better Stack activation

Create HTTP monitors for:

| Monitor | URL | Expected result |
| --- | --- | --- |
| Homepage | Canonical production origin | HTTP 200 |
| Liveness | `/api/health` | HTTP 200 and `"status":"ok"` |

Use a free-tier interval, enable SSL verification, configure an owned notification destination, and send a test notification. Add `/api/ready` as a separate dependency monitor only if database wake-up behavior does not create noisy alerts. Better Stack supports expected-status and keyword monitors; see its [monitor API reference](https://betterstack.com/docs/uptime/api/create-a-new-monitor/).

## Verification checklists

### Preview

- [ ] GitHub Actions passed install, Prisma generation, schema validation, migration, seed safety, lint, typecheck, tests, and build.
- [ ] Preview URL loads over HTTPS.
- [ ] Preview uses the non-production Neon database.
- [ ] No production user or demo changes appear in Preview.
- [ ] Landing, demo, dashboard, holdings, watchlist, alerts, stock detail, and research tabs render.
- [ ] Holding, watchlist, and research mutations return controlled `403` read-only responses.
- [ ] `/api/health` returns `200`.
- [ ] `/api/ready` returns `200` with a working Preview database.
- [ ] A failed database check returns controlled `503` without sensitive details.
- [ ] Preview Sentry receives a controlled test error.

### Production

- [ ] Canonical domain and redirect use HTTPS.
- [ ] Homepage and one-click demo work without registration.
- [ ] Dashboard period selector and all major M10 pages render.
- [ ] Public demo mutation attempts are rejected server-side.
- [ ] Deterministic seeded data is clearly labelled and persists across deployments.
- [ ] `/api/health` and `/api/ready` return `200`.
- [ ] Production Sentry environment is correct.
- [ ] Better Stack homepage and health monitors are green and notifications were tested.
- [ ] Browser source and network payloads contain no server secrets.
- [ ] The previous Vercel production deployment is identifiable for rollback.

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
| Custom domain and HTTPS active | Not verified | Canonical URL and certificate check |
| Sentry controlled error received | Not verified | Sentry event ID |
| Better Stack monitor active | Not verified | Monitor ID and test notification |
| Previous Vercel deployment restored/tested | Not verified | Rollback drill date and deployment ID |
