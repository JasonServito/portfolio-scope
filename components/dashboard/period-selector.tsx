import Link from "next/link";

import {
  PERFORMANCE_PERIODS,
  type PerformancePeriod,
} from "@/lib/portfolio/types";
import { cn } from "@/lib/utils";

type PeriodSelectorProps = {
  selectedPeriod: PerformancePeriod;
};

export function PeriodSelector({ selectedPeriod }: PeriodSelectorProps) {
  return (
    <nav
      aria-label="Performance period"
      className="flex w-fit gap-0.5 rounded-md bg-muted p-0.5"
    >
      {PERFORMANCE_PERIODS.map((period) => {
        const active = period === selectedPeriod;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active &&
                "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-foreground/5",
            )}
            href={`/dashboard?period=${period}`}
            key={period}
            prefetch={false}
          >
            {period}
          </Link>
        );
      })}
    </nav>
  );
}
