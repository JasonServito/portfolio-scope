"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatters";
import type { WatchlistPrice } from "@/lib/portfolio/watchlist-prices";

export type WatchlistRow = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  price: WatchlistPrice;
  targetPrice: number | null;
  notes: string | null;
};

const priceDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

async function responseError(response: Response, fallback: string) {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error ?? fallback;
  } catch {
    return fallback;
  }
}

type WatchlistManagerProps = {
  items: WatchlistRow[];
  readOnly?: boolean;
};

export function WatchlistManager({
  items,
  readOnly = false,
}: WatchlistManagerProps) {
  return readOnly ? (
    <ReadOnlyWatchlist items={items} />
  ) : (
    <EditableWatchlistManager items={items} />
  );
}

function ReadOnlyWatchlist({ items }: { items: WatchlistRow[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Companies</CardTitle>
          <Badge variant="outline">Read-only demo</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Open a company for its research. Prices are sample snapshots, and demo
          items cannot be changed.
        </p>
      </CardHeader>
      <CardContent>
        <WatchlistItems
          emptyMessage="No companies are available in the demo watchlist."
          items={items}
        />
      </CardContent>
    </Card>
  );
}

function EditableWatchlistManager({ items }: { items: WatchlistRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ticker: "", targetPrice: "", notes: "" });
  const [editForm, setEditForm] = useState({ targetPrice: "", notes: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
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
      const ticker = form.ticker.trim().toUpperCase();
      setForm({ ticker: "", targetPrice: "", notes: "" });
      setNotice(`${ticker} was added to your watchlist.`);
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
    setNotice("");
    try {
      const response = await fetch(`/api/watchlist/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to remove item."));
        return;
      }
      if (editingId === id) setEditingId(null);
      setNotice(`${ticker} was removed from your watchlist.`);
      router.refresh();
    } catch {
      setError("Unable to reach the watchlist service. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }

  async function save(item: WatchlistRow) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/watchlist/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to update item."));
        return;
      }
      setEditingId(null);
      setNotice(`${item.ticker} target price and notes were updated.`);
      router.refresh();
    } catch {
      setError("Unable to reach the watchlist service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function beginEditing(item: WatchlistRow) {
    setError("");
    setNotice("");
    setEditingId(item.id);
    setEditForm({
      targetPrice: item.targetPrice === null ? "" : String(item.targetPrice),
      notes: item.notes ?? "",
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add to watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 lg:grid-cols-[minmax(8rem,0.7fr)_minmax(9rem,1fr)_minmax(14rem,2fr)_auto] lg:items-end"
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
          </form>
        </CardContent>
      </Card>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Your watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <WatchlistItems
            editForm={editForm}
            editingId={editingId}
            emptyMessage="Your watchlist is empty. Add a ticker from the demo catalog to start monitoring it."
            items={items}
            onCancelEdit={() => setEditingId(null)}
            onEdit={beginEditing}
            onEditFormChange={setEditForm}
            onRemove={remove}
            onSave={save}
            pending={pending}
            removingId={removingId}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function WatchlistItems({
  emptyMessage,
  items,
  editForm,
  editingId = null,
  onCancelEdit,
  onEdit,
  onEditFormChange,
  onRemove,
  onSave,
  pending = false,
  removingId = null,
}: {
  emptyMessage: string;
  items: WatchlistRow[];
  editForm?: { targetPrice: string; notes: string };
  editingId?: string | null;
  onCancelEdit?: () => void;
  onEdit?: (item: WatchlistRow) => void;
  onEditFormChange?: (value: { targetPrice: string; notes: string }) => void;
  onRemove?: (id: string, ticker: string) => void;
  onSave?: (item: WatchlistRow) => void;
  pending?: boolean;
  removingId?: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul aria-label="Watchlist companies" className="divide-y">
      {items.map((item) => (
        <li
          className="grid gap-4 py-4 text-sm first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:gap-6"
          key={item.id}
        >
          <div className="min-w-0">
            <Link
              className="font-medium hover:underline"
              href={`/stocks/${item.ticker.toLowerCase()}`}
              prefetch={false}
            >
              {item.ticker}
            </Link>
            <p className="truncate text-muted-foreground">{item.companyName}</p>
            <p className="text-xs text-muted-foreground">{item.sector}</p>
          </div>
          <WatchlistPriceDetails price={item.price} />
          {editingId === item.id && editForm && onEditFormChange && onSave ? (
            <div className="grid gap-3 md:col-span-2">
              <label className="grid gap-1.5 font-medium">
                Target price <span className="sr-only">optional</span>
                <input
                  aria-label={`${item.ticker} target price`}
                  className="h-9 rounded-lg border bg-background px-3 font-normal"
                  min="0.0001"
                  onChange={(event) =>
                    onEditFormChange({
                      ...editForm,
                      targetPrice: event.target.value,
                    })
                  }
                  placeholder="No target set"
                  step="any"
                  type="number"
                  value={editForm.targetPrice}
                />
              </label>
              <label className="grid gap-1.5 font-medium">
                Notes <span className="sr-only">optional</span>
                <textarea
                  aria-label={`${item.ticker} notes`}
                  className="min-h-24 rounded-lg border bg-background px-3 py-2 font-normal"
                  maxLength={500}
                  onChange={(event) =>
                    onEditFormChange({
                      ...editForm,
                      notes: event.target.value,
                    })
                  }
                  placeholder="What are you monitoring?"
                  value={editForm.notes}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={pending} onClick={() => onSave(item)} size="sm">
                  Save changes
                </Button>
                <Button
                  aria-label={`Cancel editing ${item.ticker}`}
                  disabled={pending}
                  onClick={onCancelEdit}
                  size="icon-sm"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <p>
                  <span className="text-muted-foreground">Target:</span>{" "}
                  <span className="tabular-nums">
                    {item.targetPrice === null
                      ? "Not set"
                      : `${formatCurrency(item.targetPrice, item.price.currency)} ${item.price.currency}`}
                  </span>
                </p>
                <p
                  className={
                    item.notes ? "mt-1" : "mt-1 text-muted-foreground"
                  }
                >
                  {item.notes || "No notes yet"}
                </p>
              </div>
              <div className="flex gap-1 md:justify-end">
                {onEdit ? (
                  <Button
                    aria-label={`Edit ${item.ticker}`}
                    disabled={pending || removingId !== null}
                    onClick={() => onEdit(item)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Pencil />
                  </Button>
                ) : null}
                {onRemove ? (
                  <Button
                    aria-label={`Remove ${item.ticker}`}
                    disabled={pending || removingId !== null}
                    onClick={() => onRemove(item.id, item.ticker)}
                    size="icon-sm"
                    variant="destructive"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function WatchlistPriceDetails({ price }: { price: WatchlistPrice }) {
  if (price.state === "MISSING") {
    return (
      <div>
        <p>
          <span className="text-muted-foreground">Latest price:</span>{" "}
          Unavailable
        </p>
        <p className="text-xs text-muted-foreground">
          No cached demo observation is available.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p>
        <span className="text-muted-foreground">Latest price:</span>{" "}
        <span className="tabular-nums">
          {formatCurrency(price.amount, price.currency)} {price.currency}
        </span>
      </p>
      <p className="mt-1 flex items-start gap-2 font-mono text-xs text-muted-foreground">
        {price.state === "STALE" ? (
          <span
            aria-hidden="true"
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-caution"
          />
        ) : null}
        <span>
          Cached demo price · observed{" "}
          {priceDateFormatter.format(new Date(price.observedAt))}
          {price.state === "STALE" ? " · stale" : ""}
        </span>
      </p>
    </div>
  );
}
