import { NextResponse } from "next/server";

type ResearchRouteContext = {
  params: Promise<{
    ticker: string;
  }>;
};

export async function GET(_request: Request, { params }: ResearchRouteContext) {
  const { ticker } = await params;

  return NextResponse.json({
    status: "placeholder",
    resource: "research",
    ticker: ticker.toUpperCase(),
  });
}
