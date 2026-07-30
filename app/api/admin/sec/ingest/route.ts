import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiAdmin, requireMutableUser } from "@/lib/auth/authorization";
import { isLocalManualSecIngestionEnabled } from "@/lib/jobs/config";
import { observeApiRequest } from "@/lib/observability/request";
import { enforceRateLimit, getRequestIp } from "@/lib/rate-limit";
import {
  SecIngestionError,
  SecIngestionErrorCode,
  ingestSupportedCompany,
} from "@/lib/sec/ingestion";
import { queueSecIngestion } from "@/lib/sec/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z
  .object({
    ticker: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{1,5}$/),
  })
  .strict();

function isCrossSiteRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return true;

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const protocol =
    forwardedProtocol || new URL(request.url).protocol.slice(0, -1);

  try {
    return origin !== new URL(`${protocol}://${host}`).origin;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  return observeApiRequest(
    request,
    "/api/admin/sec/ingest",
    async (context) =>
      handleIngestionRequest(request, context.correlationId),
  );
}

async function handleIngestionRequest(
  request: Request,
  correlationId: string,
) {
  try {
    const admin = await requireApiAdmin();
    await requireMutableUser(admin.id);
    if (isCrossSiteRequest(request)) {
      return Response.json(
        { error: "Cross-site requests are not allowed." },
        { status: 403 },
      );
    }
    const localManualIngestion = isLocalManualSecIngestionEnabled();
    if (!localManualIngestion) {
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
    }
    const input = requestSchema.parse(await request.json());
    if (localManualIngestion) {
      const result = await ingestSupportedCompany(input.ticker, {
        trigger: "LOCAL",
        requestedByUserId: admin.id,
        correlationId,
      });
      return Response.json(result, { status: 200 });
    }

    const result = await queueSecIngestion(input.ticker, {
      requestedByUserId: admin.id,
      correlationId,
    });

    return Response.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "Ticker must be one to five letters.",
          code: SecIngestionErrorCode.INVALID_TICKER,
        },
        { status: 400 },
      );
    }
    if (error instanceof SecIngestionError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    return apiErrorResponse(error, "SEC ingestion could not be started.");
  }
}
