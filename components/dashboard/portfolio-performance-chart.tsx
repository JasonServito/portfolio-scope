"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartAxisTick, chartTooltipStyle } from "@/components/ui/chart-theme";
import { formatCurrency } from "@/lib/formatters";
import type { SnapshotPoint } from "@/lib/portfolio/types";

type PortfolioPerformanceChartProps = {
  data: SnapshotPoint[];
  currency: string;
};

const NICE_STEPS = [1, 2, 2.5, 5];
const MIN_VISIBLE_SPAN = 0.05;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatAxisCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function niceStep(rawStep: number) {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = NICE_STEPS.map((multiple) => multiple * magnitude).find(
    (candidate) => candidate >= rawStep,
  );

  return step ?? 10 * magnitude;
}

// The axis always spans at least 5% of the starting value, so a small move
// draws as a small move instead of filling the chart, and ticks land on
// round dollar steps.
export function getValueAxis(values: number[], startValue: number) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, Math.abs(startValue) * MIN_VISIBLE_SPAN, 1);
  const middle = (low + high) / 2;
  const step = niceStep(span / 4);
  const min = Math.floor((middle - span / 2) / step) * step;
  const max = Math.ceil((middle + span / 2) / step) * step;
  const ticks: number[] = [];

  for (let tick = min; tick <= max + step / 2; tick += step) {
    ticks.push(tick);
  }

  return { domain: [min, max] as [number, number], ticks };
}

export function PortfolioPerformanceChart({
  currency,
  data,
}: PortfolioPerformanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        No portfolio snapshots are available for this period.
      </div>
    );
  }

  const first = data[0];
  const last = data.at(-1) ?? first;
  const values = data.map((point) => point.value);
  const axis = getValueAxis(values, first.value);
  const summary = `Portfolio value moved from ${formatCurrency(
    first.value,
    currency,
  )} on ${formatDate(first.date)} to ${formatCurrency(
    last.value,
    currency,
  )} on ${formatDate(last.date)}. The period low was ${formatCurrency(
    Math.min(...values),
    currency,
  )} and the high was ${formatCurrency(Math.max(...values), currency)}.`;

  return (
    <figure className="flex min-h-72 flex-1 flex-col">
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden="true" className="min-h-72 w-full flex-1">
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={28}
              tick={chartAxisTick}
              tickFormatter={formatDate}
              tickLine={false}
              tickMargin={10}
            />
            <YAxis
              axisLine={false}
              domain={axis.domain}
              tick={chartAxisTick}
              tickFormatter={(value) =>
                formatAxisCurrency(Number(value), currency)
              }
              tickLine={false}
              tickMargin={10}
              ticks={axis.ticks}
              width={72}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              cursor={{ stroke: "var(--border)" }}
              formatter={(value) => formatCurrency(Number(value), currency)}
              labelFormatter={(value) => formatDate(String(value))}
            />
            <ReferenceLine
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              y={first.value}
            />
            <Area
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              dataKey="value"
              fill="var(--chart-1)"
              fillOpacity={0.04}
              isAnimationActive={false}
              stroke="var(--chart-1)"
              strokeWidth={2}
              type="monotone"
            />
            <ReferenceDot
              fill="var(--chart-1)"
              r={4}
              stroke="var(--card)"
              strokeWidth={2}
              x={last.date}
              y={last.value}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
