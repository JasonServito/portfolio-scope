import Link from "next/link";
import { ArrowRight, Bell, LineChart, ShieldCheck, WalletCards } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto grid min-h-[88vh] w-full max-w-7xl items-center gap-10 px-6 py-12 lg:grid-cols-[1fr_0.9fr] lg:px-8">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" />
            Demo-first portfolio analytics workspace
          </div>

          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal sm:text-5xl">
              PortfolioPulse
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              A clean investing dashboard shell for monitoring holdings,
              watchlists, risk alerts, and stock research in one recruiter-ready
              full-stack product.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link className={buttonVariants({ size: "lg" })} href="/demo">
              Continue as demo investor
              <ArrowRight className="size-4" />
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "lg" })}
              href="/dashboard"
            >
              Open dashboard
            </Link>
          </div>

          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
            {[
              "Period analytics",
              "Risk monitoring",
              "Explainable research",
            ].map((item) => (
              <div
                className="rounded-lg border bg-card px-4 py-3 text-sm font-medium"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Demo portfolio</p>
                <p className="mt-1 text-3xl font-semibold">$128,420.18</p>
              </div>
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                +8.6% 1Y
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["AAPL", "24.4%", "bg-emerald-500"],
                ["MSFT", "18.1%", "bg-sky-500"],
                ["NVDA", "15.8%", "bg-violet-500"],
              ].map(([ticker, value, color]) => (
                <div className="rounded-lg border bg-background p-3" key={ticker}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{ticker}</span>
                    <span className="text-muted-foreground">{value}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-muted">
                    <div className={`${color} h-2 w-2/3 rounded-full`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-6 pb-12 lg:grid-cols-4 lg:px-8">
        {[
          {
            title: "Portfolio",
            description: "Track holdings and allocation.",
            icon: WalletCards,
          },
          {
            title: "Performance",
            description: "Prepare period analytics surfaces.",
            icon: LineChart,
          },
          {
            title: "Alerts",
            description: "Show rule-based risk monitoring.",
            icon: Bell,
          },
          {
            title: "Research",
            description: "Reserve space for explainable AI tabs.",
            icon: ShieldCheck,
          },
        ].map(({ description, icon: Icon, title }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="size-4 text-muted-foreground" />
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {description}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
