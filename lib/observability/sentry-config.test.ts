import { describe, expect, it } from "vitest";

import {
  getSentryTracesSampleRate,
  scrubSentryEvent,
} from "@/lib/observability/sentry-config";

describe("Sentry privacy configuration", () => {
  it("removes request bodies, cookies, secret headers, and user PII", () => {
    const event = scrubSentryEvent({
      user: {
        id: "user-1",
        email: "private@example.test",
        ip_address: "127.0.0.1",
      },
      request: {
        cookies: { session: "secret" },
        data: { portfolioValue: 123 },
        headers: {
          authorization: "Bearer secret",
          cookie: "session=secret",
          "user-agent": "test",
        },
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.headers).toEqual({ "user-agent": "test" });
  });

  it("accepts only bounded performance sample rates", () => {
    expect(
      getSentryTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "0.1" }),
    ).toBe(0.1);
    expect(
      getSentryTracesSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "2" }),
    ).toBe(0);
    expect(getSentryTracesSampleRate({})).toBe(0);
  });

  it("retains only an already privacy-safe user identifier", () => {
    expect(
      scrubSentryEvent({
        user: { id: "user_0123456789abcdef", email: "ignored@example.test" },
      }).user,
    ).toEqual({ id: "user_0123456789abcdef" });
  });
});
