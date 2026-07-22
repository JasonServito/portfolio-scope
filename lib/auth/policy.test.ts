import { describe, expect, it } from "vitest";

import { getAuthErrorContent } from "@/lib/auth/errors";
import { isOAuthSignInAllowed } from "@/lib/auth/policy";
import {
  isAuthProviderConfigured,
  isAuthProviderId,
} from "@/lib/auth/providers";
import { getSafeRedirectPath } from "@/lib/auth/redirects";

describe("authentication policy", () => {
  it("allows supported providers only", () => {
    expect(isAuthProviderId("github")).toBe(true);
    expect(isAuthProviderId("google")).toBe(true);
    expect(isAuthProviderId("credentials")).toBe(false);
  });

  it("keeps OAuth disabled when the shared Auth.js secret is missing", () => {
    expect(isAuthProviderConfigured("github")).toBe(false);
    expect(isAuthProviderConfigured("google")).toBe(false);
  });

  it("requires an email and a verified Google profile", () => {
    expect(
      isOAuthSignInAllowed({ email: null, provider: "github" }),
    ).toBe(false);
    expect(
      isOAuthSignInAllowed({
        email: "investor@example.com",
        emailVerified: false,
        provider: "google",
      }),
    ).toBe(false);
    expect(
      isOAuthSignInAllowed({
        email: "investor@example.com",
        emailVerified: true,
        provider: "google",
      }),
    ).toBe(true);
    expect(
      isOAuthSignInAllowed({
        email: "investor@example.com",
        provider: "github",
      }),
    ).toBe(true);
  });

  it("blocks external, protocol-relative, and backslash callback paths", () => {
    expect(getSafeRedirectPath("/app/account")).toBe("/app/account");
    expect(getSafeRedirectPath("https://attacker.example")).toBe("/app");
    expect(getSafeRedirectPath("//attacker.example/path")).toBe("/app");
    expect(getSafeRedirectPath("/\\attacker.example")).toBe("/app");
  });

  it("maps known failures without exposing an unknown error value", () => {
    expect(getAuthErrorContent("OAuthAccountNotLinked").title).toContain(
      "provider",
    );
    expect(JSON.stringify(getAuthErrorContent("database.internal"))).not.toContain(
      "database.internal",
    );
  });
});
