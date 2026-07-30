"use client";

import Link, { type LinkProps } from "next/link";

import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type {
  AnalyticsEventName,
  AnalyticsEventProperties,
} from "@/lib/analytics/taxonomy";

export function AnalyticsLink<TName extends AnalyticsEventName>({
  children,
  eventName,
  eventProperties,
  ...props
}: LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    eventName: TName;
    eventProperties: AnalyticsEventProperties<TName>;
  }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) {
          captureAnalyticsEvent(eventName, eventProperties);
        }
      }}
    >
      {children}
    </Link>
  );
}
