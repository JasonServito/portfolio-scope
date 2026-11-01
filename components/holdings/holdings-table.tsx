import Link from "next/link";

import { signTone } from "@/components/ui/stat-card";
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
import { cn } from "@/lib/utils";

type HoldingsTableProps = {
  holdings: HoldingsPageRow[];
  currency: string;
  readOnly?: boolean;
};

export function HoldingsTable({
  currency,
  holdings,
  readOnly = false,
}: HoldingsTableProps) {
  if (holdings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No holdings are available for this demo portfolio.
      </p>
    );
  }

  return (
    <Table>
      <TableCaption className="sr-only">
        {readOnly
          ? "Read-only public demo portfolio holdings."
          : "Portfolio holdings with management controls."}
      </TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="min-w-48 pl-0">Holding</TableHead>
          <TableHead className="text-right">Weight</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">Avg cost</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Value</TableHead>
          {PERFORMANCE_PERIODS.map((period) => (
            <TableHead className="text-right font-mono" key={period}>
              {period}
            </TableHead>
          ))}
          <TableHead className={cn("text-right", readOnly && "pr-0")}>
            Total gain/loss
          </TableHead>
          {!readOnly ? (
            <TableHead className="pr-0 text-right">Manage</TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody className="tabular-nums">
        {holdings.map((holding) => (
          <TableRow key={holding.id}>
            <TableCell className="py-2.5 pl-0">
              <Link
                className="font-medium hover:underline"
                href={`/stocks/${holding.ticker.toLowerCase()}`}
                prefetch={false}
              >
                {holding.ticker}
              </Link>
              <p className="max-w-56 truncate text-xs text-muted-foreground">
                {holding.companyName} · {holding.sector}
              </p>
            </TableCell>
            <TableCell className="text-right">
              {formatPercent(holding.allocationPercent, 1)}
            </TableCell>
            <TableCell className="text-right">
              {holding.shares.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(holding.averageCost, currency)}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(holding.currentPrice, currency)}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(holding.marketValue, currency)}
            </TableCell>
            {PERFORMANCE_PERIODS.map((period) => (
              <TableCell
                className={cn(
                  "text-right",
                  signTone(holding.periodReturns[period]) ??
                    "text-muted-foreground",
                )}
                key={period}
              >
                {formatSignedPercent(holding.periodReturns[period])}
              </TableCell>
            ))}
            <TableCell className={cn("text-right", readOnly && "pr-0")}>
              <p className={cn("font-medium", signTone(holding.totalGainLoss))}>
                {formatSignedCurrency(holding.totalGainLoss, currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatSignedPercent(holding.totalGainLossPercent)}
              </p>
            </TableCell>
            {!readOnly ? (
              <TableCell className="pr-0 text-right">
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
  );
}
