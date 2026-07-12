"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/holdings", label: "Holdings" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts" },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
        <Link className="flex items-center gap-2 lg:hidden" href="/dashboard">
          <span className="size-3 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold">PortfolioScope</span>
        </Link>

        <div className="hidden flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground md:flex">
          <Search className="size-4" />
          Search tickers, holdings, or alerts
        </div>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/stocks/aapl">
            AAPL
          </Link>
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/stocks/msft">
            MSFT
          </Link>
          <Button aria-label="Open notifications" size="icon-sm" variant="outline">
            <Bell className="size-4" />
          </Button>
        </nav>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden">
        {mobileNavItems.map((item) => (
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              pathname === item.href && "bg-muted text-foreground"
            )}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
