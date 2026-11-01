"use client";

import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

type AppLayoutClientProps = {
  children: React.ReactNode;
  sessionControls: React.ReactNode;
};

export function AppLayoutClient({
  children,
  sessionControls,
}: AppLayoutClientProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/25">
      <a
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        <AppSidebar activePath={pathname} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader sessionControls={sessionControls} />
          <div className="flex flex-1 flex-col" id="main-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
