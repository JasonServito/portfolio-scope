import { randomUUID } from "node:crypto";

import { logger, type LogContext } from "@/lib/observability/logger";
import { reportOperationalError } from "@/lib/observability/sentry";

const safeIdentifier = /^[A-Za-z0-9._:-]{8,128}$/;

function identifier(value: string | null) {
  return value && safeIdentifier.test(value) ? value : randomUUID();
}

export type RequestLogContext = LogContext & {
  requestId: string;
  correlationId: string;
  route: string;
  method: string;
};

export function getRequestLogContext(request: Request, route: string) {
  return {
    requestId: identifier(request.headers.get("x-request-id")),
    correlationId: identifier(request.headers.get("x-correlation-id")),
    route,
    method: request.method,
  } satisfies RequestLogContext;
}

export async function observeApiRequest(
  request: Request,
  route: string,
  operation: (context: RequestLogContext) => Promise<Response>,
) {
  const context = getRequestLogContext(request, route);
  const startedAt = performance.now();

  try {
    const response = await operation(context);
    const completedContext = {
      ...context,
      statusCode: response.status,
      durationMs: performance.now() - startedAt,
    };
    if (response.status >= 500) {
      logger.error("api.request.failed", completedContext);
    } else if (response.status >= 400) {
      logger.warn("api.request.rejected", completedContext);
    } else {
      logger.info("api.request.completed", completedContext);
    }
    response.headers.set("x-request-id", context.requestId);
    response.headers.set("x-correlation-id", context.correlationId);
    return response;
  } catch (error) {
    const failedContext = {
      ...context,
      durationMs: performance.now() - startedAt,
      errorCode: "UNHANDLED_REQUEST_ERROR",
    };
    logger.error("api.request.unhandled_error", failedContext, error);
    reportOperationalError(error, failedContext);
    throw error;
  }
}
