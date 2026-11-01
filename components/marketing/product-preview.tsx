import { PositionWeights } from "@/components/dashboard/allocation-chart";
import type { AllocationItem } from "@/lib/portfolio/types";

// Figures from the read-only demo seed: North Star Portfolio, 1M period as of
// Jun 26, 2026, so the preview matches what the demo shows.
const positions: AllocationItem[] = [
  { key: "MSFT", label: "MSFT", value: 11_676.64, percentage: 0.2277 },
  { key: "NVDA", label: "NVDA", value: 11_634, percentage: 0.2269 },
  { key: "AAPL", label: "AAPL", value: 8_760.58, percentage: 0.1708 },
  { key: "COST", label: "COST", value: 7_452.53, percentage: 0.1453 },
  { key: "GOOGL", label: "GOOGL", value: 6_048.78, percentage: 0.118 },
  { key: "AMZN", label: "AMZN", value: 5_705.38, percentage: 0.1113 },
];

const stats = [
  ["Total value", "$51,277.90"],
  ["1M return", "+1.35%"],
  ["Active alerts", "3"],
] as const;

const contributors = [
  ["NVDA", "+$259.35"],
  ["MSFT", "+$150.23"],
  ["AAPL", "+$92.36"],
] as const;

export function ProductPreview() {
  return (
    <div
      aria-label="Preview of the PortfolioScope demo dashboard"
      className="overflow-hidden rounded-xl border bg-card shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
      role="img"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <p className="text-sm font-medium">North Star Portfolio</p>
        <p className="font-mono text-xs text-muted-foreground">
          As of Jun 26, 2026
        </p>
      </div>
      <dl className="grid grid-cols-3 divide-x border-b">
        {stats.map(([label, value]) => (
          <div className="px-3 py-4 sm:px-5" key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-base font-medium tabular-nums sm:text-xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 p-4 sm:grid-cols-[1.5fr_1fr] sm:p-5">
        <PositionWeights currency="USD" positions={positions} showValues={false} />
        <div>
          <h3 className="text-sm font-medium">Top contributors</h3>
          <p className="mt-1 text-xs text-muted-foreground">Over the past month</p>
          <ul className="mt-3 divide-y text-xs">
            {contributors.map(([ticker, value]) => (
              <li className="flex items-center justify-between py-2" key={ticker}>
                <span className="font-mono font-medium">{ticker}</span>
                <span className="text-positive tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
