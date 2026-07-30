"use client";

import posthog from "posthog-js";

import {
  type AnalyticsEventName,
  type AnalyticsEventProperties,
  validateAnalyticsEvent,
} from "@/lib/analytics/taxonomy";

export function captureAnalyticsEvent<TName extends AnalyticsEventName>(
  name: TName,
  properties: AnalyticsEventProperties<TName>,
) {
  if (
    !process.env.NEXT_PUBLIC_POSTHOG_KEY ||
    !process.env.NEXT_PUBLIC_POSTHOG_HOST
  ) {
    return false;
  }
  const validated = validateAnalyticsEvent(name, properties);
  if (!validated.success) return false;
  try {
    posthog.capture(name, validated.data);
    return true;
  } catch {
    return false;
  }
}
