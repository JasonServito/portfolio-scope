import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function signTone(value: number) {
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return undefined;
}

type StatCardProps = {
  label: string;
  value: string;
  detail: string;
  change?: string;
  changeTone?: string;
};

export function StatCard({
  change,
  changeTone,
  detail,
  label,
  value,
}: StatCardProps) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-[28px] leading-none font-medium tabular-nums">
          {value}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {change ? (
            <span className={cn("tabular-nums", changeTone)}>{change} </span>
          ) : null}
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}
