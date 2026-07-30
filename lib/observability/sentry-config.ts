import type { Event } from "@sentry/nextjs";

function sampleRate(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

export function getSentryRelease(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.NEXT_PUBLIC_SENTRY_RELEASE?.trim() ||
    environment.SENTRY_RELEASE?.trim() ||
    environment.VERCEL_GIT_COMMIT_SHA?.trim() ||
    undefined
  );
}

export function getSentryTracesSampleRate(
  environment: Record<string, string | undefined> = process.env,
) {
  return sampleRate(
    environment.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ||
      environment.SENTRY_TRACES_SAMPLE_RATE,
  );
}

export function scrubSentryEvent<TEvent extends Event>(
  event: TEvent,
): TEvent {
  if (event.user) {
    event.user =
      typeof event.user.id === "string" &&
      /^user_[a-f0-9]{16}$/.test(event.user.id)
        ? { id: event.user.id }
        : undefined;
  }

  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (/authorization|cookie|token|secret|key/i.test(key)) {
        delete headers[key];
      }
    }
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
  }

  return event;
}
