import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TradingViewWidget,
  buildTradingViewSymbol,
} from "@/components/stocks/tradingview-widget";

describe("TradingView stock widget", () => {
  it("builds a controlled exchange symbol", () => {
    expect(buildTradingViewSymbol("nasdaq", "aapl")).toBe("NASDAQ:AAPL");
    expect(buildTradingViewSymbol("NASDAQ", "../../AAPL")).toBeNull();
  });

  it("keeps attribution and a useful loading fallback visible", () => {
    const markup = renderToStaticMarkup(
      <TradingViewWidget exchange="NASDAQ" ticker="AAPL" />,
    );

    expect(markup).toContain("Loading TradingView chart");
    expect(markup).toContain("AAPL chart by TradingView");
    expect(markup).toContain("provided by TradingView");
    expect(markup).toContain("nofollow");
  });
});
