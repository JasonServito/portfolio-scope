import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser, requireMutableUser } from "@/lib/auth/authorization";
import { enforceRateLimit, getRequestIp } from "@/lib/rate-limit";
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

  try {
    await enforceRateLimit({
      category: "publicStock",
      identifier: `ip:${getRequestIp(_request)}`,
    });
  } catch (error) {
    return apiErrorResponse(error, "Public research is temporarily unavailable.");
  }

  const research = await getLatestResearch(symbol);
  if (!research)
    return NextResponse.json(
      { error: "Research is unavailable for this ticker." },
      { status: 404 },
    );
  return NextResponse.json(research);
}

export async function POST(
  request: Request,
  { params }: ResearchRouteContext,
) {
  try {
    const user = await requireApiUser();
    const symbol = normalizeTicker((await params).ticker);
    if (!symbol) {
      return NextResponse.json(
        { error: "Ticker format is invalid." },
        { status: 400 },
      );
    }

    await requireMutableUser(user.id);

    await Promise.all([
      enforceRateLimit({
        category: "researchGeneration",
        identifier: `user:${user.id}`,
      }),
      enforceRateLimit({
        category: "researchGeneration",
        identifier: `ip:${getRequestIp(request)}`,
      }),
    ]);

    const research = await runResearch(user.id, symbol);
    if (!research) {
      return NextResponse.json(
        { error: "A seeded stock was not found for this ticker." },
        { status: 404 },
      );
    }

    const status =
      research.status === "COMPLETED" && research.reused ? 200 : 202;
    return NextResponse.json(research, { status });
  } catch (error) {
    return apiErrorResponse(
      error,
      "The deterministic research pipeline could not complete.",
    );
  }
}
