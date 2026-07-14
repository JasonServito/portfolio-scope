import { NextResponse } from "next/server";

import { demoReadOnlyMessage, isPublicDemoReadOnly } from "@/lib/demo";
import {
  createWatchlistItem,
  getDemoWatchlist,
  ManagementError,
} from "@/lib/portfolio/management";

export async function GET() {
  const items = await getDemoWatchlist();
  if (!items)
    return NextResponse.json(
      { error: "Demo watchlist is unavailable." },
      { status: 404 },
    );
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (isPublicDemoReadOnly()) {
    return NextResponse.json(
      { error: demoReadOnlyMessage },
      { status: 403 },
    );
  }

  try {
    const item = await createWatchlistItem(await request.json());
    return NextResponse.json({ id: item.id }, { status: 201 });
  } catch (error) {
    const known = error instanceof ManagementError;
    const malformed = error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : malformed
            ? "Request body must be valid JSON."
            : "The watchlist item could not be created.",
      },
      { status: known ? error.status : malformed ? 400 : 500 },
    );
  }
}
