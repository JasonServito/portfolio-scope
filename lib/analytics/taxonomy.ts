import { z } from "zod";

export const analyticsEventSchemas = {
  demo_opened: z
    .object({
      entryPoint: z.enum(["landing", "navigation", "signin", "direct"]),
    })
    .strict(),
  sign_in_started: z
    .object({ provider: z.enum(["github", "google"]) })
    .strict(),
  sign_in_completed: z.object({}).strict(),
  portfolio_created: z.object({}).strict(),
  stock_page_viewed: z
    .object({
      ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/),
    })
    .strict(),
  research_report_viewed: z
    .object({
      ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/),
      reportMode: z.enum(["demo", "private"]),
    })
    .strict(),
  architecture_page_viewed: z.object({}).strict(),
} as const;

export type AnalyticsEventName = keyof typeof analyticsEventSchemas;

export type AnalyticsEventProperties<TName extends AnalyticsEventName> =
  z.input<(typeof analyticsEventSchemas)[TName]>;

export function validateAnalyticsEvent<TName extends AnalyticsEventName>(
  name: TName,
  properties: AnalyticsEventProperties<TName>,
) {
  return analyticsEventSchemas[name].safeParse(properties);
}
