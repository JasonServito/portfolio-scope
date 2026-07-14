"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatters";

export type WatchlistRow = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  targetPrice: number | null;
  notes: string | null;
};

async function responseError(response: Response, fallback: string) {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function WatchlistManager({ items }: { items: WatchlistRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ticker: "", targetPrice: "", notes: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to add item."));
        return;
      }
      setForm({ ticker: "", targetPrice: "", notes: "" });
      router.refresh();
    } catch {
      setError("Unable to reach the watchlist service. Please try again.");
    } finally {
      setPending(false);
    }
  }
  async function remove(id: string, ticker: string) {
    if (!window.confirm(`Remove ${ticker} from the watchlist?`)) return;
    setRemovingId(id);
    setError("");
    try {
      const response = await fetch(`/api/watchlist/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to remove item."));
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to reach the watchlist service. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add to watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[0.7fr_1fr_2fr_auto] md:items-end"
            onSubmit={add}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Ticker
              <input
                className="h-9 rounded-lg border bg-background px-3 font-normal"
                maxLength={10}
                onChange={(e) =>
                  setForm({ ...form, ticker: e.target.value.toUpperCase() })
                }
                placeholder="COST"
                required
                value={form.ticker}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Target price <span className="sr-only">optional</span>
              <input
                className="h-9 rounded-lg border bg-background px-3 font-normal"
                min="0.0001"
                onChange={(e) =>
                  setForm({ ...form, targetPrice: e.target.value })
                }
                placeholder="Optional"
                step="any"
                type="number"
                value={form.targetPrice}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Notes <span className="sr-only">optional</span>
              <input
                className="h-9 rounded-lg border bg-background px-3 font-normal"
                maxLength={500}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="What are you monitoring?"
                value={form.notes}
              />
            </label>
            <Button disabled={pending} type="submit">
              <Plus />
              {pending ? "Adding…" : "Add"}
            </Button>
            {error && (
              <p
                className="text-sm text-destructive md:col-span-4"
                role="alert"
              >
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Your watchlist is empty. Add a seeded ticker to start monitoring it.
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>
                      <Link
                        className="inline-flex items-center gap-2 hover:underline"
                        href={`/stocks/${item.ticker.toLowerCase()}`}
                      >
                        {item.ticker}
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.companyName}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remove ${item.ticker}`}
                    disabled={removingId !== null}
                    onClick={() => remove(item.id, item.ticker)}
                    size="icon-sm"
                    variant="destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-muted-foreground">{item.sector}</p>
                {item.targetPrice !== null && (
                  <p>
                    <span className="text-muted-foreground">Target:</span>{" "}
                    {formatCurrency(item.targetPrice, "USD")}
                  </p>
                )}
                {item.notes && <p>{item.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
