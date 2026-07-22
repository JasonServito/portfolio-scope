import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  deleteUser: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    session: { deleteMany: mocks.deleteMany },
    user: {
      delete: mocks.deleteUser,
      findUnique: mocks.findUnique,
    },
  },
}));

import {
  AccountLifecycleError,
  assertAccountDeletionAllowed,
  deleteUserAccount,
  revokeAllUserSessions,
} from "@/lib/auth/account-service";

describe("account lifecycle service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        user: {
          delete: mocks.deleteUser,
          findUnique: mocks.findUnique,
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prevents deletion of the stable public demo identity", async () => {
    mocks.findUnique.mockResolvedValue({ isDemo: true });

    await expect(assertAccountDeletionAllowed("demo-user")).rejects.toEqual(
      new AccountLifecycleError(
        "The public demo identity cannot be deleted.",
        "DEMO_ACCOUNT",
      ),
    );
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("scopes bulk session revocation to the authenticated user", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 3 });

    await expect(revokeAllUserSessions("user-1")).resolves.toEqual({ count: 3 });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("deletes an account by its authenticated server-side ID", async () => {
    mocks.findUnique.mockResolvedValue({ isDemo: false });
    mocks.deleteUser.mockResolvedValue({ id: "user-1" });

    await expect(deleteUserAccount("user-1")).resolves.toEqual({ id: "user-1" });
    expect(mocks.deleteUser).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  it("rechecks demo protection inside the deletion transaction", async () => {
    mocks.findUnique.mockResolvedValue({ isDemo: true });

    await expect(deleteUserAccount("demo-user")).rejects.toEqual(
      new AccountLifecycleError(
        "The public demo identity cannot be deleted.",
        "DEMO_ACCOUNT",
      ),
    );
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
