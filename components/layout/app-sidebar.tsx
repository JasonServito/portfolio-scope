import Link from "next/link";
import {
  BarChart3,
  Bell,
  Binoculars,
  LayoutDashboard,
  LineChart,
  WalletCards,
} from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const primaryNavItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/holdings",
    label: "Holdings",
    icon: WalletCards,
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    icon: Binoculars,
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: Bell,
  },
];

const researchNavItems = [
  {
    href: "/stocks/aapl",
    label: "AAPL",
    icon: LineChart,
  },
  {
    href: "/stocks/msft",
    label: "MSFT",
    icon: BarChart3,
  },
];

type AppSidebarProps = {
  activePath: string;
};

export function AppSidebar({ activePath }: AppSidebarProps) {
  return (
    <aside className="hidden min-h-screen w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
      <div className="border-b px-5 py-5">
        <Link className="flex items-center gap-3" href="/" prefetch={false}>
          <BrandMark />
          <span>
            <span className="block text-sm font-semibold leading-5">
              PortfolioScope
            </span>
            <span className="block text-xs text-muted-foreground">
              Portfolio dashboard
            </span>
          </span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        <NavGroup
          activePath={activePath}
          items={primaryNavItems}
          label="Demo workspace"
        />
        <NavGroup
          activePath={activePath}
          items={researchNavItems}
          label="Stock research"
        />
      </nav>

      <div className="m-3 rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Demo Mode</p>
          <Badge variant="outline">Read-only</Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Browse the sample portfolio without an account. Changes are disabled.
        </p>
        <Link
          className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline"
          href="/research"
          prefetch={false}
        >
          View sample research →
        </Link>
      </div>
    </aside>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

function NavGroup({
  activePath,
  items,
  label,
}: {
  activePath: string;
  items: NavItem[];
  label: string;
}) {
  return (
    <div className="space-y-2">
      <p className="px-2 text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive =
            activePath === item.href ||
            (item.href.startsWith("/stocks") &&
              activePath.startsWith(item.href));

          return (
            <Link
              className={cn(
                "flex h-9 items-center gap-3 rounded-lg px-2 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              href={item.href}
              key={item.href}
              prefetch={false}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
