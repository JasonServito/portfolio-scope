import { ArrowDownRight, ArrowUpRight, ShieldCheck } from "lucide-react";

const performanceBars = [28, 34, 31, 42, 47, 45, 58, 64, 61, 72, 78, 84];

export function ProductPreview() {
  return (
    <div
      aria-label="Preview of the PortfolioScope demo dashboard"
      className="relative overflow-hidden rounded-[1.5rem] border border-foreground/10 bg-[#0d1a19] p-3 text-white shadow-[0_30px_80px_rgba(8,25,23,0.24)] sm:p-5"
      role="img"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#6ee7b7]" />
          <span className="text-xs font-semibold">North Star Portfolio</span>
        </div>
        <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/65">
          Read-only demo
        </span>
      </div>

      <div className="grid gap-3 py-4 sm:grid-cols-3">
        <PreviewMetric label="Portfolio value" value="$128,420" />
        <PreviewMetric label="1Y return" positive value="+8.6%" />
        <PreviewMetric label="Active risks" value="3" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.45fr_0.8fr]">
        <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Portfolio performance</p>
              <p className="mt-1 text-[10px] text-white/50">
                Period-aware, reproducible snapshots
              </p>
            </div>
            <span className="text-xs font-semibold text-[#6ee7b7]">+$10,184</span>
          </div>
          <div className="mt-6 flex h-28 items-end gap-1.5" aria-hidden="true">
            {performanceBars.map((height, index) => (
              <span
                className="min-w-0 flex-1 rounded-t-sm bg-[#6ee7b7]"
                key={`${height}-${index}`}
                style={{ height: `${height}%`, opacity: 0.28 + index * 0.045 }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[9px] text-white/40">
            <span>Jul</span>
            <span>Oct</span>
            <span>Jan</span>
            <span>Apr</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.055] p-4">
          <p className="text-xs font-medium">Holding contribution</p>
          <div className="mt-4 space-y-3">
            <HoldingRow
              icon={<ArrowUpRight className="size-3" />}
              ticker="NVDA"
              value="+$2,814"
            />
            <HoldingRow
              icon={<ArrowUpRight className="size-3" />}
              ticker="MSFT"
              value="+$1,326"
            />
            <HoldingRow
              icon={<ArrowDownRight className="size-3" />}
              negative
              ticker="DIS"
              value="-$412"
            />
          </div>
          <div className="mt-5 flex gap-2 rounded-lg border border-[#6ee7b7]/20 bg-[#6ee7b7]/8 p-3">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#6ee7b7]" />
            <p className="text-[10px] leading-4 text-white/60">
              Each fundamental retains filing, period, source, and freshness.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  positive,
  value,
}: {
  label: string;
  positive?: boolean;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.055] p-3">
      <p className="text-[10px] text-white/50">{label}</p>
      <p className={positive ? "mt-1 text-lg font-semibold text-[#6ee7b7]" : "mt-1 text-lg font-semibold"}>
        {value}
      </p>
    </div>
  );
}

function HoldingRow({
  icon,
  negative,
  ticker,
  value,
}: {
  icon: React.ReactNode;
  negative?: boolean;
  ticker: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="flex items-center gap-2 font-medium">
        <span
          className={
            negative
              ? "flex size-6 items-center justify-center rounded-md bg-rose-400/10 text-rose-300"
              : "flex size-6 items-center justify-center rounded-md bg-[#6ee7b7]/10 text-[#6ee7b7]"
          }
        >
          {icon}
        </span>
        {ticker}
      </span>
      <span className={negative ? "text-rose-300" : "text-[#6ee7b7]"}>
        {value}
      </span>
    </div>
  );
}
