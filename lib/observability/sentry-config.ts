import type { Breadcrumb, Event } from "@sentry/nextjs";

type TelemetrySpan = {
  data: Record<string, unknown>;
  description?: string;
};

const secretQueryParameter =
  /((?:^|[?&])(?:api[-_]?key|token|secret|credential)=)[^&#\s]*/gi;

function redactTelemetryString(value: string) {
  return value.replace(secretQueryParameter, "$1[REDACTED]");
}

function scrubSpanAttribute(value: unknown): unknown {
  if (typeof value === "string") return redactTelemetryString(value);
  if (Array.isArray(value)) return value.map(scrubSpanAttribute);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /api[-_]?key|token|secret|credential/i.test(key)
          ? "[REDACTED]"
          : scrubSpanAttribute(item),
      ]),
    );
  }
  return value;
}

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

export function scrubSentryEvent<TEvent extends Event>(event: TEvent): TEvent {
  if (event.user) {
    event.user =
      typeof event.user.id === "string" &&
      /^user_[a-f0-9]{16}$/.test(event.user.id)
        ? { id: event.user.id }
        : undefined;
  }

  const headers = event.request?.headers;
  if (headers) {
    const redactPreviewQstashSignature =
      process.env.VERCEL_ENV?.trim().toLowerCase() === "preview";
    for (const key of Object.keys(headers)) {
      if (
        /authorization|cookie|token|secret|key/i.test(key) ||
        (redactPreviewQstashSignature &&
          key.toLowerCase() === "upstash-signature")
      ) {
        delete headers[key];
      }
    }
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) {
      event.request.url = redactTelemetryString(event.request.url);
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);
  }

  return event;
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = redactTelemetryString(breadcrumb.message);
  }
  if (breadcrumb.data) {
    breadcrumb.data = scrubSpanAttribute(breadcrumb.data) as Record<
      string,
      unknown
    >;
  }
  return breadcrumb;
}

export function scrubSentrySpan<TSpan extends TelemetrySpan>(
  span: TSpan,
): TSpan {
  if (span.description) {
    span.description = redactTelemetryString(span.description);
  }
  span.data = scrubSpanAttribute(span.data) as TSpan["data"];
  return span;
}
