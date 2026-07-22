import { SessionControls } from "@/components/auth/session-controls";
import { AppLayoutClient } from "@/components/layout/app-layout-client";

type AppLayoutProps = {
  children: React.ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <AppLayoutClient sessionControls={<SessionControls />}>
      {children}
    </AppLayoutClient>
  );
}
