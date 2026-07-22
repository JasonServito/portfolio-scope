import React from "react";
import { AlertTriangle, Database, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CanonicalFundamentalFact,
  FundamentalsSnapshot,
} from "@/lib/sec/fundamentals-provider";
import type { PeriodKind } from "@/lib/sec/normalization";

const freshnessLabels = {
  CURRENT: "Current",
  RECENT: "Recently refreshed",
  DELAYED: "Delayed",
  STALE: "Stale",
  MISSING: "Missing",
  FAILED: "Refresh failed",
  UNSUPPORTED: "Unsupported",
} as const;

const periodLabels: Record<PeriodKind, string> = {
  INSTANT: "Point in time",
  QUARTERLY: "Quarter",
  YEAR_TO_DATE: "Year to date",
  ANNUAL: "Annual",
};

function formatValue(fact: CanonicalFundamentalFact) {
  if (fact.unit === "USD/share") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(fact.value);
  }

  if (fact.unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(fact.value);
  }

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

function displayMetric(metric: string) {
  return metric
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function FactTable({
  title,
  facts,
}: {
  title: string;
  facts: CanonicalFundamentalFact[];
}) {
  if (facts.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {title} SEC-derived financial facts with filing provenance
          </caption>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium" scope="col">
                Metric
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Value
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Period
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Filing
              </th>
              <th className="px-3 py-2 font-medium" scope="col">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => (
              <tr
                className="border-t"
                key={`${fact.metric}:${fact.periodKind}`}
              >
                <th className="px-3 py-3 font-medium" scope="row">
                  {fact.label}
                  <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                    {fact.isDerived ? "Derived" : "SEC reported"}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] font-normal text-muted-foreground">
                    {fact.taxonomy}:{fact.concept}
                  </span>
                </th>
                <td className="px-3 py-3 font-medium tabular-nums">
                  {formatValue(fact)}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  <span className="block">{periodLabels[fact.periodKind]}</span>
                  <time dateTime={fact.periodEnd}>
                    {new Date(fact.periodEnd).toLocaleDateString("en-US")}
                  </time>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  <span className="block">{fact.formType}</span>
                  <span>
                    {new Date(fact.filedAt).toLocaleDateString("en-US")}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <a
                    className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
                    href={fact.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    SEC filing
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                    {fact.accessionNumber}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SecFundamentals({ data }: { data: FundamentalsSnapshot }) {
  const groups: Array<[string, PeriodKind]> = [
    ["Current balance sheet", "INSTANT"],
    ["Latest reported quarter", "QUARTERLY"],
    ["Latest year-to-date", "YEAR_TO_DATE"],
    ["Latest annual period", "ANNUAL"],
  ];
  const hasFacts = data.facts.length > 0;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" aria-hidden="true" />
            SEC-derived fundamentals
          </CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            PortfolioScope-controlled facts normalized from SEC Company Facts;
            separate from TradingView market-widget data.
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
      <CardContent className="space-y-6">
        {data.provider === "SEEDED_FIXTURE" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            Seeded fallback fixture. This is not live production SEC data.
          </div>
        ) : null}

        {data.freshness === "UNSUPPORTED" ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">SEC coverage is not supported.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              This security is outside the curated M14 U.S. issuer universe.
            </p>
          </div>
        ) : null}

        {!hasFacts && data.freshness !== "UNSUPPORTED" ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">
              {data.freshness === "FAILED"
                ? "SEC facts are unavailable after a failed refresh."
                : "SEC facts have not been ingested yet."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Missing values remain unavailable; PortfolioScope does not replace
              them with zero or seeded production data.
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
              The latest refresh failed. Previously normalized facts remain
              visible with their original retrieval and filing dates.
            </p>
          </div>
        ) : null}

        {groups.map(([title, periodKind]) => (
          <FactTable
            facts={data.facts.filter((fact) => fact.periodKind === periodKind)}
            key={periodKind}
            title={title}
          />
        ))}

        {data.ambiguousMetrics.length > 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">Ambiguous facts were not selected.</p>
            <p className="mt-1">
              {data.ambiguousMetrics.map(displayMetric).join(", ")}. Review the
              competing SEC observations before displaying a value.
            </p>
          </div>
        ) : null}

        {data.missingMetrics.length > 0 && hasFacts ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Unavailable metrics</p>
            <p className="mt-1 text-muted-foreground">
              {data.missingMetrics.map(displayMetric).join(", ")}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
          <span>Source: U.S. SEC EDGAR</span>
          <span>CIK: {data.cik ?? "Unavailable"}</span>
          <span>
            Retrieved:{" "}
            {data.retrievedAt
              ? new Date(data.retrievedAt).toLocaleString("en-US")
              : "Not yet retrieved"}
          </span>
          <span>
            Reported facts only; derived values are labelled separately.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
