import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/errors";
import { requireApiUser } from "@/lib/auth/authorization";
import { listUserAlerts } from "@/lib/portfolio/alerts-service";

export async function GET() {
  try {
    const user = await requireApiUser();
    const alerts = await listUserAlerts(user.id);
    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    return apiErrorResponse(error, "Alerts could not be loaded.");
  }
}
