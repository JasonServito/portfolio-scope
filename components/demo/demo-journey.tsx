import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  {
    href: "/dashboard?demo=true",
    label: "Portfolio",
    shortLabel: "See the overview",
  },
  {
    href: "/holdings",
    label: "Holding",
    shortLabel: "Open a position",
  },
  {
    href: "/stocks/aapl",
    label: "Stock",
    shortLabel: "Review a company",
  },
] as const;

export function DemoJourney({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const next = Array.from(steps)[currentStep] ?? null;

  return (
    <section
      aria-labelledby="demo-journey-heading"
      className="rounded-xl border bg-card px-5 py-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="lg:w-48 lg:shrink-0">
          <p className="text-xs text-muted-foreground">Two-minute tour</p>
          <h2
            className="mt-0.5 text-sm font-medium"
            id="demo-journey-heading"
          >
            Explore the dashboard
          </h2>
        </div>
        <ol className="grid flex-1 gap-2 sm:grid-cols-3">
          {steps.map((step, index) => {
            const number = index + 1;
            const complete = number < currentStep;
            const active = number === currentStep;

            return (
              <li key={step.label}>
                <Link
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-muted ring-1 ring-foreground/5",
                  )}
                  href={step.href}
                  prefetch={false}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground",
                      active &&
                        "border-primary bg-primary text-primary-foreground",
                      complete && "border-primary/40 text-primary",
                    )}
                  >
                    {complete ? <Check className="size-3.5" /> : number}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{step.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {step.shortLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        {next ? (
          <Link
            className={cn(
              buttonVariants({ variant: "outline" }),
              "shrink-0 self-start lg:self-center",
            )}
            href={next.href}
            prefetch={false}
          >
            Next
            <ArrowRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
