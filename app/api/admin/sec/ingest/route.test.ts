import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  requireMutableUser: vi.fn(),
  ingestSupportedCompany: vi.fn(),
  queueSecIngestion: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...original,
    requireApiAdmin: mocks.requireApiAdmin,
    requireMutableUser: mocks.requireMutableUser,
  };
});

vi.mock("@/lib/sec/ingestion", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sec/ingestion")>();
  return { ...original, ingestSupportedCompany: mocks.ingestSupportedCompany };
});

vi.mock("@/lib/sec/jobs", () => {
  return { queueSecIngestion: mocks.queueSecIngestion };
});

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...original,
    enforceRateLimit: mocks.enforceRateLimit,
    getRequestIp: () => "203.0.113.10",
  };
});

import {
  AuthorizationError,
  AuthorizationErrorCode,
} from "@/lib/auth/authorization";
import { SecIngestionError, SecIngestionErrorCode } from "@/lib/sec/ingestion";
import { POST } from "./route";

function request(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/admin/sec/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("admin SEC ingestion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SEC_LOCAL_MANUAL_INGESTION_ENABLED", "false");
    mocks.requireApiAdmin.mockResolvedValue({ id: "admin-a", role: "ADMIN" });
    mocks.requireMutableUser.mockResolvedValue({
      id: "admin-a",
      isDemo: false,
    });
    mocks.ingestSupportedCompany.mockResolvedValue({
      runId: "run-a",
      ticker: "AAPL",
      correlationId: "correlation-a",
      status: "COMPLETED",
      filingsProcessed: 2,
      factsProcessed: 10,
      factsSelected: 4,
      ambiguousFacts: 0,
    });
    mocks.enforceRateLimit.mockResolvedValue({ success: true });
    mocks.queueSecIngestion.mockResolvedValue({
      jobId: "job-a",
      type: "SEC_SUBMISSIONS_SYNC",
      status: "QUEUED",
      correlationId: "correlation-a",
      reused: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives the operator from the admin session and accepts one ticker", async () => {
    const response = await POST(request({ ticker: "aapl" }));

    expect(response.status).toBe(202);
    expect(mocks.requireApiAdmin).toHaveBeenCalledOnce();
    expect(mocks.requireMutableUser).toHaveBeenCalledWith("admin-a");
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.queueSecIngestion).toHaveBeenCalledWith("aapl", {
      requestedByUserId: "admin-a",
    });
  });

  it("rejects anonymous access before parsing or ingestion", async () => {
    mocks.requireApiAdmin.mockRejectedValue(
      new AuthorizationError(AuthorizationErrorCode.AUTHENTICATION_REQUIRED),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/sec/ingest", {
        method: "POST",
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.requireMutableUser).not.toHaveBeenCalled();
    expect(mocks.ingestSupportedCompany).not.toHaveBeenCalled();
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("rejects standard-user access before parsing or ingestion", async () => {
    mocks.requireApiAdmin.mockRejectedValue(
      new AuthorizationError(AuthorizationErrorCode.ADMIN_REQUIRED),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/sec/ingest", {
        method: "POST",
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireMutableUser).not.toHaveBeenCalled();
    expect(mocks.ingestSupportedCompany).not.toHaveBeenCalled();
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("rejects a persisted demo identity even if it has an administrator role", async () => {
    mocks.requireMutableUser.mockRejectedValue(
      new AuthorizationError(AuthorizationErrorCode.DEMO_READ_ONLY),
    );

    const response = await POST(request({ ticker: "AAPL" }));

    expect(response.status).toBe(403);
    expect(mocks.ingestSupportedCompany).not.toHaveBeenCalled();
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("runs synchronously only in explicit loopback manual mode", async () => {
    vi.stubEnv("SEC_LOCAL_MANUAL_INGESTION_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "");

    const response = await POST(request({ ticker: "aapl" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runId: "run-a",
      ticker: "AAPL",
      correlationId: "correlation-a",
      status: "COMPLETED",
      filingsProcessed: 2,
      factsProcessed: 10,
      factsSelected: 4,
      ambiguousFacts: 0,
    });
    expect(mocks.ingestSupportedCompany).toHaveBeenCalledWith("aapl", {
      trigger: "LOCAL",
      requestedByUserId: "admin-a",
    });
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("returns a controlled unsupported-ticker response", async () => {
    mocks.queueSecIngestion.mockRejectedValue(
      new SecIngestionError(
        SecIngestionErrorCode.UNSUPPORTED_TICKER,
        400,
        "Ticker is not in the supported SEC universe.",
      ),
    );

    const response = await POST(request({ ticker: "SHOP" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ticker is not in the supported SEC universe.",
      code: SecIngestionErrorCode.UNSUPPORTED_TICKER,
    });
  });

  it("keeps Company Facts validation details server-side in local manual mode", async () => {
    vi.stubEnv("SEC_LOCAL_MANUAL_INGESTION_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.ingestSupportedCompany.mockRejectedValue(
      new SecIngestionError(
        SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
        503,
        "SEC returned data that failed contract validation.",
      ),
    );

    const response = await POST(request({ ticker: "AAPL" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "SEC returned data that failed contract validation.",
      code: SecIngestionErrorCode.SCHEMA_VALIDATION_FAILED,
    });
  });

  it("rejects malformed tickers with a controlled validation response", async () => {
    const response = await POST(request({ ticker: "AAPL1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Ticker must be one to five letters.",
      code: SecIngestionErrorCode.INVALID_TICKER,
    });
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("rejects cross-site browser requests after authorization", async () => {
    const response = await POST(
      request(
        { ticker: "AAPL" },
        {
          Host: "localhost",
          Origin: "https://attacker.example",
        },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cross-site requests are not allowed.",
    });
    expect(mocks.requireApiAdmin).toHaveBeenCalledOnce();
    expect(mocks.queueSecIngestion).not.toHaveBeenCalled();
  });

  it("accepts a same-origin localhost request when Next uses its Docker bind address", async () => {
    const response = await POST(
      new Request("http://0.0.0.0:3000/api/admin/sec/ingest", {
        method: "POST",
        headers: {
          Host: "localhost:3000",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ ticker: "AAPL" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.queueSecIngestion).toHaveBeenCalledOnce();
  });

  it("accepts the forwarded public origin behind a proxy", async () => {
    const response = await POST(
      new Request("http://0.0.0.0:3000/api/admin/sec/ingest", {
        method: "POST",
        headers: {
          Host: "app:3000",
          Origin: "https://preview.portfolioscope.dev",
          "X-Forwarded-Host": "preview.portfolioscope.dev",
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({ ticker: "AAPL" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.queueSecIngestion).toHaveBeenCalledOnce();
  });

  it("preserves non-browser requests without an Origin header", async () => {
    const response = await POST(
      request({ ticker: "AAPL" }, { Host: "localhost" }),
    );

    expect(response.status).toBe(202);
    expect(mocks.queueSecIngestion).toHaveBeenCalledOnce();
  });
});
