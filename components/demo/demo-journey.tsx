import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";

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
      className="overflow-hidden rounded-2xl border bg-foreground text-background"
    >
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
        <div className="lg:w-52 lg:shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6ee7b7]">
            Two-minute tour
          </p>
          <h2 className="mt-2 font-semibold" id="demo-journey-heading">
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
                    "flex min-h-14 items-center gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm transition hover:border-white/25 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[#6ee7b7]",
                    active && "border-[#6ee7b7]/45 bg-[#6ee7b7]/8",
                  )}
                  href={step.href}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-[10px] text-white/55",
                      (active || complete) &&
                        "border-[#6ee7b7]/40 text-[#6ee7b7]",
                    )}
                  >
                    {complete ? (
                      <Check className="size-3" />
                    ) : active ? (
                      <Circle className="size-2 fill-current" />
                    ) : (
                      number
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">
                      {step.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-white/45">
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
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-background/90"
            href={next.href}
          >
            Next
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
