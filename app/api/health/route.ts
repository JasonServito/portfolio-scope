import { observeApiRequest } from "@/lib/observability/request";

const headers = {
  "Cache-Control": "no-store, max-age=0",
};

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return observeApiRequest(request, "/api/health", async () =>
    Response.json(
      {
        status: "ok",
        service: "portfolioscope",
        timestamp: new Date().toISOString(),
      },
      { headers },
    ),
  );
}
