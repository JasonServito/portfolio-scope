import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.stubGlobal("React", React);

import { PrivateAlerts } from "@/components/alerts/private-alerts";
import { PrivatePortfolioManager } from "@/components/portfolios/private-portfolio-manager";
import { AuthenticatedPageLoading } from "@/components/ui/authenticated-page-loading";
import { WatchlistManager } from "@/components/watchlist/watchlist-manager";

describe("authenticated management states", () => {
  it("renders usable watchlist create, edit, and remove controls", () => {
    const markup = renderToStaticMarkup(
      <WatchlistManager
        items={[
          {
            id: "watch-a",
            ticker: "AAPL",
            companyName: "Apple Inc.",
            sector: "Technology",
            price: {
              amount: 203.12,
              currency: "USD",
              observedAt: "2026-08-19T20:00:00.000Z",
              source: "PortfolioScope demo fixture",
              state: "CACHED",
            },
            targetPrice: 210,
            notes: "Review earnings.",
          },
        ]}
      />,
    );

    expect(markup).toContain("Add to watchlist");
    expect(markup).toContain("Target price");
    expect(markup).toContain("$203.12 USD");
    expect(markup).toContain("Cached demo price");
    expect(markup).toContain("Review earnings.");
    expect(markup).toContain("Edit AAPL");
    expect(markup).toContain("Remove AAPL");
  });

  it("renders portfolio creation controls and a clear holdings empty state", () => {
    const markup = renderToStaticMarkup(
      <PrivatePortfolioManager
        holdings={[]}
        id="portfolio-a"
        initialBaseCurrency="USD"
        initialName="Long term"
      />,
    );

    expect(markup).toContain("Portfolio settings");
    expect(markup).toContain("Add a holding");
    expect(markup).toContain("This portfolio has no holdings yet.");
  });

  it("renders a clear alert empty state", () => {
    const markup = renderToStaticMarkup(<PrivateAlerts alerts={[]} />);

    expect(markup).toContain(
      "No private alerts have been created for your account.",
    );
  });

  it("announces authenticated route loading without exposing private data", () => {
    const markup = renderToStaticMarkup(<AuthenticatedPageLoading />);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading account view.");
  });
});
