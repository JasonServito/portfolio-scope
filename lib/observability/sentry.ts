import * as Sentry from "@sentry/nextjs";

import {
  privacySafeUserId,
  type LogContext,
} from "@/lib/observability/logger";

export function reportOperationalError(error: unknown, context: LogContext) {
  Sentry.withScope((scope) => {
    const tags = {
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.correlationId
        ? { correlationId: context.correlationId }
        : {}),
      ...(context.route ? { route: context.route } : {}),
      ...(context.jobId ? { jobId: context.jobId } : {}),
      ...(context.ticker ? { ticker: context.ticker } : {}),
      ...(context.provider ? { provider: context.provider } : {}),
      ...(context.errorCode ? { errorCode: context.errorCode } : {}),
    };
    scope.setTags(tags);
    if (context.userId) {
      scope.setUser({ id: privacySafeUserId(context.userId) });
    }
    Sentry.captureException(error);
  });
}
