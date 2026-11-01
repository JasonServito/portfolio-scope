# Earnings Date Decision

## M26 feasibility result

Before M26, PortfolioScope did not have a reliable source for future earnings
dates. The existing SEC submissions and company-facts integrations were
authoritative for filings that have already been disseminated, but they do not
publish a normalized calendar of future company earnings announcements. Stored
demo prices and historical filings cannot be used to invent a future date.

EarningsAPI.com was approved for M26 implementation on 2026-08-21 because its
public terms expressly permit retrieving and displaying earnings content in an
application or website, its documentation supports the per-symbol workflow M26
needs, and its free quota fits the repository's bounded 25-ticker catalog. The
adapter and normalized PostgreSQL persistence are implemented. The bounded
provider contract, cache/licensing, normal synchronization, and controlled
Redis-unavailable fail-closed checks all passed, and Production synchronization
is enabled with `EARNINGS_SYNC_ENABLED=true`.

## Feasibility evidence

| Option                              | Accuracy and source semantics                                                                                                                                                                                                                                                                                                                                                                                                                                  | Licensing, reliability, and cost                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | M26 result                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Existing SEC integration            | SEC submissions and XBRL APIs update after filings are disseminated. They provide historical filing and report dates, not a normalized future earnings calendar.                                                                                                                                                                                                                                                                                               | Existing approved source, cache, ingestion, and cost boundaries remain appropriate for reported fundamentals. Estimating a future announcement from filing history would create a date the source did not report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Retain for historical fundamentals; do not derive upcoming dates.                               |
| Issuer investor-relations pages     | A company announcement can be authoritative when present, but formats, timing, and publication channels differ across the 25-company catalog.                                                                                                                                                                                                                                                                                                                  | Manual maintenance becomes stale; automated scraping would add many brittle parsers and unclear reuse terms. It would not provide a simple, reliable failure contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Not selected.                                                                                   |
| TradingView or Nasdaq display pages | Human-readable calendars may display upcoming events, but the repository has no approved programmatic contract for extracting and aggregating those values.                                                                                                                                                                                                                                                                                                    | Scraping or reusing display-only data would violate the existing provider boundary and would have unclear redistribution rights and failure behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Not selected.                                                                                   |
| EarningsAPI.com company earnings    | `/v1/earnings?symbol=...` returns historical and upcoming JSON rows with `date`, `symbol`, nullable `name` and market-session `time`, and nullable estimated/actual EPS and revenue. It does not expose a confirmation flag, fiscal-period end, currency, event ID, or provider update timestamp. PortfolioScope therefore calls future dates **expected**, preserves them as date-only, treats missing time as unknown, and attaches its own fetch timestamp. | Public terms permit retrieving and displaying earnings content in an application or website and allow returned content to be styled. The official watchlist guide says to call once per symbol, choose the nearest future row, and store it next to the symbol. The terms prohibit republishing the proprietary feed and do not state a cache-retention period, so M26 persists only the normalized nearest event, never exposes raw responses, and retains it only for bounded freshness/failure handling. The free tier is 60 requests/minute, 100/day, and 1,000/month, reset in New York time. No attribution requirement is published, although the content remains the provider's property and PortfolioScope identifies the source for provenance. The provider disclaims uptime, accuracy, and completeness. | **Selected, implemented, and validated in Production.**                                         |
| Alpha Vantage earnings calendar     | One CSV request can return the next three months of expected earnings, including symbol, report date, fiscal-period end, estimate, and currency. A daily whole-calendar refresh would fit the published standard limit. The source does not expose a confirmed-date flag or announcement timezone, so every future date must remain labelled estimated and date-only.                                                                                          | The standard service allows 25 requests per day and may verify open-source or educational projects for higher limits. Its standard terms grant personal, non-commercial use and direct commercial users to sales; they do not clearly grant display to users of a deployed application. Expected API cost is $0 only if PortfolioScope's use is confirmed as permitted.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Technically viable, but superseded by EarningsAPI.com's clearer application-display permission. |
| Financial Modeling Prep             | The earnings calendar exposes future dates and a provider `lastUpdated` value.                                                                                                                                                                                                                                                                                                                                                                                 | Corporate calendars start on the published Premium plan at $59 USD/month, above the entire project budget, and displayed or redistributed data requires a separate display/licensing agreement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Not selected.                                                                                   |
| Finnhub                             | The calendar exposes coming releases, date, and before/after-market timing; its free tier includes new updates.                                                                                                                                                                                                                                                                                                                                                | Published paid plans start at $49.99/month and are licensed for personal use. Application-display rights are not established and the price exceeds the project budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Not selected.                                                                                   |

Sources checked on 2026-08-21:

- [SEC EDGAR application programming interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [EarningsAPI.com company earnings endpoint](https://www.earningsapi.com/docs/earnings)
- [EarningsAPI.com watchlist monitor guide](https://www.earningsapi.com/docs/examples/watchlist-monitor)
- [EarningsAPI.com terms, permitted use, and fair-use limits](https://www.earningsapi.com/terms)
- [EarningsAPI.com documentation quota summary](https://www.earningsapi.com/docs)
- [Alpha Vantage earnings calendar documentation](https://www.alphavantage.co/documentation/#earnings-calendar)
- [Alpha Vantage support and request limits](https://www.alphavantage.co/support/)
- [Alpha Vantage terms of service](https://www.alphavantage.co/terms_of_service/)
- [Financial Modeling Prep earnings calendar documentation](https://site.financialmodelingprep.com/developer/docs#earnings-calendar)
- [Financial Modeling Prep pricing and display notice](https://site.financialmodelingprep.com/pricing-plans)
- [Finnhub earnings calendar documentation](https://finnhub.io/docs/api/earnings-calendar)
- [Finnhub pricing and license summary](https://www.finnhub.io/pricing-stock-api-market-data)

## EarningsAPI.com quota and cache assessment

The repository catalog currently contains 25 supported tickers. At most one
successful or failed provider attempt per ticker per New York calendar day uses:

| Window       | Catalog refresh usage | Published free limit |     Headroom |
| ------------ | --------------------: | -------------------: | -----------: |
| One minute   |           25 requests |          60 requests |  35 requests |
| One day      |           25 requests |         100 requests |  75 requests |
| 31-day month |          775 requests |       1,000 requests | 225 requests |

The monthly limit is the binding constraint. A full daily automatic retry would
use up to 1,550 requests in a 31-day month and is not safe. A normal cache lock
is insufficient because an empty result, provider failure, or failed persistence
could otherwise be retried after the lock is released. The implementation uses
an atomic Redis daily-attempt claim keyed by ticker and New York date. The claim
must be stored successfully before the external call, survives success, an empty
result, failure, and PostgreSQL write failure through the daily boundary, and
fails closed if Redis cannot distinguish a miss from an infrastructure error.

User routes never refresh only the symbols selected from that user's holdings or
watchlist. A stale or missing persisted observation may trigger a fixed
catalog-wide sweep of all 25 supported tickers. An outer atomic daily sweep claim
keeps ordinary page loads to a constant two Redis operations (claim plus retained
outcome); the winning sweep also checks a retained daily claim for each ticker
before owner-scoped results are filtered locally. The retained outcome makes an
in-flight or failed sweep explicit to later requests. The provider then observes
only the repository's public catalog rather
than a private user's collection. Holdings, watchlists, user IDs, and portfolio
contents must never be sent to EarningsAPI.com.

The free allowance also cannot be shared casually across Production, Preview,
local development, manual probes, or tests. Live calls require an explicit
default-off Production feature flag, the server-only key, and successful Redis
claim access. Preview, development, automated tests, and manual tooling
must default to deterministic recorded or unavailable behavior. Provider URLs,
keys, and raw errors must be redacted from application logs and user responses.
A cache outage must fail closed to stale or unavailable data instead of bypassing
quota controls.

The provider documentation expressly describes recurring daily refreshes,
watchlist integrations, and storing the selected next event. That supports a
bounded application record. The terms do not explicitly define cache duration
or grant bulk-feed redistribution. PortfolioScope therefore retains only a
normalized nearest upcoming event plus its application fetch time in
PostgreSQL, uses a 36-hour freshness threshold with a maximum 72-hour fail-stale
retention window, and never exposes or persists the raw historical response.
Expired rows are pruned on earnings reads and by the existing maintenance job;
they are never displayed beyond 72 hours. Written clarification
from the provider about this bounded cache would reduce licensing uncertainty,
but the published documentation and terms are materially clearer than Alpha
Vantage for M26's use.

PostgreSQL is authoritative for that normalized event. Redis stores only the
daily-attempt claim and may be used for locks or deduplication; it is never the
only copy of persistent earnings state. If Redis is unavailable, PortfolioScope
makes no uncoordinated provider request and continues serving the most recent
valid PostgreSQL observation inside the 72-hour window.

The provider does not publish a supported-symbol universe or completeness
commitment. After service approval and before Production activation, a bounded
live contract check must validate all 25 catalog symbols. A valid empty array is
a cacheable unknown state, not a provider failure. This check is provider
activation evidence, not an automated test dependency. The dedicated
`npm run earnings:contract-check:approved` harness pins this catalog, requires an
explicit one-run Production approval, rejects redirects without following them,
performs no retries, and imports no PostgreSQL or Redis boundary.

## Implemented M26 boundary

The approved implementation remains one small slice:

- add a server-only provider adapter with runtime validation and JSON parsing;
- extend the existing cache boundary with atomic daily sweep and per-ticker
  attempt claims so cache errors fail closed, ordinary page loads do not issue
  25 Redis commands, and every ticker receives at most one provider attempt per
  New York day;
- refresh the fixed 25-symbol catalog globally, independent of any user's
  followed symbols, normalize only each ticker's nearest future event, and
  persist it in PostgreSQL;
- select that event by validating, filtering, and sorting date-only rows against
  the New York market date rather than trusting provider response order;
- include an event dated today as expected, but never render a cached event dated
  before the current New York date even when it remains inside fail-stale
  retention;
- require Redis sweep/attempt claims and the default-off Production feature flag
  for live calls, with no automatic same-day retry and no cache-bypass path;
- aggregate an authenticated user's owned holding and watchlist tickers in a
  single owner-scoped database query, then deduplicate by ticker;
- show an Upcoming Earnings page with date-only expected events, normalized
  market-session timing where supplied, source, application-fetched-at, stale,
  unknown, and provider-unavailable states;
- keep stale cached observations visible during a transient provider failure and
  show an explicit unavailable state when no valid cache exists;
- add the private navigation entry and deterministic provider, cache, ownership,
  date, duplicate, unknown, stale, failure, and browser coverage required by the
  M26 contract.

The repository's fixed supported-company registry contains 25 tickers. The
currently seeded and user-manageable `Stock` universe is broader: it also
contains `SHOP`, and management accepts any existing stock row. M26 deliberately
does not broaden the provider catalog or narrow existing portfolio/watchlist
behavior. A followed out-of-registry ticker such as `SHOP` is displayed as
unsupported and never causes a provider request.

This approach requires one server-only API key, one default-off feature flag,
the already-supported Upstash Redis service in the live environment, and the
additive `UpcomingEarningsState` PostgreSQL migration. It requires no schedule,
new runtime dependency, private-data disclosure, or user-scoped provider call.

## Production activation gate

The project owner approved EarningsAPI.com and the implementation controls on
2026-08-21. The following Production activation requirements were subsequently
completed:

1. a server-only API key and confirmation that expected cost remains `$0` under
   the published free limits;
2. one bounded 25-symbol contract and coverage check in an approved environment;
3. final confirmation that deployed use and normalized 72-hour PostgreSQL
   retention are acceptable if the published terms are considered insufficient;
4. Redis and the additive PostgreSQL migration in Production, with
   `EARNINGS_SYNC_ENABLED=false` until every check is complete; and
5. acceptance of the residual risk that the public terms do not specify cache
   retention, the upstream source/provenance is not documented, accuracy and
   uptime are not guaranteed, marketing describes paid plans as built for
   production without expressly forbidding free deployed use, and the terms may
   change on posting.

Ask EarningsAPI.com to confirm that the free tier may serve a deployed
non-commercial application and that normalized event caching for up to 72 hours
is permitted if final legal or operational certainty is required. Before
Production activation, create the account and record a bounded 25-symbol
coverage/contract check; success means every
symbol returns a schema-valid array or a valid empty unknown without exposing the
key or depending on the live service in automated tests.

Gate 5 completed on 2026-08-24. One approved validation-only run covered all 25
ordered catalog symbols with exactly 25 requests, 0 retries, no followed
redirects, and no transient or contract failures. Every symbol returned HTTP 200
and a contract-valid nonempty upcoming result. The provider dashboard reconciled
25/100 daily requests used and 75 remaining on the Free plan; PostgreSQL, Redis,
normal synchronization, Production configuration, and the disabled feature flag
were unchanged.

### Gate 6 completion record

**Gate 6: COMPLETE (2026-08-24).** The dated review covered the official
[Terms & Conditions](https://www.earningsapi.com/terms), effective 2025-06-11;
the official
[watchlist monitor](https://www.earningsapi.com/docs/examples/watchlist-monitor),
which instructs integrations to select the nearest future event and store it
with the symbol; the official
[database and daily-sync guide](https://www.earningsapi.com/docs/examples/calendar-backfill-sync),
which describes building an earnings-calendar database, storing responses, and
recurring forward refreshes; and the official
[company earnings endpoint](https://www.earningsapi.com/docs/earnings), which
documents Free access at 60 requests/minute, 100/day, and 1,000/month.

The terms expressly permit retrieving and displaying earnings content in the
operator's own application or website while prohibiting republication of the
proprietary feed. PortfolioScope does not republish the feed: raw responses are
validated and discarded, HTTP caching is disabled with `cache: "no-store"`, and
PostgreSQL retains only the normalized nearest future date, normalized market
session, source, and application timestamps. That record is fresh through 36
hours, displayable as stale through 72 hours, and suppressed and pruned after 72
hours. Redis retains only 48-hour sweep/attempt claims and coarse coordination
outcomes; it stores no provider earnings content.

No published maximum response-retention period, explicit attribution rule, or
operative prohibition on deployed Free-tier use within its limits was found.
Paid plans are marketed as built for Production; upstream provenance, accuracy,
completeness, and availability are not guaranteed; and terms may change on
posting. These remain accepted, non-blocking residual risks for this bounded
implementation. The affirmative application-display and storage/database
guidance is sufficient under the activation criteria, so written provider
clarification is not currently required. This completed Gate 6. Gate 7 was
subsequently completed as recorded below.

### Gate 7 completion record

**Gate 7: PASS.** On 2026-08-24, the controlled failure proof was deferred
because no safe execution path was then available within the tooling constraints;
that blocker is resolved. A normal Production sweep succeeded with
25/25 catalog coverage, 25 provider attempts, 0 retries, 0 failures, and outcome
`AVAILABLE`; PostgreSQL and normal-sweep Redis verification passed, and provider
daily and monthly usage each reconciled exactly from 25 to 50.

The controlled Redis-unavailable fail-closed proof also passed for `AAPL`:

- the database identity matched;
- the persisted observation remained unchanged;
- `providerFetchCount = 0`;
- Redis failure was simulated; and
- the source status was `COORDINATION_UNAVAILABLE`.

Production earnings synchronization is enabled and validated. The final
Production value is `EARNINGS_SYNC_ENABLED=true`.

If these conditions regress, disable live sync. The completed page will continue
to show valid persisted observations or explicit unavailable states without
making provider calls.
