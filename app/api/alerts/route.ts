import { NextResponse } from "next/server";

import { getDemoRiskAlerts } from "@/lib/portfolio/alerts-data";

export async function GET() {
  const alerts = await getDemoRiskAlerts();

  return NextResponse.json({
    alerts,
    count: alerts.length,
  });
}
