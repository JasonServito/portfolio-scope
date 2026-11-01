# Market Price Decision

## M23 decision

PortfolioScope uses its existing PostgreSQL `StockPrice` observations for the
M23 watchlist slice. Those observations are deterministic, generated demo data;
they are not live exchange quotes. The UI therefore calls them **cached demo
prices**, always shows the stock currency and observation timestamp, and marks
old observations as stale.

This is the smallest source that is appropriate for the current educational,
non-commercial demo. It adds no provider, credential, schedule, dependency,
migration, exchange entitlement, or monthly cost. It also keeps the selected
source honest: supported stock-catalog rows without a valid stored observation
show a missing state instead of a fabricated price.

The decision does not approve a production quote feed. A later proposal to
replace demo observations with licensed market data remains a consequential
service and persistence decision requiring a separate review and approval.

## Feasibility evidence

| Option                      | Licensing and technical result                                                                                                                                                                                                                                                                                      | Reliability, limits, and cost                                                                                                                                            | M23 result                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Existing TradingView widget | TradingView documents that widget data cannot be exported and that it provides no data API. Its terms restrict market data to display use and prohibit machine-driven non-display processing.                                                                                                                       | The existing attributed widget remains suitable for human-readable public charts, but cannot power backend watchlist rows or alert evaluation.                           | Retain the widget boundary; do not inspect, scrape, persist, or reuse its values. |
| Existing `StockPrice` rows  | PortfolioScope owns the deterministic generator and stored observations. No third-party quote license is involved.                                                                                                                                                                                                  | Fully deterministic and offline, but limited to seeded tickers and not current market data.                                                                              | **Selected** as an explicitly cached demo source.                                 |
| Alpha Vantage               | Standard free access is limited to 25 requests per day, with a verification-based exception available for some educational and open-source projects; real-time and 15-minute delayed U.S. data require premium entitlement. Its standard license is personal and non-commercial unless otherwise agreed in writing. | One daily request per ticker could cover only the small seeded universe, but external application display and alert use are not clearly granted by the self-serve terms. | Not selected without written display rights and a separate service decision.      |
| Massive                     | The free stock plan provides end-of-day data at five calls per minute; the $29 plan adds 15-minute delayed data. Published market-data terms prohibit third-party display or redistribution without prior consent.                                                                                                  | The delayed plan reaches the project budget before database, hosting, and existing services, and self-serve individual terms do not fit this app's display.              | Not selected.                                                                     |
| Twelve Data                 | Free business access is for internal non-display use. External display begins with a business tier whose published pricing is materially above the project budget; caching is also license-limited.                                                                                                                 | Technically capable, but not cost-compatible with the sub-$30 total operating target.                                                                                    | Not selected.                                                                     |

Sources checked on 2026-08-20:

- [TradingView widget data FAQ](https://www.tradingview.com/widget-docs/faq/data/)
- [TradingView terms and market-data policy](https://www.tradingview.com/policies/)
- [Alpha Vantage support and limits](https://www.alphavantage.co/support/)
- [Alpha Vantage terms](https://www.alphavantage.co/terms_of_service/)
- [Massive stock plans](https://www.massive.com/stocks)
- [Massive market-data terms](https://massive.com/legal/market-data-terms-of-service)
- [Twelve Data business pricing](https://twelvedata.com/pricing-business)
- [Twelve Data terms](https://twelvedata.com/terms)

## Price semantics

- `CACHED`: the newest valid positive stored close is no more than 72 hours old.
  The window accommodates weekends and ordinary market closures without
  claiming that the observation is real time.
- `STALE`: a valid stored close exists but is more than 72 hours old.
- `MISSING`: no stored close exists, or the observation is invalid or
  implausibly future-dated.

Every displayed value includes its ISO currency and observation date. Stale or
missing observations never participate in target-crossing evaluation. For that
evaluation, the current observation must be no more than 72 hours old relative
to the reconciliation time, and the previous observation must be no more than
72 hours before the current observation. This two-clock rule rejects both a
stale latest value and an implausibly old history gap. A database read failure
uses the existing route/page error boundary; it does not fall back to zero or
to a TradingView value.

## Target-crossing semantics

For a configured positive target, M23 compares the two newest daily stored
closes:

- upward crossing: previous close is below the target and current close is at
  or above it;
- downward crossing: previous close is above the target and current close is at
  or below it.

Arrival exactly at the target counts once. Starting at the target, moving on
the same side, missing history, stale data, invalid data, and source-read
failure do not create a crossing.

The alert identifier is derived from the owned watchlist item, current price
observation, target, and direction. Reconciliation uses an upsert, so retries
and concurrent delivery converge on one alert and do not reopen an alert the
owner resolved. The calculation also retains the target-relative distance of
the current observation, allowing a later approved materially-beyond-target
rule to choose its threshold without changing crossing semantics now.

Private alert reads perform best-effort reconciliation before returning the
owner-scoped alert list. If reconciliation itself fails, existing alerts remain
available and a later read retries. The authenticated dashboard skips this
write-oriented reconciliation to preserve the M22 navigation request path.
Read-only demo owners are excluded from reconciliation so a demo GET never
persists an alert.
