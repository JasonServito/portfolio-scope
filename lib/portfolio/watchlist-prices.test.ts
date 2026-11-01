import { describe, expect, it } from "vitest";

import {
  evaluateTargetCrossing,
  presentWatchlistPrice,
} from "@/lib/portfolio/watchlist-prices";

const now = new Date("2026-08-20T18:00:00.000Z");

function observation(close: number, timestamp = "2026-08-19T20:00:00.000Z") {
  return { close, id: `price-${timestamp}`, timestamp: new Date(timestamp) };
}

describe("watchlist price presentation", () => {
  it("presents a recent stored observation as a currency-labelled cached price", () => {
    expect(presentWatchlistPrice([observation(203.12)], "USD", now)).toEqual({
      amount: 203.12,
      currency: "USD",
      observedAt: "2026-08-19T20:00:00.000Z",
      source: "PortfolioScope demo fixture",
      state: "CACHED",
    });
  });

  it("labels old observations stale without replacing their value", () => {
    expect(
      presentWatchlistPrice(
        [observation(203.12, "2026-08-15T20:00:00.000Z")],
        "USD",
        now,
      ),
    ).toMatchObject({ amount: 203.12, state: "STALE" });
  });

  it.each([
    { label: "missing", observations: [] },
    { label: "non-positive", observations: [observation(0)] },
    {
      label: "future-dated",
      observations: [observation(203.12, "2026-08-21T20:00:00.000Z")],
    },
  ])("keeps a $label observation missing", ({ observations }) => {
    expect(presentWatchlistPrice(observations, "CAD", now)).toEqual({
      amount: null,
      currency: "CAD",
      observedAt: null,
      source: "PortfolioScope demo fixture",
      state: "MISSING",
    });
  });
});

describe("target crossing", () => {
  it("detects upward and downward arrival at a configured target", () => {
    expect(
      evaluateTargetCrossing({
        currentPrice: 100,
        previousPrice: 99,
        targetPrice: 100,
      }),
    ).toEqual({ direction: "UP", relativeDistanceBeyondTarget: 0 });
    expect(
      evaluateTargetCrossing({
        currentPrice: 95,
        previousPrice: 105,
        targetPrice: 100,
      }),
    ).toEqual({ direction: "DOWN", relativeDistanceBeyondTarget: 0.05 });
  });

  it.each([
    { currentPrice: 101, previousPrice: 100, targetPrice: 100 },
    { currentPrice: 102, previousPrice: 101, targetPrice: 100 },
    { currentPrice: 98, previousPrice: 99, targetPrice: 100 },
    { currentPrice: 100, previousPrice: 99, targetPrice: 0 },
  ])("does not invent a crossing for %#", (input) => {
    expect(evaluateTargetCrossing(input)).toBeNull();
  });
});
