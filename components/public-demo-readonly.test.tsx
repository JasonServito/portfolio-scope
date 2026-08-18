import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AddHoldingForm,
  HoldingRowActions,
} from "@/components/holdings/holding-actions";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { ResearchTabs } from "@/components/research/research-tabs";
import { WatchlistManager } from "@/components/watchlist/watchlist-manager";
import type { HoldingsPageRow } from "@/lib/portfolio/dashboard-data";
import type { StockResearch } from "@/lib/research/types";

vi.stubGlobal("React", React);

const holding: HoldingsPageRow = {
  id: "holding-1",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  sector: "Technology",
  shares: 10,
  averageCost: 150,
  costBasis: 1_500,
  currentPrice: 200,
  marketValue: 2_000,
  allocationPercent: 1,
  periodStartValue: 1_900,
  periodEndValue: 2_000,
  periodReturn: 0.0526,
  dollarContribution: 100,
  portfolioContributionPercent: 0.0526,
  totalGainLoss: 500,
  totalGainLossPercent: 0.3333,
  periodReturns: {
    "1D": 0.01,
    "1W": 0.02,
    "1M": 0.03,
    "3M": 0.04,
    "1Y": 0.05,
  },
};

const research: StockResearch = {
  jobId: "research-1",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  status: "COMPLETED",
  generatedAt: "2026-06-30T21:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
  agents: [],
  report: {
    overview: "Deterministic overview.",
    bullCase: [],
    bearCase: [],
    risks: [],
    missingData: [],
    confidence: 0.7,
  },
};

describe("public demo read-only components", () => {
  it("keeps holding data and stock navigation without management controls", () => {
    const markup = renderToStaticMarkup(
      <HoldingsTable currency="USD" holdings={[holding]} readOnly />,
    );

    expect(markup).toContain("Read-only public demo portfolio holdings.");
    expect(markup).toContain('href="/stocks/aapl"');
    expect(markup).not.toContain("Manage");
    expect(markup).not.toContain("Edit AAPL");
    expect(markup).not.toContain("Delete AAPL");
  });

  it("does not mount holding mutation controls in read-only mode", () => {
    expect(renderToStaticMarkup(<AddHoldingForm readOnly />)).toBe("");
    expect(
      renderToStaticMarkup(
        <HoldingRowActions
          averageCost={holding.averageCost}
          id={holding.id}
          readOnly
          shares={holding.shares}
          ticker={holding.ticker}
        />,
      ),
    ).toBe("");
  });

  it("keeps watchlist cards and stock links without add or remove controls", () => {
    const markup = renderToStaticMarkup(
      <WatchlistManager
        items={[
          {
            id: "watchlist-1",
            ticker: "AAPL",
            companyName: "Apple Inc.",
            sector: "Technology",
            targetPrice: 210,
            notes: "Review the next filing.",
          },
        ]}
        readOnly
      />,
    );

    expect(markup).toContain("Read-only demo");
    expect(markup).toContain('href="/stocks/aapl"');
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Remove AAPL");
  });

  it("shows existing research without run or refresh actions", () => {
    const markup = renderToStaticMarkup(
      <ResearchTabs initialResearch={research} readOnly ticker="AAPL" />,
    );

    expect(markup).toContain("Read-only sample");
    expect(markup).toContain("Deterministic");
    expect(markup).toContain("Deterministic overview.");
    expect(markup).toContain("Prepared");
    expect(markup).not.toContain("Provider and model");
    expect(markup).not.toContain("AI-generated");
    expect(markup).not.toContain("Run research");
    expect(markup).not.toContain("Refresh research");
  });

  it("does not offer research generation when a demo report is missing", () => {
    const markup = renderToStaticMarkup(
      <ResearchTabs initialResearch={null} readOnly ticker="AAPL" />,
    );

    expect(markup).toContain("cannot start a research job");
    expect(markup).not.toContain("Run research");
  });
});
