"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { AllocationItem } from "@/lib/portfolio/types";

const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#be123c", "#475569"];

type AllocationChartProps = {
  data: AllocationItem[];
  currency: string;
};

export function AllocationChart({ currency, data }: AllocationChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        No allocation data is available.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[170px_1fr] md:items-center">
      <div className="h-44">
        <ResponsiveContainer height="100%" width="100%">
          <PieChart>
            <Pie
              cx="50%"
              cy="50%"
              data={data}
              dataKey="value"
              innerRadius={48}
              outerRadius={78}
              paddingAngle={2}
            >
              {data.map((item, index) => (
                <Cell fill={COLORS[index % COLORS.length]} key={item.key} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatCurrency(Number(value), currency)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        {data.map((item, index) => (
          <div className="space-y-1" key={item.key}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="truncate font-medium">{item.label}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatPercent(item.percentage)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: COLORS[index % COLORS.length],
                  width: `${Math.min(item.percentage * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
