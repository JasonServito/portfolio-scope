import { z } from "zod";

import {
  requireMutableUser,
  requireOwnedAlert,
} from "@/lib/auth/authorization";
import { db } from "@/lib/db";
import { ManagementError } from "@/lib/portfolio/management";

export const alertStatusInputSchema = z
  .object({ status: z.enum(["ACTIVE", "RESOLVED"]) })
  .strict();

export async function listUserAlerts(userId: string) {
  return db.alert.findMany({
    where: {
      userId,
      OR: [{ portfolioId: null }, { portfolio: { userId } }],
    },
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      message: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      stock: { select: { ticker: true, companyName: true } },
      portfolio: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function updateAlertStatus(
  userId: string,
  alertId: string,
  input: unknown,
) {
  const parsed = alertStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ManagementError(
      parsed.error.issues[0]?.message ?? "Invalid alert status.",
      400,
    );
  }

  return db.$transaction(async (tx) => {
    await requireMutableUser(userId, tx);
    await requireOwnedAlert(userId, alertId, tx);
    return tx.alert.update({
      where: { id: alertId },
      data: {
        status: parsed.data.status,
        resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null,
      },
    });
  });
}
