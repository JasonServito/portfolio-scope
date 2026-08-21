import React from "react";
import { AlertTriangle, ExternalLink, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancialTrends } from "@/components/stocks/financial-trends";
import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";
import {
  buildHeadlineMetrics,
  type HeadlineMetric,
} from "@/lib/sec/headline-metrics";
import { buildFinancialTrends } from "@/lib/sec/financial-trends";
import type { PeriodKind } from "@/lib/sec/normalization";

const freshnessLabels = {
  CURRENT: "Current filings",
  RECENT: "Recently refreshed",
  DELAYED: "Refresh delayed",
  STALE: "Stale filings",
  MISSING: "Not available",
  FAILED: "Refresh failed",
  UNSUPPORTED: "Not supported",
} as const;

const periodLabels: Record<PeriodKind, string> = {
  INSTANT: "At reporting date",
  QUARTERLY: "Quarter",
  YEAR_TO_DATE: "Year to date",
  ANNUAL: "Full year",
};

function formatSecDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatHeadlineValue(metric: HeadlineMetric) {
  if (metric.value === null) return "Unavailable";

  if (metric.unit === "USD") return formatCurrency(metric.value);
  if (metric.unit === "USD_PER_SHARE") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(metric.value);
  }
  if (metric.unit === "PERCENT") {
    return `${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
    }).format(metric.value)}%`;
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(metric.value)}x`;
}

function formatFactValue(fact: CanonicalFundamentalFact) {
  if (fact.unit === "USD/share") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(fact.value);
  }
  if (fact.unit === "USD") return formatCurrency(fact.value);
  if (fact.unit === "shares") {
    return `${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(fact.value)} shares`;
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(fact.value)} ${fact.unit}`;
}

function MetricPeriod({ metric }: { metric: HeadlineMetric }) {
  if (metric.value === null || !metric.periodKind || !metric.periodEnd) {
    return (
      <p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground">
        {metric.unavailableReason}
      </p>
    );
  }

  return (
    <p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground">
      {periodLabels[metric.periodKind]} · ended{" "}
      <time dateTime={metric.periodEnd}>
        {formatSecDate(metric.periodEnd, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </time>
    </p>
  );
}

function FinancialEvidence({ data }: { data: FundamentalsSnapshot }) {
  if (data.facts.length === 0) return null;

  return (
    <details className="rounded-lg border bg-muted/20">
      <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        View financial data sources and filing details
      </summary>
      <div className="space-y-3 border-t p-4">
        <p className="text-sm leading-6 text-muted-foreground">
          These selected values retain their original filing identity and source
          so the headline metrics can be checked without making technical detail
          the main view.
        </p>
        <ul className="grid gap-3 md:grid-cols-2">
          {data.facts.map((fact) => (
            <li
              className="rounded-lg border bg-card p-3 text-sm"
              key={`${fact.metric}:${fact.periodKind}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{fact.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {periodLabels[fact.periodKind]} ·{" "}
                    <time dateTime={fact.periodEnd}>
                      {formatSecDate(fact.periodEnd)}
                    </time>
                  </p>
                </div>
                <p className="font-medium tabular-nums">
                  {formatFactValue(fact)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                <a
                  className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
                  href={fact.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {fact.formType} filing
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
                <span>Filed {formatSecDate(fact.filedAt)}</span>
                <span className="font-mono">{fact.accessionNumber}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>Source: U.S. SEC EDGAR</span>
          <span>CIK: {data.cik ?? "Unavailable"}</span>
          <span>
            Retrieved:{" "}
            {data.retrievedAt
              ? new Date(data.retrievedAt).toLocaleString("en-US")
              : "Not yet retrieved"}
          </span>
        </div>
      </div>
    </details>
  );
}

export function SecFundamentals({ data }: { data: FundamentalsSnapshot }) {
  const metrics = buildHeadlineMetrics(data);
  const trends = buildFinancialTrends(data);
  const hasFacts = data.facts.length > 0;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>
            <h2 id="key-metrics-heading">Key Metrics</h2>
          </CardTitle>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A focused view of the latest reliable financial information. Missing
            inputs stay unavailable instead of being estimated.
          </p>
        </div>
        <Badge
          variant={
            data.freshness === "FAILED" || data.freshness === "STALE"
              ? "destructive"
              : "outline"
          }
        >
          {freshnessLabels[data.freshness]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.provider === "SEEDED_FIXTURE" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            Demo financial fixture. These values are not live production filing
            data.
          </div>
        ) : null}

        {data.freshness === "UNSUPPORTED" ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">Financial metrics are not supported.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              This company is outside the current curated U.S. issuer coverage.
            </p>
          </div>
        ) : null}

        {!hasFacts && data.freshness !== "UNSUPPORTED" ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">
              {data.freshness === "FAILED"
                ? "Financial metrics are unavailable after a failed refresh."
                : "Financial metrics have not been loaded yet."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Missing values remain unavailable; PortfolioScope does not replace
              them with zero.
            </p>
          </div>
        ) : null}

        {hasFacts && data.freshness === "FAILED" ? (
          <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              The latest refresh failed. Previously normalized values remain
              visible with their original reporting dates.
            </p>
          </div>
        ) : null}

        <section
          aria-labelledby="key-metrics-heading"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {metrics.map((metric) => (
            <Card data-headline-metric={metric.id} key={metric.id} size="sm">
              <CardHeader>
                <h3 className="text-sm font-medium text-muted-foreground">
                  {metric.label}
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold tabular-nums">
                  {formatHeadlineValue(metric)}
                </p>
                <MetricPeriod metric={metric} />
                <details className="mt-3 border-t pt-3 text-xs">
                  <summary className="flex cursor-pointer items-center gap-1.5 rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <Info className="size-3.5" aria-hidden="true" />
                    What this means
                  </summary>
                  <p className="mt-2 leading-5 text-muted-foreground">
                    {metric.explanation}
                  </p>
                </details>
              </CardContent>
            </Card>
          ))}
        </section>

        <FinancialTrends trends={trends} />

        <FinancialEvidence data={data} />
      </CardContent>
    </Card>
  );
}
