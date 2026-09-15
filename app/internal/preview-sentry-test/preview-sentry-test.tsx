"use client";

import * as Sentry from "@sentry/nextjs";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function PreviewSentryTest() {
  const captureStarted = useRef(false);
  const [hasCaptured, setHasCaptured] = useState(false);
  const [eventId, setEventId] = useState<string>();

  function sendTestEvent() {
    if (captureStarted.current) return;

    captureStarted.current = true;
    setHasCaptured(true);
    const timestamp = new Date().toISOString();
    const capturedEventId = Sentry.captureException(
      new Error(`PortfolioScope Preview Sentry test event at ${timestamp}`),
    );

    setEventId(capturedEventId);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        PortfolioScope Preview
      </p>
      <h1 className="text-3xl font-semibold">Sentry validation</h1>
      <p className="text-muted-foreground">
        Send one captured exception to validate Preview error reporting.
      </p>
      <div>
        <Button disabled={hasCaptured} onClick={sendTestEvent}>
          Send Preview Sentry Test Event
        </Button>
      </div>
      {eventId ? (
        <p className="text-sm text-muted-foreground" role="status">
          Sentry event ID: <code>{eventId}</code>
        </p>
      ) : null}
    </main>
  );
}
