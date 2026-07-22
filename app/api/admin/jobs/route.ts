import { BackgroundJobStatus } from "@prisma/client";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiAdmin } from "@/lib/auth/authorization";
import { listBackgroundJobsForAdmin } from "@/lib/jobs/service";

const querySchema = z.object({
  status: z.enum(BackgroundJobStatus).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    await requireApiAdmin();
    const url = new URL(request.url);
    const input = querySchema.parse({
      status: url.searchParams.get("status") || undefined,
      take: url.searchParams.get("take") || undefined,
    });
    return Response.json({ jobs: await listBackgroundJobsForAdmin(input) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Job filters are invalid." }, { status: 400 });
    }
    return apiErrorResponse(error, "Background jobs could not be loaded.");
  }
}
