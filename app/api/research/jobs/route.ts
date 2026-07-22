import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser } from "@/lib/auth/authorization";
import { listResearchJobs } from "@/lib/research/orchestrator";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ jobs: await listResearchJobs(user.id) });
  } catch (error) {
    return apiErrorResponse(error, "Research history could not be loaded.");
  }
}
