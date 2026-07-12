"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/formatters";
import type { SnapshotPoint } from "@/lib/portfolio/types";

type PortfolioPerformanceChartProps = {
  data: SnapshotPoint[];
  currency: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
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

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
          <defs>
            <linearGradient id="portfolioValue" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#059669" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="date"
            minTickGap={28}
            tickFormatter={formatDate}
            tickLine={false}
            tickMargin={10}
          />
          <YAxis
            axisLine={false}
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value) => formatCurrency(Number(value), currency)}
            tickLine={false}
            tickMargin={10}
            width={88}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(value) => formatDate(String(value))}
          />
          <Area
            dataKey="value"
            fill="url(#portfolioValue)"
            stroke="#059669"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
