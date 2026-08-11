import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WinnersLosers } from "@/components/dashboard/winners-losers";
import type { WinnerLoser } from "@/lib/portfolio/types";

vi.stubGlobal("React", React);

function rankedHolding(
  ticker: string,
  periodReturn: number,
): WinnerLoser {
  return {
    id: ticker,
    ticker,
    companyName: `${ticker} Inc.`,
    marketValue: 1_000,
    periodReturn,
    dollarContribution: periodReturn * 1_000,
    portfolioContributionPercent: periodReturn,
  };
}

describe("WinnersLosers", () => {
  it("styles each ranked holding from its actual return sign", () => {
    const markup = renderToStaticMarkup(
      <WinnersLosers
        currency="USD"
        items={[rankedHolding("GAIN", 0.0093), rankedHolding("LOSS", -0.0075)]}
        title="Lowest performers"
      />,
    );

    expect(markup).toContain("+0.93%");
    expect(markup).toContain("-0.75%");
    expect(markup).toContain("bg-emerald-50");
    expect(markup).toContain("bg-rose-50");
  });
});
