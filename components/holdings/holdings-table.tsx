import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/formatters";
import { PERFORMANCE_PERIODS } from "@/lib/portfolio/types";
import type { HoldingsPageRow } from "@/lib/portfolio/dashboard-data";
import { HoldingRowActions } from "@/components/holdings/holding-actions";

type HoldingsTableProps = {
  holdings: HoldingsPageRow[];
  currency: string;
  readOnly?: boolean;
};

function returnBadgeClass(value: number) {
  if (value > 0) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (value < 0) {
    return "bg-rose-50 text-rose-700";
  }

  return "bg-muted text-muted-foreground";
}

export function HoldingsTable({
  currency,
  holdings,
  readOnly = false,
}: HoldingsTableProps) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        No holdings are available for this demo portfolio.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableCaption className="sr-only">
          {readOnly
            ? "Read-only public demo portfolio holdings."
            : "Portfolio holdings with management controls."}
        </TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="min-w-28 px-4">Ticker</TableHead>
            <TableHead className="min-w-56">Company</TableHead>
            <TableHead className="text-right">Shares</TableHead>
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Value</TableHead>
            {PERFORMANCE_PERIODS.map((period) => (
              <TableHead className="text-right" key={period}>
                {period}
              </TableHead>
            ))}
            <TableHead className="min-w-36 text-right">
              Total gain/loss
            </TableHead>
            {!readOnly ? (
              <TableHead className="text-right">Manage</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((holding) => (
            <TableRow key={holding.id}>
              <TableCell className="px-4 font-medium">
                <Link
                  className="inline-flex items-center gap-2 hover:underline"
                  href={`/stocks/${holding.ticker.toLowerCase()}`}
                >
                  {holding.ticker}
                  <ArrowUpRight className="size-3 text-muted-foreground" />
                </Link>
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{holding.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {holding.sector} |{" "}
                    {formatPercent(holding.allocationPercent)}
                  </p>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {holding.shares.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(holding.averageCost, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(holding.currentPrice, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(holding.marketValue, currency)}
              </TableCell>
              {PERFORMANCE_PERIODS.map((period) => (
                <TableCell className="text-right" key={period}>
                  <Badge
                    className={returnBadgeClass(holding.periodReturns[period])}
                  >
                    {formatSignedPercent(holding.periodReturns[period])}
                  </Badge>
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                <p className="font-medium">
                  {formatSignedCurrency(holding.totalGainLoss, currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSignedPercent(holding.totalGainLossPercent)}
                </p>
              </TableCell>
              {!readOnly ? (
                <TableCell className="text-right">
                  <HoldingRowActions
                    averageCost={holding.averageCost}
                    id={holding.id}
                    shares={holding.shares}
                    ticker={holding.ticker}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
