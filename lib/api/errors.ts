import { NextResponse } from "next/server";

import { AuthorizationError } from "@/lib/auth/authorization";
import { ManagementError } from "@/lib/portfolio/management";
import { RateLimitError } from "@/lib/rate-limit";
import { JobRequestError } from "@/lib/jobs/errors";

export function apiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof ManagementError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: error.headers },
    );
  }

  if (error instanceof JobRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}
