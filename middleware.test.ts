import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

describe("request correlation and security middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds safe request IDs and hardened response headers", () => {
    const response = middleware(
      new NextRequest("http://localhost:3000/api/health", {
        headers: { "x-request-id": "request-1234" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe("request-1234");
    expect(response.headers.get("x-correlation-id")).toMatch(
      /^[a-f0-9-]{36}$/,
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("fails API requests closed during maintenance but keeps health available", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "true");
    const blocked = middleware(
      new NextRequest("http://localhost:3000/api/portfolios"),
    );
    const health = middleware(
      new NextRequest("http://localhost:3000/api/health"),
    );

    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toMatchObject({
      error: expect.stringContaining("maintenance"),
    });
    expect(health.status).toBe(200);
  });

  it("preserves one-click demo access through an edge redirect", () => {
    const response = middleware(
      new NextRequest("http://localhost:3000/demo"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard?demo=true",
    );
  });
});
