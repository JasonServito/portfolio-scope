"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

export type PrivatePortfolioSummary = {
  id: string;
  name: string;
  baseCurrency: string;
  holdingCount: number;
  updatedAt: string;
};

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function PortfolioManager({
  portfolios,
}: {
  portfolios: PrivatePortfolioSummary[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", baseCurrency: "USD" });
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to create portfolio."));
        return;
      }
      captureAnalyticsEvent("portfolio_created", {});
      const name = form.name.trim();
      setForm({ name: "", baseCurrency: "USD" });
      setNotice(`${name} was created.`);
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function remove(portfolio: PrivatePortfolioSummary) {
    if (!window.confirm(`Delete ${portfolio.name} and all of its holdings?`)) {
      return;
    }
    setDeletingId(portfolio.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/portfolios/${portfolio.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to delete portfolio."));
        return;
      }
      setNotice(`${portfolio.name} was deleted.`);
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a private portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_10rem_auto] lg:items-end"
            onSubmit={create}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Portfolio name
              <input
                className="h-10 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                maxLength={80}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Long-term investments"
                required
                value={form.name}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Base currency
              <input
                className="h-10 rounded-lg border bg-background px-3 font-normal uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                maxLength={3}
                onChange={(event) =>
                  setForm({
                    ...form,
                    baseCurrency: event.target.value.toUpperCase(),
                  })
                }
                pattern="[A-Za-z]{3}"
                required
                value={form.baseCurrency}
              />
            </label>
            <Button disabled={pending} type="submit">
              <Plus />
              {pending ? "Creating…" : "Create"}
            </Button>
          </form>
          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {portfolios.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="font-medium">No private portfolios yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create one above, then add the stocks you own.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {portfolios.map((portfolio) => (
            <Card key={portfolio.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{portfolio.name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {portfolio.baseCurrency} · {portfolio.holdingCount}{" "}
                      holding
                      {portfolio.holdingCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    aria-label={`Delete ${portfolio.name}`}
                    disabled={deletingId !== null}
                    onClick={() => remove(portfolio)}
                    size="icon-sm"
                    variant="destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Updated{" "}
                  {new Date(portfolio.updatedAt).toLocaleDateString("en-US")}
                </p>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={`/app/portfolios/${portfolio.id}`}
                  prefetch={false}
                >
                  Open
                  <ArrowRight />
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
