import * as Sentry from "@sentry/nextjs";

import {
  getSentryRelease,
  getSentryTracesSampleRate,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
} from "@/lib/observability/sentry-config";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  release: getSentryRelease(),
  tracesSampleRate: getSentryTracesSampleRate(),
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
  beforeSendSpan: scrubSentrySpan,
  beforeSendTransaction: scrubSentryEvent,
});
