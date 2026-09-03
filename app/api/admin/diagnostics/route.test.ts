import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  getOperationalDiagnostics: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", async () => {
  const original = await vi.importActual<
    typeof import("@/lib/auth/authorization")
  >("@/lib/auth/authorization");
  return { ...original, requireApiAdmin: mocks.requireApiAdmin };
});

vi.mock("@/lib/operations/diagnostics", () => ({
  getOperationalDiagnostics: mocks.getOperationalDiagnostics,
}));

import { AuthorizationError } from "@/lib/auth/authorization";
import { GET } from "@/app/api/admin/diagnostics/route";

describe("admin diagnostics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns privacy-safe dependency state to an administrator", async () => {
    mocks.requireApiAdmin.mockResolvedValue({ id: "admin-a", role: "ADMIN" });
    mocks.getOperationalDiagnostics.mockResolvedValue({
      generatedAt: "2026-07-27T00:00:00.000Z",
      services: { database: { status: "ok" } },
      databaseIdentity: {
        database: "portfolio_scope",
        schema: "public",
        hasReasoningTokens: true,
        databaseOid: "16384",
        serverAddress: "192.0.2.10",
        serverPort: 5432,
        serverVersionNumber: "170005",
        systemIdentifier: "7612345678901234567",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/admin/diagnostics"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      services: { database: { status: "ok" } },
      databaseIdentity: {
        database: "portfolio_scope",
        schema: "public",
        hasReasoningTokens: true,
        databaseOid: "16384",
        serverAddress: "192.0.2.10",
        serverPort: 5432,
        serverVersionNumber: "170005",
        systemIdentifier: "7612345678901234567",
      },
    });
  });

  it("rejects a standard user without running dependency probes", async () => {
    mocks.requireApiAdmin.mockRejectedValue(
      new AuthorizationError("ADMIN_REQUIRED"),
    );

    const response = await GET(
      new Request("http://localhost/api/admin/diagnostics"),
    );

    expect(response.status).toBe(403);
    expect(mocks.getOperationalDiagnostics).not.toHaveBeenCalled();
  });
});
