import type { Metadata } from "next";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        PortfolioScope
      </p>
      <h1 className="text-3xl font-semibold">Scheduled maintenance</h1>
      <p className="leading-7 text-muted-foreground">
        PortfolioScope is temporarily paused while an operator completes a
        production change. Health checks and administrative recovery controls
        remain available.
      </p>
      <p className="text-sm text-muted-foreground">
        Try again in a few minutes.
      </p>
    </main>
  );
}
