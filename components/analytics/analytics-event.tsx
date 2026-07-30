"use client";

import { useEffect } from "react";

import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type {
  AnalyticsEventName,
  AnalyticsEventProperties,
} from "@/lib/analytics/taxonomy";

export function AnalyticsEvent<TName extends AnalyticsEventName>({
  name,
  oncePerSession = false,
  properties,
}: {
  name: TName;
  oncePerSession?: boolean;
  properties: AnalyticsEventProperties<TName>;
}) {
  useEffect(() => {
    const storageKey = `portfolioscope:analytics:${name}`;
    if (oncePerSession) {
      try {
        if (sessionStorage.getItem(storageKey) === "sent") return;
      } catch {
        // Analytics must not affect the product when storage is unavailable.
      }
    }
    const captured = captureAnalyticsEvent(name, properties);
    if (oncePerSession && captured) {
      try {
        sessionStorage.setItem(storageKey, "sent");
      } catch {
        // The validated event was sent; storage is only a deduplication aid.
      }
    }
  }, [name, oncePerSession, properties]);

  return null;
}
