import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

import {
  getSentryRelease,
  getSentryTracesSampleRate,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
} from "@/lib/observability/sentry-config";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  release: getSentryRelease(),
  tracesSampleRate: getSentryTracesSampleRate(),
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
  beforeSendSpan: scrubSentrySpan,
  beforeSendTransaction: scrubSentryEvent,
});

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
if (posthogKey && posthogHost) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: "2026-05-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "never",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
