import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforcePortfolioMutationLimits } from "@/lib/rate-limit";
import { updateAlertStatus } from "@/lib/portfolio/alerts-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    await requireMutableUser(user.id);
    await enforcePortfolioMutationLimits(request, user.id);
    const { id } = await params;
    const alert = await updateAlertStatus(user.id, id, await request.json());
    return NextResponse.json({ id: alert.id, status: alert.status });
  } catch (error) {
    return apiErrorResponse(error, "The alert could not be updated.");
  }
}
