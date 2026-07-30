import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiAdmin } from "@/lib/auth/authorization";
import { observeApiRequest } from "@/lib/observability/request";
import { getOperationalDiagnostics } from "@/lib/operations/diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return observeApiRequest(request, "/api/admin/diagnostics", async () => {
    try {
      await requireApiAdmin();
      return Response.json(await getOperationalDiagnostics(), {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    } catch (error) {
      return apiErrorResponse(
        error,
        "Operational diagnostics could not be loaded.",
      );
    }
  });
}
