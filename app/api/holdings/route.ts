import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import {
  createHolding,
  listHoldings,
} from "@/lib/portfolio/management";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const portfolioId = new URL(request.url).searchParams.get("portfolioId");
    if (!portfolioId) {
      return NextResponse.json(
        { error: "portfolioId is required." },
        { status: 400 },
      );
    }

    const portfolio = await listHoldings(user.id, portfolioId);
    if (!portfolio) {
      return NextResponse.json(
        { error: "Portfolio was not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(portfolio);
  } catch (error) {
    return apiErrorResponse(error, "Holdings could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const holding = await createHolding(user.id, await request.json());
    return NextResponse.json({ id: holding.id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "The holding could not be created.");
  }
}
