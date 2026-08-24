import { z } from "zod";

import { parseDateOnly } from "./dates";

const earningsRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().trim().min(1).max(16),
  name: z.string().nullable(),
  time: z.string().nullable(),
  epsEstimate: z.number().finite().nullable(),
  eps: z.number().finite().nullable(),
  revenue: z.number().finite().nullable(),
  revenueEstimate: z.number().finite().nullable(),
});

const earningsResponseSchema = z.array(earningsRowSchema).max(100);

export type UpcomingEarningsEvent = {
  eventDate: Date;
  marketSession: "AFTER_MARKET" | "BEFORE_MARKET" | null;
};

export type EarningsContractResult =
  | {
      event: UpcomingEarningsEvent | null;
      rowCount: number;
      success: true;
    }
  | { success: false };

function normalizeMarketSession(value: string | null) {
  if (value === "time-pre-market") return "BEFORE_MARKET" as const;
  if (value === "time-after-hours") return "AFTER_MARKET" as const;
  return null;
}

export function validateEarningsResponse(
  payload: unknown,
  ticker: string,
  marketDate: string,
): EarningsContractResult {
  const symbol = ticker.trim().toUpperCase();
  const parsed = earningsResponseSchema.safeParse(payload);
  if (!parsed.success) return { success: false };
  if (parsed.data.some((row) => row.symbol.trim().toUpperCase() !== symbol)) {
    return { success: false };
  }

  const candidates = parsed.data
    .map((row) => ({ row, eventDate: parseDateOnly(row.date) }))
    .filter(
      (
        item,
      ): item is {
        row: z.infer<typeof earningsRowSchema>;
        eventDate: Date;
      } => item.eventDate !== null,
    );

  if (candidates.length !== parsed.data.length) return { success: false };

  const upcoming = candidates
    .filter(
      ({ row }) =>
        row.date >= marketDate && row.eps === null && row.revenue === null,
    )
    .sort(({ row: left }, { row: right }) =>
      left.date.localeCompare(right.date),
    )[0];

  return {
    event: upcoming
      ? {
          eventDate: upcoming.eventDate,
          marketSession: normalizeMarketSession(upcoming.row.time),
        }
      : null,
    rowCount: parsed.data.length,
    success: true,
  };
}
