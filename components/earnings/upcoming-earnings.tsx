import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  EarningsSourceStatus,
  UpcomingEarningsItem,
  UpcomingEarningsPageData,
} from "@/lib/earnings/service";

const sourceMessages: Partial<Record<EarningsSourceStatus, string>> = {
  COORDINATION_UNAVAILABLE:
    "Live refresh coordination is unavailable. No provider request was made; valid persisted observations are shown where available.",
  DISABLED:
    "Live earnings updates are not activated. Valid persisted observations are shown where available.",
  PARTIAL_FAILURE:
    "Some live earnings updates did not complete. Valid persisted observations are shown where available.",
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
      detail: "The provider returned no future event for this ticker.",
      label: "Date not currently available",
    };
  }
  if (item.state === "UNSUPPORTED") {
    return {
      detail: "No provider call is made outside the fixed 25-ticker catalog.",
      label: "Outside the M26 earnings catalog",
    };
  }
  return {
    detail:
      "No valid persisted observation is available within the 72-hour stale window.",
    label: "Earnings data unavailable",
  };
}

function stateBadge(item: UpcomingEarningsItem) {
  if (item.state === "KNOWN") return <Badge>Expected</Badge>;
  if (item.state === "STALE") return <Badge variant="outline">Stale</Badge>;
  if (item.state === "UNSUPPORTED") {
    return <Badge variant="secondary">Unsupported</Badge>;
  }
  return <Badge variant="outline">Unknown</Badge>;
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
    <section className="space-y-4" data-upcoming-earnings>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">25-ticker catalog</Badge>
        {readOnly ? <Badge variant="secondary">Read-only demo</Badge> : null}
      </div>

      {sourceMessage ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
          role="status"
        >
          {sourceMessage}
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-md bg-muted">
              <CalendarClock className="size-5" />
            </span>
            <div>
              <p className="font-medium">No followed companies yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a holding or watchlist item to see its earnings status.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => {
            const displayedObservation = observation(item);
            return (
              <Card key={item.ticker}>
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        <Link
                          className="hover:underline"
                          href={`/stocks/${item.ticker.toLowerCase()}`}
                          prefetch={false}
                        >
                          {item.ticker}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.companyName}
                      </p>
                    </div>
                    {stateBadge(item)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="font-medium">{displayedObservation.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {displayedObservation.detail}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {item.followedVia.map((via) => (
                      <Badge key={via} variant="outline">
                        {via === "HOLDING" ? "Holding" : "Watchlist"}
                      </Badge>
                    ))}
                  </div>

                  {item.fetchedAt ? (
                    <div className="border-t pt-3 text-xs leading-5 text-muted-foreground">
                      <p>Checked {formatCheckedAt(item.fetchedAt)} UTC</p>
                      {item.source ? <p>Source: {item.source}</p> : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
