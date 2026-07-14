import { NextResponse } from "next/server";

import { demoReadOnlyMessage, isPublicDemoReadOnly } from "@/lib/demo";
import {
  deleteWatchlistItem,
  ManagementError,
} from "@/lib/portfolio/management";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isPublicDemoReadOnly()) {
    return NextResponse.json(
      { error: demoReadOnlyMessage },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    await deleteWatchlistItem(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const known = error instanceof ManagementError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "The watchlist item could not be deleted.",
      },
      { status: known ? error.status : 500 },
    );
  }
}
