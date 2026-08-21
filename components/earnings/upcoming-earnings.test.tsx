import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UpcomingEarnings } from "@/components/earnings/upcoming-earnings";
import type { UpcomingEarningsPageData } from "@/lib/earnings/service";

describe("UpcomingEarnings", () => {
  it("labels every persisted and coverage state without hiding provenance", () => {
    const data: UpcomingEarningsPageData = {
      sourceStatus: "COORDINATION_UNAVAILABLE",
      items: [
        {
          companyName: "Apple Inc.",
          eventDate: "2026-10-29",
          fetchedAt: "2026-08-21T12:00:00.000Z",
          followedVia: ["HOLDING", "WATCHLIST"],
          marketSession: "AFTER_MARKET",
          source: "EarningsAPI.com /v1/earnings",
          state: "KNOWN",
          ticker: "AAPL",
        },
        {
          companyName: "Microsoft Corporation",
          eventDate: "2026-10-28",
          fetchedAt: "2026-08-19T12:00:00.000Z",
          followedVia: ["WATCHLIST"],
          marketSession: null,
          source: "EarningsAPI.com /v1/earnings",
          state: "STALE",
          ticker: "MSFT",
        },
        {
          companyName: "NVIDIA Corporation",
          eventDate: null,
          fetchedAt: "2026-08-21T12:00:00.000Z",
          followedVia: ["HOLDING"],
          marketSession: null,
          source: "EarningsAPI.com /v1/earnings",
          state: "UNKNOWN",
          ticker: "NVDA",
        },
        {
          companyName: "Amazon.com, Inc.",
          eventDate: null,
          fetchedAt: null,
          followedVia: ["HOLDING"],
          marketSession: null,
          source: null,
          state: "UNAVAILABLE",
          ticker: "AMZN",
        },
        {
          companyName: "Shopify Inc.",
          eventDate: null,
          fetchedAt: null,
          followedVia: ["HOLDING"],
          marketSession: null,
          source: null,
          state: "UNSUPPORTED",
          ticker: "SHOP",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <UpcomingEarnings data={data} readOnly />,
    );

    expect(markup).toContain("No provider request was made");
    expect(markup).toContain("October 29, 2026");
    expect(markup).toContain("After market close");
    expect(markup).toContain("Stale");
    expect(markup).toContain("Date not currently available");
    expect(markup).toContain("Earnings data unavailable");
    expect(markup).toContain("Outside the M26 earnings catalog");
    expect(markup).toContain("EarningsAPI.com /v1/earnings");
    expect(markup.match(/Holding/g)).toHaveLength(4);
    expect(markup).toContain("Watchlist");
  });

  it("renders an empty followed-company state", () => {
    const markup = renderToStaticMarkup(
      <UpcomingEarnings data={{ items: [], sourceStatus: "DISABLED" }} />,
    );

    expect(markup).toContain("No followed companies yet");
    expect(markup).toContain("Live earnings updates are not activated");
  });
});
