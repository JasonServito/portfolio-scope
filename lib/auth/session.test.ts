import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  getCurrentUser,
  isAdminSession,
  requireAdmin,
  requireUser,
} from "@/lib/auth/session";

const userSession = {
  expires: "2026-08-14T00:00:00.000Z",
  user: {
    id: "user-1",
    role: "USER" as const,
    name: "Portfolio User",
    email: "user@example.com",
    image: null,
  },
};

describe("server-side session helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no identity for an anonymous request", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("fails closed without breaking public pages when Auth.js is unavailable", async () => {
    const error = Object.assign(new Error("Auth unavailable"), {
      type: "MissingSecret" as const,
    });
    mocks.auth.mockRejectedValue(error);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("redirects anonymous users to sign-in with a safe local callback", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(requireUser("/app/account")).rejects.toThrow(
      "REDIRECT:/auth/signin?callbackUrl=%2Fapp%2Faccount",
    );
  });

  it("rejects USER sessions from the admin boundary", async () => {
    mocks.auth.mockResolvedValue(userSession);

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/auth/denied");
    expect(isAdminSession(userSession)).toBe(false);
  });

  it("accepts a server-issued ADMIN role", async () => {
    const adminSession = {
      ...userSession,
      user: { ...userSession.user, role: "ADMIN" as const },
    };
    mocks.auth.mockResolvedValue(adminSession);

    await expect(requireAdmin()).resolves.toEqual(adminSession.user);
    expect(isAdminSession(adminSession)).toBe(true);
  });
});
