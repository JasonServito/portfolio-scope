"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

export function buildTradingViewSymbol(exchange: string, ticker: string) {
  const normalizedExchange = exchange.trim().toUpperCase();
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9._-]+$/.test(normalizedExchange)) return null;
  if (!/^[A-Z0-9._-]+$/.test(normalizedTicker)) return null;
  return `${normalizedExchange}:${normalizedTicker}`;
}

export function TradingViewWidget({
  exchange,
  ticker,
}: {
  exchange: string;
  ticker: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const symbol = buildTradingViewSymbol(exchange, ticker);

  useEffect(() => {
    if (!container.current || !symbol) {
      setStatus("failed");
      return;
    }

    const element = container.current;
    element.replaceChildren();
    setStatus("loading");
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      save_image: false,
      withdateranges: true,
    });
    script.addEventListener("load", () => setStatus("ready"));
    script.addEventListener("error", () => setStatus("failed"));
    element.appendChild(script);

    return () => {
      element.replaceChildren();
    };
  }, [symbol]);

  const tradingViewUrl = symbol
    ? `https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`
    : "https://www.tradingview.com/";

  return (
    <div className="space-y-3">
      <div
        aria-label={`${ticker.toUpperCase()} market chart provided by TradingView`}
        className="relative min-h-[420px] overflow-hidden rounded-lg border bg-muted/20"
      >
        <div className="absolute inset-0" ref={container} />
        {status !== "ready" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card p-6 text-center">
            <div>
              <p className="font-medium">
                {status === "failed"
                  ? "TradingView chart unavailable"
                  : "Loading TradingView chart"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {status === "failed"
                  ? "Browser privacy settings or the third-party service may be blocking the widget. SEC fundamentals remain available below."
                  : "Market-widget data is separate from PortfolioScope SEC fundamentals."}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Market chart and quote data are provided by TradingView and are not
        stored by PortfolioScope. Data may be delayed.{" "}
        <a
          className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
          href={tradingViewUrl}
          rel="noopener nofollow"
          target="_blank"
        >
          {ticker.toUpperCase()} chart by TradingView
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
