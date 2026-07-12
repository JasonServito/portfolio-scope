import { NextResponse } from "next/server";

import { getDemoPortfolioAnalytics } from "@/lib/portfolio/analytics";
import { isPerformancePeriod } from "@/lib/portfolio/performance";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPeriod = searchParams.get("period") ?? "1M";
  const period = isPerformancePeriod(requestedPeriod) ? requestedPeriod : "1M";
  const analytics = await getDemoPortfolioAnalytics(period);

  if (!analytics) {
    return NextResponse.json(
      { error: "Demo holdings analytics are unavailable." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    portfolio: analytics.portfolio,
    period: analytics.period,
    asOf: analytics.asOf,
    holdings: analytics.holdings,
  });
}
