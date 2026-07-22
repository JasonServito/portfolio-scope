import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import {
  deletePortfolio,
  getPortfolio,
  updatePortfolio,
} from "@/lib/portfolio/management";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const portfolio = await getPortfolio(user.id, id);
    if (!portfolio) {
      return NextResponse.json(
        { error: "Portfolio was not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(portfolio);
  } catch (error) {
    return apiErrorResponse(error, "The portfolio could not be loaded.");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const { id } = await params;
    const portfolio = await updatePortfolio(user.id, id, await request.json());
    return NextResponse.json({ id: portfolio.id });
  } catch (error) {
    return apiErrorResponse(error, "The portfolio could not be updated.");
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const { id } = await params;
    await deletePortfolio(user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error, "The portfolio could not be deleted.");
  }
}
