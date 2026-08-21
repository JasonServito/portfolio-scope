# Financial Trends

PortfolioScope limits stock-detail financial charts to quarterly revenue,
diluted earnings per share, and free cash flow. The presentation uses at most
the eight most recent selected quarterly observations from the persisted
`sec-xbrl-v1` facts; it does not request SEC data while rendering a page.

Revenue and diluted EPS are reported facts. Free cash flow is derived as
operating cash flow minus capital expenditures only when both selected facts
use USD and have identical quarter boundaries. Periods are ordered by their
UTC reporting end date. Missing, ambiguous, incompatible-unit, and unmatched
facts remain unavailable: they are not converted to zero, extrapolated, or
connected across chart gaps.

Each chart includes its unit, reporting periods, a plain-language trend
summary, explicit missing or partial state, and a keyboard-accessible table of
the same values as a text alternative.

## Revenue-mix feasibility

Revenue mix is deferred. The current Company Facts normalization maps
consolidated revenue concepts but does not retain the XBRL dimensions and
members needed to distinguish reliable product or operating-segment revenue.
Adding those semantics would require a major segment-reporting ingestion
subsystem, which is outside M25. No provider, schema, or external service was
added for chart completeness.
