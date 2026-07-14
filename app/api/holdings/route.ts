import { NextResponse } from "next/server";

import { demoReadOnlyMessage, isPublicDemoReadOnly } from "@/lib/demo";
import { getDemoPortfolioAnalytics } from "@/lib/portfolio/analytics";
import { isPerformancePeriod } from "@/lib/portfolio/performance";
import { createHolding, ManagementError } from "@/lib/portfolio/management";

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

export async function POST(request: Request) {
  if (isPublicDemoReadOnly()) {
    return NextResponse.json(
      { error: demoReadOnlyMessage },
      { status: 403 },
    );
  }

  try {
    const holding = await createHolding(await request.json());
    return NextResponse.json({ id: holding.id }, { status: 201 });
  } catch (error) {
    const known = error instanceof ManagementError;
    const malformed = error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : malformed
            ? "Request body must be valid JSON."
            : "The holding could not be created.",
      },
      { status: known ? error.status : malformed ? 400 : 500 },
    );
  }
}
