import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  sessionCreate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));

import {
  LocalDisposableAuthError,
  createLocalDisposableDatabaseSession,
  isLocalDisposableAuthAvailable,
  isLocalDisposableAuthRequestAllowed,
} from "@/lib/auth/local-disposable";

const enabledEnvironment = {
  AUTH_SECRET: "test-only-secret",
  AUTH_URL: "http://localhost:3000",
  LOCAL_DISPOSABLE_AUTH_ENABLED: "true",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  VERCEL_ENV: undefined,
};

describe("local disposable authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountFindUnique.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({ id: "local-user" });
    mocks.sessionCreate.mockResolvedValue({ id: "local-session" });
    mocks.sessionDeleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        account: { findUnique: mocks.accountFindUnique },
        session: {
          create: mocks.sessionCreate,
          deleteMany: mocks.sessionDeleteMany,
        },
        user: { create: mocks.userCreate },
      }),
    );
  });

  it("is unavailable unless every local-only guard passes", () => {
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        LOCAL_DISPOSABLE_AUTH_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        NEXT_PUBLIC_APP_URL: "https://localhost:3000",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        NEXT_PUBLIC_APP_URL: "http://example.com:3000",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        AUTH_URL: "https://localhost:3000",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isLocalDisposableAuthAvailable({
        ...enabledEnvironment,
        AUTH_SECRET: "",
      }),
    ).toBe(false);
  });

  it("accepts only a matching HTTP loopback request origin", () => {
    expect(
      isLocalDisposableAuthRequestAllowed(
        new Headers({ origin: "http://localhost:3000" }),
        enabledEnvironment,
      ),
    ).toBe(true);
    expect(
      isLocalDisposableAuthRequestAllowed(
        new Headers({ origin: "http://127.0.0.1:3000" }),
        enabledEnvironment,
      ),
    ).toBe(false);
    expect(
      isLocalDisposableAuthRequestAllowed(new Headers(), enabledEnvironment),
    ).toBe(false);
  });

  it("creates one marked non-demo identity without assigning ADMIN", async () => {
    const session = await createLocalDisposableDatabaseSession(
      enabledEnvironment,
    );

    expect(mocks.userCreate).toHaveBeenCalledOnce();
    const createCall = mocks.userCreate.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      name: "Local SEC Validation",
      accounts: {
        create: {
          provider: "local-disposable",
          providerAccountId: "localhost-manual-sec-validation-v1",
          type: "local",
        },
      },
    });
    expect(createCall.data.email).toMatch(
      /^sec-validation-[0-9a-f-]+@local\.portfolioscope\.invalid$/,
    );
    expect(createCall.data).not.toHaveProperty("role");
    expect(createCall.data).not.toHaveProperty("isDemo", true);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "local-user" },
    });
    expect(mocks.sessionCreate).toHaveBeenCalledWith({
      data: {
        expires: session.expires,
        sessionToken: session.sessionToken,
        userId: "local-user",
      },
    });
    expect(session.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses only the identity behind the dedicated account marker", async () => {
    mocks.accountFindUnique.mockResolvedValue({
      type: "local",
      user: {
        id: "dedicated-user",
        email:
          "sec-validation-12345678-1234-1234-1234-123456789abc@local.portfolioscope.invalid",
        isDemo: false,
        name: "Local SEC Validation",
      },
    });

    await createLocalDisposableDatabaseSession(enabledEnvironment);

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "dedicated-user" },
    });
    expect(mocks.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "dedicated-user" }),
    });
  });

  it("refuses a demo user even if the dedicated marker is attached", async () => {
    mocks.accountFindUnique.mockResolvedValue({
      type: "local",
      user: {
        id: "demo-user",
        email:
          "sec-validation-12345678-1234-1234-1234-123456789abc@local.portfolioscope.invalid",
        isDemo: true,
        name: "Local SEC Validation",
      },
    });

    await expect(
      createLocalDisposableDatabaseSession(enabledEnvironment),
    ).rejects.toBeInstanceOf(LocalDisposableAuthError);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });
});
