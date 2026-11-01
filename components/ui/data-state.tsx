import {
  AlertTriangle,
  Ban,
  Clock3,
  Database,
  Gauge,
  LockKeyhole,
  SearchX,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type DataStateKind =
  | "empty"
  | "partial"
  | "stale"
  | "delayed"
  | "missing"
  | "unsupported"
  | "unauthorized"
  | "rate-limited"
  | "failed";

const icons = {
  empty: Database,
  partial: Gauge,
  stale: Clock3,
  delayed: Clock3,
  missing: SearchX,
  unsupported: Ban,
  unauthorized: LockKeyhole,
  "rate-limited": WifiOff,
  failed: AlertTriangle,
} satisfies Record<DataStateKind, React.ComponentType<{ className?: string }>>;

export function DataState({
  action,
  description,
  kind,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  kind: DataStateKind;
  title: string;
}) {
  const Icon = icons[kind];
  const warning = ["partial", "stale", "delayed", "rate-limited"].includes(kind);
  const failure = kind === "failed" || kind === "unauthorized";

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border bg-muted/30 px-6 py-12 text-center",
        warning && "border-amber-300 bg-amber-50",
        failure && "border-destructive/30 bg-destructive/5",
      )}
      role={failure ? "alert" : "status"}
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-sm",
          warning && "text-amber-800",
          failure && "text-destructive",
        )}
      >
        <Icon className="size-5" />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
