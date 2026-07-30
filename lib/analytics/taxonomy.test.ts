import { describe, expect, it } from "vitest";

import { validateAnalyticsEvent } from "@/lib/analytics/taxonomy";

describe("privacy-safe analytics taxonomy", () => {
  it("accepts allowlisted public event properties", () => {
    expect(
      validateAnalyticsEvent("stock_page_viewed", { ticker: "AAPL" }).success,
    ).toBe(true);
  });

  it("rejects private financial fields and malformed tickers", () => {
    expect(
      validateAnalyticsEvent("portfolio_created", {
        portfolioValue: 100_000,
      } as never).success,
    ).toBe(false);
    expect(
      validateAnalyticsEvent("stock_page_viewed", {
        ticker: "AAPL<script>",
      }).success,
    ).toBe(false);
  });
});
