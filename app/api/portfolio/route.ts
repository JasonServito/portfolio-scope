import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser } from "@/lib/auth/authorization";
import { getOwnedPortfolioAnalytics } from "@/lib/portfolio/analytics";
import { isPerformancePeriod } from "@/lib/portfolio/performance";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const { searchParams } = new URL(request.url);
    const portfolioId = searchParams.get("portfolioId");
    if (!portfolioId) {
      return NextResponse.json(
        { error: "portfolioId is required." },
        { status: 400 },
      );
    }

    const requestedPeriod = searchParams.get("period") ?? "1M";
    const period = isPerformancePeriod(requestedPeriod)
      ? requestedPeriod
      : "1M";
    const analytics = await getOwnedPortfolioAnalytics(
      user.id,
      portfolioId,
      period,
    );

    if (!analytics) {
      return NextResponse.json(
        { error: "Portfolio analytics are unavailable." },
        { status: 404 },
      );
    }

    return NextResponse.json(analytics);
  } catch (error) {
    return apiErrorResponse(error, "Portfolio analytics could not be loaded.");
  }
}
