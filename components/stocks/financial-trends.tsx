"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  FinancialTrend,
  FinancialTrendPoint,
} from "@/lib/sec/financial-trends";

function formatPeriodTick(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatTrendValue(value: number, unit: FinancialTrend["unit"]) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: unit === "USD" ? "compact" : "standard",
    minimumFractionDigits: unit === "USD" ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function TrendChart({ trend }: { trend: FinancialTrend }) {
  const hasValues = trend.points.some((point) => point.value !== null);

  if (!hasValues) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border bg-muted/30 px-5 text-center text-sm leading-6 text-muted-foreground">
        Quarterly values are unavailable. Missing filing facts remain missing.
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="h-56 min-w-0 w-full">
      <ResponsiveContainer
        height="100%"
        initialDimension={{ height: 224, width: 280 }}
        width="100%"
      >
        <LineChart
          data={trend.points}
          margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
        >
          <CartesianGrid
            stroke="#e5e7eb"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            axisLine={false}
            dataKey="periodEnd"
            minTickGap={20}
            tickFormatter={formatPeriodTick}
            tickLine={false}
            tickMargin={10}
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value) =>
              formatTrendValue(Number(value), trend.unit)
            }
            tickLine={false}
            tickMargin={8}
            width={72}
          />
          <Tooltip
            formatter={(value) => formatTrendValue(Number(value), trend.unit)}
            labelFormatter={(value) =>
              `Quarter ended ${new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              }).format(new Date(String(value)))}`
            }
          />
          <Line
            connectNulls={false}
            dataKey="value"
            dot={{ fill: "#2563eb", r: 3, strokeWidth: 0 }}
            stroke="#2563eb"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ValueTable({ trend }: { trend: FinancialTrend }) {
  if (trend.points.length === 0) return null;

  return (
    <details className="border-t pt-3 text-sm">
      <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        View quarterly values
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            Text alternative for {trend.title.toLowerCase()}
          </caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2 pr-4 font-medium" scope="col">
                Period
              </th>
              <th className="pb-2 text-right font-medium" scope="col">
                {trend.unit === "USD" ? "USD" : "USD per diluted share"}
              </th>
            </tr>
          </thead>
          <tbody>
            {trend.points.map((point: FinancialTrendPoint) => (
              <tr className="border-t" key={point.periodEnd}>
                <th className="py-2 pr-4 font-normal" scope="row">
                  <time dateTime={point.periodEnd}>{point.periodLabel}</time>
                </th>
                <td className="py-2 text-right font-medium tabular-nums">
                  {point.value === null
                    ? "Unavailable"
                    : formatTrendValue(point.value, trend.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function FinancialTrends({ trends }: { trends: FinancialTrend[] }) {
  return (
    <section
      aria-labelledby="financial-trends-heading"
      className="border-t pt-6"
    >
      <div>
        <h2 className="text-xl font-semibold" id="financial-trends-heading">
          Financial Trends
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Up to eight selected quarters from company filings. Gaps stay
          unavailable and lines do not connect across missing facts.
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {trends.map((trend) => (
          <Card data-financial-trend={trend.id} key={trend.id} size="sm">
            <CardHeader className="gap-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{trend.title}</h3>
                <Badge variant="outline">
                  {trend.status === "AVAILABLE"
                    ? "Available"
                    : trend.status === "PARTIAL"
                      ? "Partial data"
                      : "Unavailable"}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {trend.description} Unit:{" "}
                {trend.unit === "USD" ? "USD" : "USD per diluted share"}.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="min-h-10 text-sm leading-5">{trend.summary}</p>
              {trend.missingPeriods.length > 0 ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Missing: {trend.missingPeriods.join(", ")}.
                </p>
              ) : null}
              <TrendChart trend={trend} />
              <ValueTable trend={trend} />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
