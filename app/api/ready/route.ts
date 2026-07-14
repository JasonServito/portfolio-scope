import { db } from "@/lib/db";

const headers = {
  "Cache-Control": "no-store, max-age=0",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "failed" | "skipped";

function readinessResponse(
  status: "ready" | "not_ready",
  httpStatus: 200 | 503,
  checks: {
    configuration: CheckStatus;
    database: CheckStatus;
  },
) {
  const payload = {
    status,
    service: "portfolioscope",
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "production" ? {} : { checks }),
  };

  return Response.json(payload, { status: httpStatus, headers });
}

export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) {
    return readinessResponse("not_ready", 503, {
      configuration: "failed",
      database: "skipped",
    });
  }

  try {
    await db.$queryRaw`SELECT 1`;

    return readinessResponse("ready", 200, {
      configuration: "ok",
      database: "ok",
    });
  } catch {
    console.error("Readiness database dependency is unavailable.");

    return readinessResponse("not_ready", 503, {
      configuration: "ok",
      database: "failed",
    });
  }
}
