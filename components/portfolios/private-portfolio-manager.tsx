"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";

type PrivateHolding = {
  id: string;
  ticker: string;
  companyName: string;
  shares: number;
  averageCost: number;
  costBasis: number;
};

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function PrivatePortfolioManager({
  id,
  initialName,
  initialBaseCurrency,
  holdings,
}: {
  id: string;
  initialName: string;
  initialBaseCurrency: string;
  holdings: PrivateHolding[];
}) {
  const router = useRouter();
  const [portfolioForm, setPortfolioForm] = useState({
    name: initialName,
    baseCurrency: initialBaseCurrency,
  });
  const [holdingForm, setHoldingForm] = useState({
    ticker: "",
    shares: "",
    averageCost: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ shares: "", averageCost: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function request(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(await responseError(response, "The change was rejected."));
    }
  }

  async function savePortfolio(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await request(`/api/portfolios/${id}`, "PATCH", portfolioForm);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update portfolio.");
    } finally {
      setPending(false);
    }
  }

  async function addHolding(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await request("/api/holdings", "POST", {
        portfolioId: id,
        ...holdingForm,
      });
      setHoldingForm({ ticker: "", shares: "", averageCost: "" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add holding.");
    } finally {
      setPending(false);
    }
  }

  async function updateHolding(holdingId: string) {
    setPending(true);
    setError("");
    try {
      await request(`/api/holdings/${holdingId}`, "PATCH", editForm);
      setEditingId(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update holding.");
    } finally {
      setPending(false);
    }
  }

  async function removeHolding(holding: PrivateHolding) {
    if (!window.confirm(`Remove ${holding.ticker} from this portfolio?`)) return;
    setPending(true);
    setError("");
    try {
      await request(`/api/holdings/${holding.id}`, "DELETE");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete holding.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Portfolio settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={savePortfolio}
          >
            <Field
              label="Name"
              maxLength={80}
              onChange={(event) =>
                setPortfolioForm({ ...portfolioForm, name: event.target.value })
              }
              required
              value={portfolioForm.name}
            />
            <Field
              label="Currency"
              maxLength={3}
              onChange={(event) =>
                setPortfolioForm({
                  ...portfolioForm,
                  baseCurrency: event.target.value.toUpperCase(),
                })
              }
              pattern="[A-Za-z]{3}"
              required
              value={portfolioForm.baseCurrency}
            />
            <Button disabled={pending} type="submit">
              <Pencil /> Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a holding</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-3 sm:items-end"
            onSubmit={addHolding}
          >
            <Field
              label="Ticker"
              maxLength={10}
              onChange={(event) =>
                setHoldingForm({
                  ...holdingForm,
                  ticker: event.target.value.toUpperCase(),
                })
              }
              placeholder="AAPL"
              required
              value={holdingForm.ticker}
            />
            <Field
              label="Shares"
              min="0.000001"
              onChange={(event) =>
                setHoldingForm({ ...holdingForm, shares: event.target.value })
              }
              required
              step="any"
              type="number"
              value={holdingForm.shares}
            />
            <Field
              label="Average cost"
              min="0.0001"
              onChange={(event) =>
                setHoldingForm({
                  ...holdingForm,
                  averageCost: event.target.value,
                })
              }
              required
              step="any"
              type="number"
              value={holdingForm.averageCost}
            />
            <div className="flex items-center justify-between gap-3 sm:col-span-3">
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
              <Button disabled={pending} type="submit">
                <Plus /> Add holding
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owned holdings</CardTitle>
        </CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This portfolio has no holdings yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Average cost</TableHead>
                  <TableHead>Cost basis</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding) => (
                  <TableRow key={holding.id}>
                    <TableCell>
                      <p className="font-medium">{holding.ticker}</p>
                      <p className="text-xs text-muted-foreground">
                        {holding.companyName}
                      </p>
                    </TableCell>
                    <TableCell>
                      {editingId === holding.id ? (
                        <input
                          aria-label={`${holding.ticker} shares`}
                          className="h-9 w-28 rounded-md border bg-background px-2"
                          min="0.000001"
                          onChange={(event) =>
                            setEditForm({ ...editForm, shares: event.target.value })
                          }
                          step="any"
                          type="number"
                          value={editForm.shares}
                        />
                      ) : (
                        holding.shares.toLocaleString("en-US")
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === holding.id ? (
                        <input
                          aria-label={`${holding.ticker} average cost`}
                          className="h-9 w-28 rounded-md border bg-background px-2"
                          min="0.0001"
                          onChange={(event) =>
                            setEditForm({
                              ...editForm,
                              averageCost: event.target.value,
                            })
                          }
                          step="any"
                          type="number"
                          value={editForm.averageCost}
                        />
                      ) : (
                        formatCurrency(holding.averageCost, initialBaseCurrency)
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(holding.costBasis, initialBaseCurrency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {editingId === holding.id ? (
                          <>
                            <Button
                              disabled={pending}
                              onClick={() => updateHolding(holding.id)}
                              size="sm"
                            >
                              Save
                            </Button>
                            <Button
                              aria-label={`Cancel editing ${holding.ticker}`}
                              onClick={() => setEditingId(null)}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <X />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              aria-label={`Edit ${holding.ticker}`}
                              onClick={() => {
                                setEditingId(holding.id);
                                setEditForm({
                                  shares: String(holding.shares),
                                  averageCost: String(holding.averageCost),
                                });
                              }}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <Pencil />
                            </Button>
                            <Button
                              aria-label={`Delete ${holding.ticker}`}
                              disabled={pending}
                              onClick={() => removeHolding(holding)}
                              size="icon-sm"
                              variant="destructive"
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        {...props}
      />
    </label>
  );
}
