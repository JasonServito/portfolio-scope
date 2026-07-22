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
      <div className="flex min-h-screen">
        <AppSidebar activePath={pathname} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader sessionControls={sessionControls} />
          {children}
        </div>
      </div>
    </div>
  );
}
