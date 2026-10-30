import Link from "next/link";

import { signTone } from "@/components/ui/stat-card";
import { formatSignedCurrency, formatSignedPercent } from "@/lib/formatters";
import type { WinnerLoser } from "@/lib/portfolio/types";
import { cn } from "@/lib/utils";

type WinnersLosersProps = {
  title: string;
  items: WinnerLoser[];
  currency: string;
};

export function WinnersLosers({ currency, items, title }: WinnersLosersProps) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No ranked holdings are available for this period.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                className="-mx-2 flex items-center justify-between gap-4 rounded-sm px-2 py-2.5 transition-colors hover:bg-muted"
                href={`/stocks/${item.ticker.toLowerCase()}`}
                prefetch={false}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {item.ticker}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.companyName}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      signTone(item.dollarContribution),
                    )}
                  >
                    {formatSignedCurrency(item.dollarContribution, currency)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatSignedPercent(item.periodReturn)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
