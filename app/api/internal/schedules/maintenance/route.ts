import { randomUUID } from "node:crypto";

import { BackgroundJobType } from "@prisma/client";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import { JobRequestError } from "@/lib/jobs/errors";
import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { enqueueBackgroundJob } from "@/lib/jobs/service";
import { enforceRateLimit, getRequestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const scheduleSchema = z
  .object({
    operation: z.enum(["RECOVER_STALE_JOBS", "REFRESH_STALE_SEC"]),
  })
  .strict();

function scheduleBucket(operation: z.infer<typeof scheduleSchema>["operation"]) {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  if (operation === "REFRESH_STALE_SEC") {
    date.setUTCHours(Math.floor(date.getUTCHours() / 12) * 12);
  }
  return date.toISOString();
}

export async function POST(request: Request) {
  try {
    const rawBody = await verifyQstashSignature(request);
    await enforceRateLimit({
      category: "workerCallback",
      identifier: `ip:${getRequestIp(request)}`,
    });
    const input = scheduleSchema.parse(JSON.parse(rawBody));
    const result = await enqueueBackgroundJob({
      type: BackgroundJobType.MAINTENANCE_CLEANUP,
      idempotencyKey: `maintenance:${input.operation}:${scheduleBucket(input.operation)}`,
      correlationId: randomUUID(),
      payload: input,
    });
    return Response.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    if (error instanceof JobRequestError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Schedule payload is invalid." }, { status: 400 });
    }
    return apiErrorResponse(
      error,
      "Scheduled maintenance could not be queued.",
    );
  }
}
