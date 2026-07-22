import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser } from "@/lib/auth/authorization";
import { getOwnedResearchJob } from "@/lib/research/orchestrator";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const research = await getOwnedResearchJob(user.id, id);
    if (!research) {
      return NextResponse.json(
        { error: "Research job was not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(research);
  } catch (error) {
    return apiErrorResponse(error, "Research could not be loaded.");
  }
}
