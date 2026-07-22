import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiAdmin } from "@/lib/auth/authorization";
import { getBackgroundJobForAdmin } from "@/lib/jobs/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const job = await getBackgroundJobForAdmin((await params).id);
    if (!job) {
      return Response.json({ error: "Background job was not found." }, { status: 404 });
    }
    return Response.json(job);
  } catch (error) {
    return apiErrorResponse(error, "Background job details could not be loaded.");
  }
}
