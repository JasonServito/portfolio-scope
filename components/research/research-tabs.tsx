"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";

import { AgentResultCard } from "@/components/research/agent-result-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ResearchAgentName, StockResearch } from "@/lib/research/types";

const tabs: { value: string; label: string; agent?: ResearchAgentName }[] = [
  { value: "overview", label: "Overview" },
  { value: "news", label: "News", agent: "NEWS" },
  { value: "financials", label: "Financials", agent: "FINANCIALS" },
  { value: "competitors", label: "Competitors", agent: "COMPETITORS" },
  {
    value: "political",
    label: "Political Activity",
    agent: "POLITICAL_ACTIVITY",
  },
  { value: "risk", label: "Risk", agent: "RISK" },
  { value: "sources", label: "Sources" },
];

function Overview({ research }: { research: StockResearch }) {
  const report = research.report;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Research overview</CardTitle>
            <Badge variant="secondary">
              {Math.round(report.confidence * 100)}% confidence
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="leading-7 text-muted-foreground">{report.overview}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Generated{" "}
            {new Date(research.generatedAt).toLocaleDateString("en-US")} from
            deterministic demo inputs. No LLM or external API was used.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Evidence coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {research.agents
            .filter((agent) => agent.agentName !== "SYNTHESIS")
            .map((agent) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
                key={agent.agentName}
              >
                <span className="text-sm font-medium">
                  {agent.agentName.toLowerCase().replaceAll("_", " ")}
                </span>
                <span className="text-sm text-muted-foreground">
                  {agent.sources.length} source
                  {agent.sources.length === 1 ? "" : "s"}
                </span>
              </div>
            ))}
        </CardContent>
      </Card>
      {[
        { title: "Supportive context", items: report.bullCase },
        { title: "Counterpoints", items: report.bearCase },
        { title: "Risks", items: report.risks },
        { title: "Missing data", items: report.missingData },
      ].map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {section.items.length ? (
              <ul className="space-y-2 text-sm text-muted-foreground">
                {section.items.map((item) => (
                  <li className="flex gap-2" key={item}>
                    <span aria-hidden>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No items identified.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ResearchTabs({
  ticker,
  initialResearch,
}: {
  ticker: string;
  initialResearch: StockResearch | null;
}) {
  const [research, setResearch] = useState(initialResearch);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/${ticker}`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Research could not be generated.");
      setResearch(body as StockResearch);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Research could not be generated.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  if (!research) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <Sparkles className="size-8" />
          <h3 className="mt-4 text-lg font-semibold">
            Research has not been generated
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Run the deterministic agent pipeline to create explainable research
            from seeded provider data. No live services are contacted.
          </p>
          {error ? (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          ) : null}
          <Button className="mt-6" disabled={isRunning} onClick={run}>
            {isRunning ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isRunning ? "Running agents…" : "Run research"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sources = research.agents
    .filter((agent) => agent.agentName !== "SYNTHESIS")
    .flatMap((agent) =>
      agent.sources.map((source) => ({
        ...source,
        agentName: agent.agentName,
      })),
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" />
            <p className="font-medium">Deterministic research workspace</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Specialist outputs stay visible so every synthesis claim can be
            traced.
          </p>
        </div>
        <Button disabled={isRunning} onClick={run} variant="outline">
          <RefreshCw className={`size-4 ${isRunning ? "animate-spin" : ""}`} />
          {isRunning ? "Running…" : "Refresh research"}
        </Button>
      </div>
      {error ? (
        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      ) : null}
      <Tabs defaultValue="overview">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max" variant="line">
            {tabs.map((tab) => (
              <TabsTrigger
                className="px-3 py-2"
                key={tab.value}
                value={tab.value}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview research={research} />
        </TabsContent>
        {tabs
          .filter((tab) => tab.agent)
          .map((tab) => {
            const result = research.agents.find(
              (agent) => agent.agentName === tab.agent,
            );
            return (
              <TabsContent key={tab.value} value={tab.value}>
                {result ? (
                  <AgentResultCard result={result} />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                      This specialist output is missing from the research job.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            );
          })}
        <TabsContent value="sources">
          <Card>
            <CardHeader>
              <CardTitle>Source registry</CardTitle>
            </CardHeader>
            <CardContent>
              {sources.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {sources.map((source, index) => (
                    <div
                      className="rounded-lg border p-4"
                      key={`${source.reference}-${index}`}
                    >
                      <Badge variant="outline">
                        {source.agentName.toLowerCase().replaceAll("_", " ")}
                      </Badge>
                      <p className="mt-3 font-medium">{source.title}</p>
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
                        {source.reference}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {source.detail}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sources are available for this report.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
