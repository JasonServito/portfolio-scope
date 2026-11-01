import Link from "next/link";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  EarningsSourceStatus,
  UpcomingEarningsItem,
  UpcomingEarningsPageData,
} from "@/lib/earnings/service";
import { cn } from "@/lib/utils";

const sourceMessages: Partial<Record<EarningsSourceStatus, string>> = {
  COORDINATION_UNAVAILABLE:
    "Live refresh is unavailable right now. No provider request was made; the most recent saved dates are shown.",
  DISABLED:
    "Live earnings updates are not activated. The most recent saved dates are shown.",
  PARTIAL_FAILURE:
    "Some live earnings updates did not finish. The most recent saved dates are shown.",
};

const stateLabels: Record<UpcomingEarningsItem["state"], string> = {
  KNOWN: "Expected",
  STALE: "Stale",
  UNKNOWN: "Unknown",
  UNAVAILABLE: "Unknown",
  UNSUPPORTED: "Unsupported",
};

const stateDots: Record<UpcomingEarningsItem["state"], string> = {
  KNOWN: "bg-primary",
  STALE: "bg-caution",
  UNKNOWN: "bg-muted-foreground/40",
  UNAVAILABLE: "bg-muted-foreground/40",
  UNSUPPORTED: "bg-muted-foreground/40",
};

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function sessionLabel(item: UpcomingEarningsItem) {
  if (item.marketSession === "BEFORE_MARKET") return "Before market open";
  if (item.marketSession === "AFTER_MARKET") return "After market close";
  return "Market session not supplied";
}

function observation(item: UpcomingEarningsItem) {
  if (item.state === "KNOWN" || item.state === "STALE") {
    return {
      detail: sessionLabel(item),
      label: formatEventDate(item.eventDate!),
    };
  }
  if (item.state === "UNKNOWN") {
    return {
      detail: "The data provider listed no upcoming event",
      label: "Date not currently available",
    };
  }
  if (item.state === "UNSUPPORTED") {
    return {
      detail: "Earnings dates are tracked for a fixed list of 25 companies",
      label: "Not covered by the earnings calendar",
    };
  }
  return {
    detail: "No earnings check from the last 72 hours is on file",
    label: "Earnings data unavailable",
  };
}

export function UpcomingEarnings({
  data,
  readOnly = false,
}: {
  data: UpcomingEarningsPageData;
  readOnly?: boolean;
}) {
  const sourceMessage = sourceMessages[data.sourceStatus];

  return (
    <Card data-upcoming-earnings>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Followed companies</CardTitle>
          {readOnly ? <Badge variant="outline">Read-only demo</Badge> : null}
        </div>
        {sourceMessage ? (
          <p
            className="mt-1 flex items-start gap-2 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-caution"
            />
            {sourceMessage}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {data.items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-medium">No followed companies yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a holding or watchlist item to see its earnings status
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.items.map((item) => {
              const displayedObservation = observation(item);

              return (
                <li
                  className="grid gap-3 py-4 text-sm first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)] md:gap-6"
                  key={item.ticker}
                >
                  <div className="min-w-0">
                    <Link
                      className="font-medium hover:underline"
                      href={`/stocks/${item.ticker.toLowerCase()}`}
                      prefetch={false}
                    >
                      {item.ticker}
                    </Link>
                    <p className="truncate text-muted-foreground">
                      {item.companyName}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium tabular-nums">
                      {displayedObservation.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {displayedObservation.detail}
                    </p>
                  </div>
                  <div className="md:text-right">
                    <p className="flex items-center gap-2 md:justify-end">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 rounded-full",
                          stateDots[item.state],
                        )}
                      />
                      <span>{stateLabels[item.state]}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground md:justify-end">
                      {item.followedVia.map((via, index) => (
                        <Fragment key={via}>
                          {index > 0 ? <span aria-hidden="true">·</span> : null}
                          <span>{via === "HOLDING" ? "Holding" : "Watchlist"}</span>
                        </Fragment>
                      ))}
                    </p>
                  </div>
                  {item.fetchedAt ? (
                    <p className="font-mono text-xs text-muted-foreground md:col-span-3">
                      Checked {formatCheckedAt(item.fetchedAt)} UTC
                      {item.source ? <> · {item.source}</> : null}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
