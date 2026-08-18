"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { Bell, Home, Search } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/holdings", label: "Holdings" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts" },
];

const searchDestinations: Record<string, string> = {
  alert: "/alerts",
  alerts: "/alerts",
  dashboard: "/dashboard",
  holding: "/holdings",
  holdings: "/holdings",
  portfolio: "/dashboard",
  watchlist: "/watchlist",
};

export function getSearchDestination(query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return null;

  const appDestination = searchDestinations[normalizedQuery];
  if (appDestination) return appDestination;

  return /^[a-z]{1,5}$/.test(normalizedQuery)
    ? `/stocks/${normalizedQuery}`
    : null;
}

export function AppHeader({
  sessionControls,
}: {
  sessionControls?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState("");

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const destination = getSearchDestination(searchQuery);
    if (!destination) {
      setSearchError("Enter a ticker or page name such as Holdings or Alerts.");
      return;
    }

    setSearchError("");
    router.push(destination);
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
        <Link className="flex items-center gap-2 lg:hidden" href="/dashboard">
          <BrandMark className="size-8 rounded-lg" />
          <span className="text-sm font-semibold">PortfolioScope</span>
        </Link>

        <form
          aria-label="Site search"
          className="relative hidden flex-1 md:block"
          onSubmit={handleSearch}
          role="search"
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-describedby={searchError ? "header-search-error" : undefined}
            aria-invalid={searchError ? true : undefined}
            className="h-10 w-full rounded-lg border bg-muted/40 pr-16 pl-9 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => {
              setSearchQuery(event.target.value);
              if (searchError) setSearchError("");
            }}
            placeholder="Search tickers, holdings, or alerts"
            type="search"
            value={searchQuery}
          />
          <button
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="submit"
          >
            Go
          </button>
          {searchError ? (
            <p
              className="absolute top-full left-0 mt-1 rounded-md border bg-popover px-2 py-1 text-xs text-destructive shadow-sm"
              id="header-search-error"
              role="alert"
            >
              {searchError}
            </p>
          ) : null}
        </form>

        <div className="ml-auto flex items-center gap-1">
          <nav className="hidden items-center gap-1 lg:flex">
            <Link
              aria-label="PortfolioScope home"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              href="/"
            >
              <Home className="size-4" />
            </Link>
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href="/stocks/aapl"
            >
              AAPL
            </Link>
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href="/stocks/msft"
            >
              MSFT
            </Link>
            <Link
              aria-label="Open alerts"
              className={buttonVariants({
                variant: "outline",
                size: "icon-sm",
              })}
              href="/alerts"
            >
              <Bell className="size-4" />
            </Link>
          </nav>
          {sessionControls}
        </div>
      </div>

      <nav
        aria-label="Demo workspace navigation on small screens"
        className="flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden"
      >
        {mobileNavItems.map((item) => (
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              pathname === item.href && "bg-muted text-foreground",
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
