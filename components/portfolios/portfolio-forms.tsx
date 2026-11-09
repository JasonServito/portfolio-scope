"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

const inputClassName =
  "h-10 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

// First-run step: every account works with a single portfolio.
export function CreatePortfolioForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to create portfolio."));
        return;
      }
      captureAnalyticsEvent("portfolio_created", {});
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid w-full gap-3 text-left sm:w-md sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={create}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Portfolio name
        <input
          className={inputClassName}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="Long-term investments"
          required
          value={name}
        />
      </label>
      <Button disabled={pending} type="submit">
        <Plus />
        {pending ? "Creating…" : "Create portfolio"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function PortfolioNameForm({
  initialName,
  portfolioId,
}: {
  initialName: string;
  portfolioId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/portfolios/${portfolioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        setError(await responseError(response, "Unable to rename portfolio."));
        return;
      }
      setNotice("Portfolio name was saved.");
      router.refresh();
    } catch {
      setError("Unable to reach the portfolio service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(14rem,24rem)_auto] sm:items-end sm:justify-start"
      onSubmit={save}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Portfolio name
        <input
          className={inputClassName}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      <Button
        disabled={pending || name.trim() === initialName}
        type="submit"
        variant="outline"
      >
        Save name
      </Button>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="text-sm text-muted-foreground sm:col-span-2"
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </form>
  );
}
