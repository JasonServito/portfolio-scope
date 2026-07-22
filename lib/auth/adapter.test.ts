import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  linkAccount: vi.fn(),
  prismaAdapter: vi.fn(),
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: mocks.prismaAdapter,
}));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUnique } },
}));

import { createAuthAdapter } from "@/lib/auth/adapter";

describe("Auth.js Prisma adapter policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaAdapter.mockReturnValue({ linkAccount: mocks.linkAccount });
    mocks.linkAccount.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue({ isDemo: false });
  });

  it("persists provider identity without OAuth bearer tokens", async () => {
    const adapter = createAuthAdapter();

    await adapter.linkAccount?.({
      userId: "user-1",
      type: "oauth",
      provider: "github",
      providerAccountId: "provider-user-1",
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      id_token: "secret-id-token",
      expires_at: 123,
      scope: "read:user user:email",
      token_type: "bearer",
    });

    expect(mocks.linkAccount).toHaveBeenCalledWith({
      userId: "user-1",
      type: "oauth",
      provider: "github",
      providerAccountId: "provider-user-1",
    });
  });

  it("does not link OAuth credentials to the marked demo identity", async () => {
    mocks.findUnique.mockResolvedValue({ isDemo: true });
    const adapter = createAuthAdapter();

    await expect(
      adapter.linkAccount?.({
        userId: "demo-user",
        type: "oauth",
        provider: "google",
        providerAccountId: "demo-provider",
      }),
    ).rejects.toThrow("This identity cannot be linked to an OAuth account.");
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });
});
