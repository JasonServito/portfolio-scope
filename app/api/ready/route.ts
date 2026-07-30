import { db } from "@/lib/db";
import { logger } from "@/lib/observability/logger";
import { observeApiRequest } from "@/lib/observability/request";

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

export async function GET(request: Request) {
  return observeApiRequest(request, "/api/ready", async (context) =>
    readinessCheck(context),
  );
}

async function readinessCheck(context: {
  requestId: string;
  correlationId: string;
  route: string;
  method: string;
}) {
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
  } catch (error) {
    logger.error(
      "readiness.database.unavailable",
      {
        ...context,
        errorCode: "DATABASE_UNAVAILABLE",
      },
      error,
    );

    return readinessResponse("not_ready", 503, {
      configuration: "ok",
      database: "failed",
    });
  }
}
