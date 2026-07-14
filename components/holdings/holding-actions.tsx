"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type HoldingForm = { ticker: string; shares: string; averageCost: string };

async function responseError(response: Response, fallback: string) {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error ?? fallback;
  } catch {
    return fallback;
  }
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="h-9 rounded-lg border bg-background px-3 font-normal outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        {...props}
      />
    </label>
  );
}

export function AddHoldingForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HoldingForm>({
    ticker: "",
    shares: "",
    averageCost: "",
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to add holding."));
        return;
      }
      setForm({ ticker: "", shares: "", averageCost: "" });
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Add holding
      </Button>
    );
  return (
    <form
      className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3"
      onSubmit={submit}
    >
      <Field
        label="Ticker"
        maxLength={10}
        onChange={(e) =>
          setForm({ ...form, ticker: e.target.value.toUpperCase() })
        }
        placeholder="AAPL"
        required
        value={form.ticker}
      />
      <Field
        label="Shares"
        min="0.000001"
        onChange={(e) => setForm({ ...form, shares: e.target.value })}
        required
        step="any"
        type="number"
        value={form.shares}
      />
      <Field
        label="Average cost"
        min="0.0001"
        onChange={(e) => setForm({ ...form, averageCost: e.target.value })}
        required
        step="any"
        type="number"
        value={form.averageCost}
      />
      <div className="flex items-center justify-between gap-3 sm:col-span-3">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => setOpen(false)} type="button" variant="ghost">
            <X />
            Cancel
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? "Adding…" : "Add position"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function HoldingRowActions({
  id,
  shares,
  averageCost,
  ticker,
}: {
  id: string;
  shares: number;
  averageCost: number;
  ticker: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    shares: String(shares),
    averageCost: String(averageCost),
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function request(method: "PATCH" | "DELETE") {
    if (
      method === "DELETE" &&
      !window.confirm(`Remove ${ticker} from this portfolio?`)
    )
      return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/holdings/${id}`, {
        method,
        headers:
          method === "PATCH"
            ? { "Content-Type": "application/json" }
            : undefined,
        body: method === "PATCH" ? JSON.stringify(form) : undefined,
      });
      if (!response.ok) {
        setError(
          await responseError(
            response,
            method === "DELETE"
              ? "Unable to delete holding."
              : "Unable to update holding.",
          ),
        );
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (editing)
    return (
      <div className="grid min-w-72 gap-2">
        <div className="flex items-end gap-2">
          <Field
            aria-label="Shares"
            label="Shares"
            min="0.000001"
            onChange={(e) => setForm({ ...form, shares: e.target.value })}
            step="any"
            type="number"
            value={form.shares}
          />
          <Field
            aria-label="Average cost"
            label="Avg cost"
            min="0.0001"
            onChange={(e) => setForm({ ...form, averageCost: e.target.value })}
            step="any"
            type="number"
            value={form.averageCost}
          />
          <Button disabled={pending} onClick={() => request("PATCH")} size="sm">
            Save
          </Button>
          <Button
            aria-label={`Cancel editing ${ticker}`}
            onClick={() => setEditing(false)}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex justify-end gap-1">
        <Button
          aria-label={`Edit ${ticker}`}
          disabled={pending}
          onClick={() => setEditing(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Pencil />
        </Button>
        <Button
          aria-label={`Delete ${ticker}`}
          disabled={pending}
          onClick={() => request("DELETE")}
          size="icon-sm"
          variant="destructive"
        >
          <Trash2 />
        </Button>
      </div>
      {error && (
        <span className="max-w-52 text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
