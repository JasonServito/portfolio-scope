# PortfolioScope demo guide

## Try It Online

Open [portfolio-scope.vercel.app](https://portfolio-scope.vercel.app).

- Select **Explore the read-only demo** to try the core product without an
  account.
- Sign in with GitHub or Google to manage private portfolios and watchlists.
- Demo market and portfolio values are seeded or cached examples, not live
  quotes.

PortfolioScope is an educational analytics project. It does not place trades or
provide financial advice.

## Two-Minute Tour

1. Start on the dashboard and review portfolio value, return, allocation, and
   active alerts.
2. Change the performance period and open **Holdings** to compare positions.
3. Open AAPL to review market context, portfolio exposure, SEC-backed
   financials, and trends.
4. Open **Sample research** to review the summary, strengths, risks, missing
   information, and sources.
5. Visit **Watchlist**, **Earnings**, and **Alerts** to see the remaining core
   workflows.

The public demo is read-only. Account changes and private research require
sign-in.

## Run Locally

Follow the [README setup instructions](README.md#local-development), seed the
database, and open [http://localhost:3000](http://localhost:3000).

If the demo redirect is slow, open
[http://localhost:3000/dashboard?demo=true](http://localhost:3000/dashboard?demo=true)
directly.

## Refresh Demo Assets

With the seeded app running locally on port 3100:

```powershell
$env:E2E_BASE_URL = "http://127.0.0.1:3100"
npm run demo:capture
```

Capture only real application states. Keep secrets, private account data,
browser notifications, and local paths out of screenshots and recordings.
