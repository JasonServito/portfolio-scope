import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PERFORMANCE_PERIODS, type PerformancePeriod } from "@/lib/portfolio/types";

type PeriodSelectorProps = {
  selectedPeriod: PerformancePeriod;
};

export function PeriodSelector({ selectedPeriod }: PeriodSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {PERFORMANCE_PERIODS.map((period) => (
        <Link href={`/dashboard?period=${period}`} key={period}>
          <Badge variant={period === selectedPeriod ? "default" : "outline"}>
            {period}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
