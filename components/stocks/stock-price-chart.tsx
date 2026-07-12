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

type StockPriceChartProps = {
  currency: string;
  data: SnapshotPoint[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function StockPriceChart({ currency, data }: StockPriceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        No seeded prices are available for this stock.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
          <defs>
            <linearGradient id="stockPrice" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
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
            width={80}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(value) => formatDate(String(value))}
          />
          <Area
            dataKey="value"
            fill="url(#stockPrice)"
            stroke="#2563eb"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
