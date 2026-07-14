import { NextResponse } from "next/server";

import { demoReadOnlyMessage, isPublicDemoReadOnly } from "@/lib/demo";
import {
  deleteHolding,
  ManagementError,
  updateHolding,
} from "@/lib/portfolio/management";

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown, fallback: string) {
  const known = error instanceof ManagementError;
  const malformed = error instanceof SyntaxError;
  return NextResponse.json(
    {
      error: known
        ? error.message
        : malformed
          ? "Request body must be valid JSON."
          : fallback,
    },
    { status: known ? error.status : malformed ? 400 : 500 },
  );
}

function readOnlyResponse() {
  return NextResponse.json({ error: demoReadOnlyMessage }, { status: 403 });
}

export async function PATCH(request: Request, { params }: Context) {
  if (isPublicDemoReadOnly()) return readOnlyResponse();

  try {
    const { id } = await params;
    const holding = await updateHolding(id, await request.json());
    return NextResponse.json({ id: holding.id });
  } catch (error) {
    return failure(error, "The holding could not be updated.");
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  if (isPublicDemoReadOnly()) return readOnlyResponse();

  try {
    const { id } = await params;
    await deleteHolding(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return failure(error, "The holding could not be deleted.");
  }
}
