import { NextRequest, NextResponse } from "next/server";

const safeIdentifier = /^[A-Za-z0-9._:-]{8,128}$/;
const maintenanceExclusions = [
  "/maintenance",
  "/api/health",
  "/api/ready",
  "/api/internal/",
  "/admin",
  "/api/admin/",
  "/auth/",
  "/api/auth/",
];

function requestIdentifier(value: string | null) {
  return value && safeIdentifier.test(value) ? value : crypto.randomUUID();
}

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function contentSecurityPolicy(value: string) {
  const development = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${value}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""} https://s3.tradingview.com https://*.tradingview.com https://*.posthog.com`,
    "style-src 'self' 'unsafe-inline' https://*.tradingview.com",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io https://*.posthog.com https://*.tradingview.com wss://*.tradingview.com",
    "frame-src https://s.tradingview.com https://*.tradingview.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE?.trim().toLowerCase() === "true";
}

function isMaintenanceExcluded(pathname: string) {
  return maintenanceExclusions.some((path) =>
    path.endsWith("/") ? pathname.startsWith(path) : pathname === path,
  );
}

export function middleware(request: NextRequest) {
  const requestId = requestIdentifier(request.headers.get("x-request-id"));
  const correlationId = requestIdentifier(
    request.headers.get("x-correlation-id"),
  );
  const cspNonce = nonce();
  const csp = contentSecurityPolicy(cspNonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("x-nonce", cspNonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response: NextResponse;
  if (
    isMaintenanceMode() &&
    !isMaintenanceExcluded(request.nextUrl.pathname)
  ) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      response = NextResponse.json(
        {
          error: "PortfolioScope is temporarily unavailable for maintenance.",
          requestId,
        },
        { status: 503 },
      );
    } else {
      const url = request.nextUrl.clone();
      url.pathname = "/maintenance";
      response = NextResponse.rewrite(url, {
        request: { headers: requestHeaders },
      });
      response.headers.set("Retry-After", "300");
    }
  } else if (request.nextUrl.pathname === "/demo") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "?demo=true";
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("X-Frame-Options", "DENY");
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
