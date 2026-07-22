import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiAdmin } from "@/lib/auth/authorization";
import { cancelBackgroundJob } from "@/lib/jobs/service";
import { enforceRateLimit, getRequestIp } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireApiAdmin();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json(
        { error: "Cross-site requests are not allowed." },
        { status: 403 },
      );
    }
    await Promise.all([
      enforceRateLimit({
        category: "adminIngestion",
        identifier: `user:${admin.id}`,
      }),
      enforceRateLimit({
        category: "adminIngestion",
        identifier: `ip:${getRequestIp(request)}`,
      }),
    ]);
    const result = await cancelBackgroundJob((await params).id, admin.id);
    return Response.json(result);
  } catch (error) {
    return apiErrorResponse(error, "The background job could not be cancelled.");
  }
}
