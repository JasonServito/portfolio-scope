"use client";

import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/25">
      <div className="flex min-h-screen">
        <AppSidebar activePath={pathname} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          {children}
        </div>
      </div>
    </div>
  );
}
