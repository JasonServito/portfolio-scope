import { describe, expect, it } from "vitest";

import {
  holdingInputSchema,
  watchlistInputSchema,
  watchlistUpdateSchema,
} from "@/lib/portfolio/management";

describe("portfolio management validation", () => {
  it("normalizes a valid holding and coerces numeric form values", () => {
    expect(
      holdingInputSchema.parse({
        portfolioId: "portfolio-1",
        ticker: " aapl ",
        shares: "2.5",
        averageCost: "185.25",
      }),
    ).toEqual({
      portfolioId: "portfolio-1",
      ticker: "AAPL",
      shares: 2.5,
      averageCost: 185.25,
    });
  });

  it.each([
    [
      {
        portfolioId: "portfolio-1",
        ticker: "AAPL<script>",
        shares: 1,
        averageCost: 10,
      },
      "Enter a valid ticker.",
    ],
    [
      {
        portfolioId: "portfolio-1",
        ticker: "AAPL",
        shares: 0,
        averageCost: 10,
      },
      "Shares must be greater than zero.",
    ],
    [
      {
        portfolioId: "portfolio-1",
        ticker: "AAPL",
        shares: 1,
        averageCost: -1,
      },
      "Average cost must be greater than zero.",
    ],
  ])("rejects invalid holding input", (input, message) => {
    const result = holdingInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message);
  });

  it("accepts optional watchlist details and rejects invalid target prices", () => {
    expect(
      watchlistInputSchema.parse({
        ticker: "msft",
        targetPrice: "",
        notes: "  Cloud growth  ",
      }),
    ).toEqual({
      ticker: "MSFT",
      targetPrice: "",
      notes: "Cloud growth",
    });
    expect(
      watchlistInputSchema.safeParse({ ticker: "MSFT", targetPrice: 0 })
        .success,
    ).toBe(false);
  });

  it("accepts partial watchlist updates but rejects empty or forged ownership fields", () => {
    expect(
      watchlistUpdateSchema.parse({ notes: "  Updated thesis  " }),
    ).toEqual({ notes: "Updated thesis" });
    expect(watchlistUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      watchlistUpdateSchema.safeParse({ notes: "Forged", userId: "user-b" })
        .success,
    ).toBe(false);
  });
});
