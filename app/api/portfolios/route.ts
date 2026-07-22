import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import {
  createPortfolio,
  listPortfolios,
} from "@/lib/portfolio/management";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ portfolios: await listPortfolios(user.id) });
  } catch (error) {
    return apiErrorResponse(error, "Portfolios could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const portfolio = await createPortfolio(user.id, await request.json());
    return NextResponse.json({ id: portfolio.id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "The portfolio could not be created.");
  }
}
