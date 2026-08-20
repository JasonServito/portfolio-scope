# Performance Measurement

## M22 request-path evidence

M22 measured the existing M21 workflows before changing their request paths.
The repeatable harness is `npm run demo:request-paths`, implemented by
`scripts/measure-m22-request-paths.mjs`. It rejects non-loopback application and
database URLs, creates one disposable authenticated fixture, blocks external
traffic, runs each scenario multiple times, and removes the fixture afterward.

### Conditions

- Baseline: commit `d10855c`, before M22 application changes.
- Comparison: optimized production build from the M22 working tree.
- Date: 2026-08-18.
- Runtime: Next.js 16.3 production mode on Windows, headless Chromium, and the
  repository's isolated PostgreSQL 16 Docker service with deterministic seed
  data.
- Application URL and database were loopback-only. Redis, QStash, background
  work, and SEC ingestion were disabled. Public stock pages were enabled.
- Third-party traffic, including TradingView, was blocked so provider variance
  could not distort application-path timings. The existing TradingView loading
  and failure UI remained visible.
- Each reported route and interaction median uses five runs from the same
  harness. The first sample was retained, and clean-server diagnostics were
  captured separately to distinguish cold process/database state. The final
  five-run comparison includes the stabilized analytics-sharing implementation.

These local numbers are comparison evidence, not production latency targets.
Neon and serverless cold starts remain deployment-dependent.

### Representative scenarios

- Public: `/` and `/stocks/aapl`.
- Read-only demo: `/dashboard?demo=true`.
- Authenticated: `/app`, `/app/watchlist`, and dashboard-to-watchlist client
  navigation.
- Mutations: authenticated portfolio creation and watchlist creation, including
  the canonical refresh that makes persisted data visible.

### Before and after

| Scenario | Metric | Baseline median | M22 median | Result |
| --- | ---: | ---: | ---: | ---: |
| Public landing | TTFB | 18.8 ms | 7.9 ms | 58% lower |
| Public landing | Heading ready | 195.7 ms | 71.8 ms | 63% lower |
| Public landing | Application requests through settled route | 11 | 1 | 91% fewer |
| Public stock detail | Server response complete | 223.0 ms | 118.5 ms | 47% lower |
| Public stock detail | Heading ready | 476.1 ms | 427.0 ms | 10% lower; client/widget boundary remains |
| Demo dashboard | Server response complete | 146.5 ms | 79.9 ms | 45% lower |
| Demo dashboard | Heading ready | 204.3 ms | 165.6 ms | 19% lower |
| Authenticated dashboard | TTFB | 26.8 ms | 15.6 ms | 42% lower |
| Authenticated dashboard | Heading ready | 444.3 ms | 342.3 ms | 23% lower |
| Authenticated watchlist | TTFB | 25.0 ms | 15.3 ms | 39% lower |
| Authenticated watchlist | Heading ready | 443.5 ms | 137.0 ms | 69% lower |
| Dashboard to watchlist | Loading feedback | 355.3 ms | 37.2 ms | 90% sooner |
| Dashboard to watchlist | Destination ready | 360.9 ms | 345.7 ms | 4% lower |
| Dashboard to watchlist | Application requests | 1 | 1 | No request-count regression |
| Portfolio creation | API response | 54.5 ms | 35.9 ms | 34% lower |
| Portfolio creation | Settled UI | 145.8 ms | 65.3 ms | 55% lower |
| Portfolio creation | Application requests through settled UI | 9 | 2 | 78% fewer |
| Watchlist creation | API response | 58.3 ms | 60.6 ms | Comparable; 4% higher |
| Watchlist creation | Settled UI | 145.1 ms | 103.2 ms | 29% lower |
| Watchlist creation | Application requests through settled UI | 9 | 2 | 78% fewer |

The first cold database-backed stock request in clean-server runs still showed a
roughly 0.44-0.49 second TTFB, while warm samples were 12-31 ms. This is the
observed local connection/process lower bound, not a reason to add infrastructure.
The stock route's warm server response improved by eliminating repeated reads;
its later browser-ready point is dominated by client rendering and the explicitly
non-blocking TradingView boundary.

### Evidence-backed causes and fixes

1. An authenticated watchlist render called the session resolver from the
   layout, header, and page. PostgreSQL logging showed three session reads,
   three matching user reads, and one watchlist read. Request-scoped React
   memoization reduces the same render to one session read, one user read, and
   one watchlist read: seven reads to three without changing authorization.
2. Automatic viewport prefetching issued RSC requests for every visible
   data-backed link. A route could schedule up to 16 application requests, and a
   single mutation plus `router.refresh()` produced nine in the comparable
   harness. Data-backed links now avoid viewport prefetching, so a mutation
   performs only its API request and one canonical refresh. Intentional client
   navigation remains one RSC request.
3. Resolving session state in the public header forced otherwise static public
   pages through the request renderer. The header now uses a session-independent
   `Open app` entry; `/`, `/privacy`, and `/disclaimer` are prerendered. Private
   account and sign-out controls remain on authenticated/demo application shells.
4. Stock detail, dashboard alerts, and the holdings comparison loaded the same
   portfolio graph repeatedly for different periods. The analytics service now
   loads it once per page workflow, derives all requested periods in memory, and
   shares that result with risk-alert derivation. Focused tests enforce the
   one-load contract, and the measured stock response time fell by 47%.

### Remaining latency and feedback

Authenticated dashboard-to-watchlist navigation starts an accessible loading
state in 33-46 ms (37.2 ms median) and announces `Loading account view.` while
its one RSC request finishes. The same feedback is present for the alerts route.
Ownership-sensitive detail routes stay outside these streaming boundaries so
their not-found responses retain HTTP 404 semantics.
The TradingView widget continues to load independently, preserves attribution,
and exposes its existing useful failure state. No request path waits on
readiness checks, SEC network calls, TradingView, Redis, QStash, or an external
AI provider during these scenarios.

No cache TTL, authorization, ownership, data-correctness, provider, readiness,
rate-limit, or failure-mode semantics changed. No new infrastructure,
dependency, environment variable, service, or cost was introduced.
