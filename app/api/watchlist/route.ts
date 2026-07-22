import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import {
  createWatchlistItem,
  getUserWatchlist,
} from "@/lib/portfolio/management";

export async function GET() {
  try {
    const user = await requireApiUser();
    const items = await getUserWatchlist(user.id);
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error, "The watchlist could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const item = await createWatchlistItem(user.id, await request.json());
    return NextResponse.json({ id: item.id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "The watchlist item could not be created.");
  }
}
