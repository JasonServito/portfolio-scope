import { apiErrorResponse } from "@/lib/api/errors";
import { JobRequestError } from "@/lib/jobs/errors";
import { verifyQstashRequest } from "@/lib/jobs/qstash";
import { executeBackgroundJob } from "@/lib/jobs/service";
import { calculateRetryDelaySeconds } from "@/lib/jobs/types";
import { enforceRateLimit, getRequestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobId } = await verifyQstashRequest(request);
    await enforceRateLimit({
      category: "workerCallback",
      identifier: `ip:${getRequestIp(request)}`,
    });
    const result = await executeBackgroundJob(jobId);
    if (result.retrying) {
      return Response.json(
        { jobId: result.jobId, status: result.status },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(
              result.retryAfterSeconds ?? calculateRetryDelaySeconds(1),
            ),
          },
        },
      );
    }

    return Response.json(
      {
        jobId: result.jobId,
        status: result.status,
        duplicate: result.duplicate,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof JobRequestError) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    const response = apiErrorResponse(
      error,
      "The background worker could not process the request.",
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
