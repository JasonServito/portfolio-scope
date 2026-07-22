import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isAuthProviderConfigured: vi.fn(() => false),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  requireUser: vi.fn(),
  signInWithLocalDisposable: vi.fn(),
  signInWithProvider: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({
  signInWithLocalDisposable: mocks.signInWithLocalDisposable,
  signInWithProvider: mocks.signInWithProvider,
}));
vi.mock("@/lib/auth/providers", () => ({
  isAuthProviderConfigured: mocks.isAuthProviderConfigured,
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.requireUser,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ProtectedAppLayout from "@/app/app/layout";
import SignInPage from "@/app/auth/signin/page";
import RootLayout from "@/app/layout";

describe("authentication route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.requireUser.mockResolvedValue({ id: "user-1", role: "USER" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the root layout public", () => {
    const layout = RootLayout({ children: React.createElement("main") });

    expect(layout.type).toBe("html");
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("renders the sign-in page for an anonymous user without redirecting", async () => {
    const page = await SignInPage({
      searchParams: Promise.resolve({ callbackUrl: "/app" }),
    });

    expect(page.type).toBe("main");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps authentication on the protected app layout", async () => {
    await ProtectedAppLayout({ children: React.createElement("main") });

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.requireUser).toHaveBeenCalledWith("/app");
  });
});
