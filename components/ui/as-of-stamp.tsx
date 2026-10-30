import { formatAsOf } from "@/lib/formatters";

export function AsOfStamp({ asOf, note }: { asOf: string; note?: string }) {
  return (
    <p className="font-mono text-xs text-muted-foreground">
      As of <time dateTime={asOf}>{formatAsOf(asOf)}</time>
      {note ? ` · ${note}` : null}
    </p>
  );
}
