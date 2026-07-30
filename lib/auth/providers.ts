import { isFeatureEnabled } from "@/lib/operations/feature-flags";

export const authProviderIds = ["github", "google"] as const;

export type AuthProviderId = (typeof authProviderIds)[number];

export function isAuthProviderId(value: unknown): value is AuthProviderId {
  return (
    typeof value === "string" &&
    authProviderIds.includes(value as AuthProviderId)
  );
}

export function isAuthProviderConfigured(provider: AuthProviderId) {
  if (!process.env.AUTH_SECRET) return false;

  if (provider === "github") {
    return Boolean(
      process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
    );
  }

  return Boolean(
    isFeatureEnabled("AUTH_GOOGLE_ENABLED") &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET,
  );
}
