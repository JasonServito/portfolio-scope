import { afterEach, describe, expect, it, vi } from "vitest";

import { writeLog } from "@/lib/observability/logger";

describe("structured logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one JSON record with privacy-safe user identity and context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    writeLog("info", "job completed", {
      correlationId: "correlation-123",
      jobId: "job-123",
      userId: "private-user-id",
      durationMs: 12.7,
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      level: "info",
      message: "job completed",
      correlationId: "correlation-123",
      jobId: "job-123",
      durationMs: 13,
    });
    expect(payload.userId).toMatch(/^user_[a-f0-9]{16}$/);
    expect(payload.userId).not.toContain("private-user-id");
  });

  it("redacts sensitive keys, bearer values, and credentials in URLs", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    writeLog(
      "error",
      "Bearer abc.def",
      {
        details: {
          authorization: "Bearer private",
          nested: {
            cookie: "session=secret",
            endpoint: "postgresql://user:password@db.example.test/app",
          },
        },
      },
      new Error("Bearer another-secret"),
    );

    const output = String(error.mock.calls[0]?.[0]);
    expect(output).not.toContain("abc.def");
    expect(output).not.toContain("private");
    expect(output).not.toContain("session=secret");
    expect(output).not.toContain("user:password");
    expect(output).not.toContain("another-secret");
    expect(output).toContain("[REDACTED]");
  });
});
