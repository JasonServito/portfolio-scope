import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";

import { GET as getHealth } from "./health/route";
import { GET as getReadiness } from "./ready/route";

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}));

const mockedQueryRaw = vi.mocked(db.$queryRaw);

describe("operational API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://portfolio_scope:portfolio_scope@localhost:5432/portfolio_scope",
    );
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports liveness without checking dependencies", async () => {
    const response = await getHealth(
      new Request("http://localhost/api/health"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body).toMatchObject({
      status: "ok",
      service: "portfolioscope",
    });
    expect(Date.parse(body.timestamp)).not.toBeNaN();
    expect(mockedQueryRaw).not.toHaveBeenCalled();
  });

  it("reports readiness after the database probe succeeds", async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);

    const response = await getReadiness(
      new Request("http://localhost/api/ready"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      service: "portfolioscope",
      checks: {
        configuration: "ok",
        database: "ok",
      },
    });
    expect(mockedQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("fails safely when required runtime configuration is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await getReadiness(
      new Request("http://localhost/api/ready"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: {
        configuration: "failed",
        database: "skipped",
      },
    });
    expect(mockedQueryRaw).not.toHaveBeenCalled();
  });

  it("does not expose dependency errors or detailed production checks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockedQueryRaw.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED database.internal:5432"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await getReadiness(
      new Request("http://localhost/api/ready"),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "not_ready",
      service: "portfolioscope",
    });
    expect(body).not.toHaveProperty("checks");
    expect(JSON.stringify(body)).not.toContain("database.internal");
    expect(consoleError).toHaveBeenCalled();
    const logOutput = consoleError.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(logOutput).toContain("readiness.database.unavailable");
    expect(logOutput).not.toContain("database.internal");

    consoleError.mockRestore();
  });
});
