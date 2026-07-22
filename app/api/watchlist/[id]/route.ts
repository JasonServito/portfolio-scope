import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import {
  deleteWatchlistItem,
  updateWatchlistItem,
} from "@/lib/portfolio/management";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const { id } = await params;
    const item = await updateWatchlistItem(user.id, id, await request.json());
    return NextResponse.json({ id: item.id });
  } catch (error) {
    return apiErrorResponse(error, "The watchlist item could not be updated.");
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const { id } = await params;
    await deleteWatchlistItem(user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error, "The watchlist item could not be deleted.");
  }
}
