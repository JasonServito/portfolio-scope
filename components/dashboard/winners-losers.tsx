import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import type { WinnerLoser } from "@/lib/portfolio/types";

type WinnersLosersProps = {
  title: string;
  items: WinnerLoser[];
  currency: string;
  tone: "positive" | "negative";
};

export function WinnersLosers({
  currency,
  items,
  title,
  tone,
}: WinnersLosersProps) {
  const Icon = tone === "positive" ? ArrowUpRight : ArrowDownRight;
  const badgeClass =
    tone === "positive"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-rose-50 text-rose-700";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            No ranked holdings are available for this period.
          </div>
        ) : (
          items.map((item) => (
            <Link
              className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3 transition hover:bg-muted/40"
              href={`/stocks/${item.ticker.toLowerCase()}`}
              key={item.id}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {item.ticker}
                  <Icon className="size-3 text-muted-foreground" />
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.companyName}
                </p>
              </div>
              <div className="text-right">
                <Badge className={badgeClass}>
                  {formatSignedPercent(item.periodReturn)}
                </Badge>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatSignedCurrency(item.dollarContribution, currency)}
                </p>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
