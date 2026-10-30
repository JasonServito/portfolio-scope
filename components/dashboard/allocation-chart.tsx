import { formatCurrency, formatPercent } from "@/lib/formatters";
import { CONCENTRATION_REVIEW_THRESHOLD } from "@/lib/portfolio/risk-alerts";
import type { AllocationItem } from "@/lib/portfolio/types";
import { cn } from "@/lib/utils";

const SECTOR_TONES = [
  "bg-primary",
  "bg-foreground/45",
  "bg-foreground/30",
  "bg-foreground/20",
  "bg-foreground/12",
  "bg-foreground/8",
];

type AllocationChartProps = {
  currency: string;
  positions: AllocationItem[];
  sectors: AllocationItem[];
};

function sectorTone(index: number) {
  return SECTOR_TONES[Math.min(index, SECTOR_TONES.length - 1)];
}

// Bars share one scale that always leaves room past the review line, so the
// line sits in the same place on every row.
function getBarScale(positions: AllocationItem[]) {
  const largest = Math.max(...positions.map((item) => item.percentage));

  return Math.min(1, Math.max(0.25, Math.ceil((largest + 0.01) / 0.05) * 0.05));
}

export function PositionWeights({
  currency,
  positions,
  showValues = true,
}: {
  currency: string;
  positions: AllocationItem[];
  showValues?: boolean;
}) {
  const threshold = CONCENTRATION_REVIEW_THRESHOLD;
  const scale = getBarScale(positions);
  const toWidth = (share: number) => `${(Math.min(share, scale) / scale) * 100}%`;
  const lineLeft = toWidth(threshold);
  const columns = showValues
    ? "grid-cols-[3rem_1fr_3rem_5rem]"
    : "grid-cols-[3rem_1fr_3rem]";
  const above = positions.filter((item) => item.percentage > threshold);
  const aboveSummary =
    above.length === 0
      ? "No position is above the review line"
      : `${new Intl.ListFormat("en-US").format(above.map((item) => item.label))} ${
          above.length === 1 ? "is" : "are"
        } above the review line`;

  return (
    <figure>
      <figcaption>
        <h3 className="text-sm font-medium">Positions</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Share of portfolio value, with the {formatPercent(threshold, 0)}{" "}
          concentration review line
        </p>
      </figcaption>
      <div aria-hidden="true" className={cn("mt-3 grid gap-3", columns)}>
        <span />
        <span className="relative h-4">
          <span
            className="absolute -translate-x-1/2 font-mono text-[11px] text-muted-foreground"
            style={{ left: lineLeft }}
          >
            {formatPercent(threshold, 0)}
          </span>
        </span>
      </div>
      <ul>
        {positions.map((item) => {
          const isAbove = item.percentage > threshold;

          return (
            <li
              className={cn("grid items-center gap-3 py-1.5 text-xs", columns)}
              key={item.key}
            >
              <span className="font-mono font-medium">{item.label}</span>
              <span aria-hidden="true" className="relative h-1.5 rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground/25"
                  style={{ width: toWidth(item.percentage) }}
                />
                {isAbove ? (
                  <span
                    className="absolute inset-y-0 rounded-r-full bg-caution"
                    style={{
                      left: lineLeft,
                      width: `calc(${toWidth(item.percentage)} - ${lineLeft})`,
                    }}
                  />
                ) : null}
                <span
                  className="absolute -inset-y-1 w-px bg-foreground/40"
                  style={{ left: lineLeft }}
                />
              </span>
              <span className="text-right tabular-nums">
                {formatPercent(item.percentage, 1)}
              </span>
              {showValues ? (
                <span className="text-right text-muted-foreground tabular-nums">
                  {formatCurrency(item.value, currency)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {above.length > 0 ? (
          <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-caution" />
        ) : null}
        {aboveSummary}
      </p>
    </figure>
  );
}

export function AllocationChart({
  currency,
  positions,
  sectors,
}: AllocationChartProps) {
  if (positions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        No allocation data is available.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PositionWeights currency={currency} positions={positions} />

      <figure>
        <figcaption>
          <h3 className="text-sm font-medium">Sectors</h3>
          <span className="sr-only">
            {sectors
              .map((item) => `${item.label}: ${formatPercent(item.percentage, 1)}`)
              .join("; ")}
          </span>
        </figcaption>
        <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
          {sectors.map((item, index) => (
            <span
              className={cn("basis-0", sectorTone(index))}
              key={item.key}
              style={{ flexGrow: item.percentage }}
            />
          ))}
        </div>
        <ul aria-hidden="true" className="mt-3 space-y-1.5 text-xs">
          {sectors.map((item, index) => (
            <li className="flex items-center justify-between gap-3" key={item.key}>
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-[2px]", sectorTone(index))} />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatPercent(item.percentage, 1)}
              </span>
            </li>
          ))}
        </ul>
      </figure>
    </div>
  );
}
