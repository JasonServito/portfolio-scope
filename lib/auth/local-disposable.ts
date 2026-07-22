import { randomBytes, randomUUID } from "node:crypto";

import { db } from "@/lib/db";

const LOCAL_ACCOUNT_PROVIDER = "local-disposable";
const LOCAL_ACCOUNT_ID = "localhost-manual-sec-validation-v1";
const LOCAL_ACCOUNT_TYPE = "local";
const LOCAL_EMAIL_SUFFIX = "@local.portfolioscope.invalid";
const LOCAL_USER_NAME = "Local SEC Validation";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type LocalAuthEnvironment = {
  [key: string]: string | undefined;
  AUTH_SECRET?: string;
  AUTH_URL?: string;
  LOCAL_DISPOSABLE_AUTH_ENABLED?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_ENV?: string;
};

export class LocalDisposableAuthError extends Error {}

export function isLocalDisposableAuthAvailable(
  environment: LocalAuthEnvironment = process.env,
) {
  if (environment.LOCAL_DISPOSABLE_AUTH_ENABLED !== "true") return false;
  if (!environment.AUTH_SECRET) return false;

  const vercelEnvironment = environment.VERCEL_ENV?.toLowerCase();
  if (vercelEnvironment === "preview" || vercelEnvironment === "production") {
    return false;
  }

  const configuredOrigin = getHttpLoopbackOrigin(
    environment.NEXT_PUBLIC_APP_URL,
  );
  if (!configuredOrigin) return false;

  const authOrigin = environment.AUTH_URL
    ? getHttpLoopbackOrigin(environment.AUTH_URL)
    : configuredOrigin;
  return authOrigin === configuredOrigin;
}

export function isLocalDisposableAuthRequestAllowed(
  requestHeaders: Headers,
  environment: LocalAuthEnvironment = process.env,
) {
  if (!isLocalDisposableAuthAvailable(environment)) return false;

  const configuredOrigin = getHttpLoopbackOrigin(
    environment.NEXT_PUBLIC_APP_URL,
  );
  const requestOrigin = getHttpLoopbackOrigin(requestHeaders.get("origin"));

  return Boolean(
    configuredOrigin &&
      requestOrigin &&
      configuredOrigin === requestOrigin,
  );
}

export async function createLocalDisposableDatabaseSession(
  environment: LocalAuthEnvironment = process.env,
) {
  if (!isLocalDisposableAuthAvailable(environment)) {
    throw new LocalDisposableAuthError(
      "Local disposable authentication is unavailable.",
    );
  }

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.$transaction(async (transaction) => {
    const existingAccount = await transaction.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: LOCAL_ACCOUNT_PROVIDER,
          providerAccountId: LOCAL_ACCOUNT_ID,
        },
      },
      select: {
        type: true,
        user: {
          select: {
            id: true,
            email: true,
            isDemo: true,
            name: true,
          },
        },
      },
    });

    const user = existingAccount
      ? assertDedicatedLocalUser(existingAccount)
      : await transaction.user.create({
          data: {
            name: LOCAL_USER_NAME,
            email: `sec-validation-${randomUUID()}${LOCAL_EMAIL_SUFFIX}`,
            accounts: {
              create: {
                type: LOCAL_ACCOUNT_TYPE,
                provider: LOCAL_ACCOUNT_PROVIDER,
                providerAccountId: LOCAL_ACCOUNT_ID,
              },
            },
          },
          select: { id: true },
        });

    await transaction.session.deleteMany({ where: { userId: user.id } });
    await transaction.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });
  });

  return { expires, sessionToken };
}

function assertDedicatedLocalUser(account: {
  type: string;
  user: {
    id: string;
    email: string | null;
    isDemo: boolean;
    name: string | null;
  };
}) {
  const { user } = account;
  if (
    account.type !== LOCAL_ACCOUNT_TYPE ||
    user.isDemo ||
    user.name !== LOCAL_USER_NAME ||
    !user.email?.startsWith("sec-validation-") ||
    !user.email.endsWith(LOCAL_EMAIL_SUFFIX)
  ) {
    throw new LocalDisposableAuthError(
      "The dedicated local identity is invalid.",
    );
  }

  return user;
}

function getHttpLoopbackOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !isLoopbackHostname(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string) {
  if (hostname === "localhost" || hostname === "[::1]") return true;

  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}
