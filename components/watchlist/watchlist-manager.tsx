"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Demo watchlist</CardTitle>
            <Badge variant="outline">Read-only demo</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Explore the curated companies and open their research pages. Public
            demo items cannot be added or removed.
          </p>
        </CardContent>
      </Card>
      <WatchlistItems
        emptyMessage="No companies are available in the demo watchlist."
        items={items}
      />
    </div>
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
      <WatchlistItems
        editForm={editForm}
        editingId={editingId}
        emptyMessage="Your watchlist is empty. Add a seeded ticker to start monitoring it."
        items={items}
        onCancelEdit={() => setEditingId(null)}
        onEdit={beginEditing}
        onEditFormChange={setEditForm}
        onRemove={remove}
        onSave={save}
        pending={pending}
        removingId={removingId}
      />
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
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <section
      aria-label="Watchlist companies"
      className="grid gap-4 lg:grid-cols-2"
    >
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
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </Link>
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.companyName}
                </p>
              </div>
              <div className="flex gap-1">
                {onEdit && editingId !== item.id ? (
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
                {onRemove && editingId !== item.id ? (
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
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{item.sector}</p>
            {editingId === item.id && editForm && onEditFormChange && onSave ? (
              <div className="grid gap-3 pt-2">
                <label className="grid gap-1.5 font-medium">
                  Target price <span className="sr-only">optional</span>
                  <input
                    aria-label={`${item.ticker} target price`}
                    className="h-10 rounded-lg border bg-background px-3 font-normal"
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
                  <Button
                    disabled={pending}
                    onClick={() => onSave(item)}
                    size="sm"
                  >
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
                <p>
                  <span className="text-muted-foreground">Target:</span>{" "}
                  {item.targetPrice === null
                    ? "Not set"
                    : formatCurrency(item.targetPrice, "USD")}
                </p>
                <p className={item.notes ? undefined : "text-muted-foreground"}>
                  {item.notes || "No notes yet."}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
