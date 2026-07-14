import { NextResponse } from "next/server";

import { demoReadOnlyMessage, isPublicDemoReadOnly } from "@/lib/demo";
import { getLatestResearch, runResearch } from "@/lib/research/orchestrator";

type ResearchRouteContext = { params: Promise<{ ticker: string }> };

function normalizeTicker(ticker: string) {
  const symbol = ticker.trim().toUpperCase();
  return /^[A-Z]{1,5}$/.test(symbol) ? symbol : null;
}

export async function GET(_request: Request, { params }: ResearchRouteContext) {
  const symbol = normalizeTicker((await params).ticker);
  if (!symbol)
    return NextResponse.json(
      { error: "Ticker format is invalid." },
      { status: 400 },
    );

  const research = await getLatestResearch(symbol);
  if (!research)
    return NextResponse.json(
      { error: "Research is unavailable for this ticker." },
      { status: 404 },
    );
  return NextResponse.json(research);
}

export async function POST(
  _request: Request,
  { params }: ResearchRouteContext,
) {
  if (isPublicDemoReadOnly()) {
    return NextResponse.json(
      { error: demoReadOnlyMessage },
      { status: 403 },
    );
  }

  const symbol = normalizeTicker((await params).ticker);
  if (!symbol)
    return NextResponse.json(
      { error: "Ticker format is invalid." },
      { status: 400 },
    );

  try {
    const research = await runResearch(symbol);
    if (!research) {
      return NextResponse.json(
        { error: "A seeded stock was not found for this ticker." },
        { status: 404 },
      );
    }

    return NextResponse.json(research, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "The deterministic research pipeline could not complete." },
      { status: 500 },
    );
  }
}
