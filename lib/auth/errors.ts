export type AuthErrorContent = {
  title: string;
  description: string;
};

const authErrorContent: Record<string, AuthErrorContent> = {
  AccessDenied: {
    title: "Sign-in was not completed",
    description:
      "PortfolioScope could not confirm the required identity information. Try another provider or return to the read-only demo.",
  },
  OAuthAccountNotLinked: {
    title: "Use the provider already linked to this email",
    description:
      "For account safety, PortfolioScope does not automatically merge identities that share an email address. Sign in with the provider you used first.",
  },
  OAuthCallbackError: {
    title: "The provider callback could not be verified",
    description:
      "The sign-in response was invalid or expired. Start a new sign-in attempt.",
  },
  OAuthProfileParseError: {
    title: "Identity information was incomplete",
    description:
      "The provider did not return the identity fields PortfolioScope requires. Try again or use another provider.",
  },
  InvalidCallbackUrl: {
    title: "The return address was rejected",
    description:
      "PortfolioScope blocked an invalid return address. Start sign-in again from this site.",
  },
  InvalidProvider: {
    title: "That sign-in provider is not supported",
    description: "Choose GitHub or Google to continue.",
  },
  Configuration: {
    title: "Sign-in is temporarily unavailable",
    description:
      "Authentication is not configured for this environment. The read-only recruiter demo is still available.",
  },
  AccountDeletion: {
    title: "The account could not be deleted",
    description:
      "No partial account deletion is reported as successful. Sign in again and retry, or contact the site operator if the problem continues.",
  },
  SessionRevocation: {
    title: "Sessions could not be fully revoked",
    description:
      "PortfolioScope could not confirm that every session was removed. Sign in again and retry before relying on the revocation result.",
  },
  LocalDisposableSignIn: {
    title: "Local validation sign-in was not completed",
    description:
      "The guarded localhost identity could not be created safely. Confirm the local configuration and try again.",
  },
};

const defaultAuthError: AuthErrorContent = {
  title: "Authentication could not be completed",
  description:
    "The sign-in attempt failed safely. Try again or continue with the read-only recruiter demo.",
};

export function getAuthErrorContent(error: string | null | undefined) {
  if (!error) return defaultAuthError;
  return authErrorContent[error] ?? defaultAuthError;
}
