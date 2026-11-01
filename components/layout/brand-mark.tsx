import { Activity } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
        className,
      )}
    >
      <Activity className="size-4" strokeWidth={2.4} />
    </span>
  );
}
