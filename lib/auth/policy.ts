export function isOAuthSignInAllowed({
  email,
  emailVerified,
  provider,
}: {
  email: string | null | undefined;
  emailVerified?: unknown;
  provider: string | null | undefined;
}) {
  if (!email) return false;
  if (provider === "google" && emailVerified !== true) return false;
  return true;
}
