"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { AgentResultCard } from "@/components/research/agent-result-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ResearchAgentName,
  ResearchClaim,
  ResearchEvidenceRecord,
  StockResearch,
} from "@/lib/research/types";

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

function evidenceAnchor(id: string) {
  return `evidence-${id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function safeSourceUrl(sourceUrl: string | null) {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(
        "en-US",
        dateOnly ? { timeZone: "UTC" } : undefined,
      );
}

function generationLabel(research: StockResearch) {
  if (research.generationMode === "EXTERNAL") return "AI-generated";
  if (research.generationMode === "RECORDED") return "Recorded AI output";
  return "Deterministic";
}

function generationDescription(research: StockResearch) {
  const date = new Date(research.generatedAt).toLocaleDateString("en-US");
  if (research.generationMode === "EXTERNAL") {
    return `AI-generated ${date} from the cited evidence snapshot. Model output was schema-validated; verify material claims against primary sources.`;
  }
  if (research.generationMode === "RECORDED") {
    return `Generated ${date} from recorded model output for evaluation. No live model call was made for this view.`;
  }
  return `Generated ${date} from deterministic demo inputs. No LLM or external AI API was used.`;
}

function ClaimCard({
  claim,
  onEvidenceSelect,
}: {
  claim: ResearchClaim;
  onEvidenceSelect: (evidenceId: string) => void;
}) {
  const supporting = claim.evidence.filter(
    (reference) => reference.role === "SUPPORTING",
  );
  const counter = claim.evidence.filter(
    (reference) => reference.role === "COUNTER",
  );

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{claim.category.toLowerCase()}</Badge>
        <Badge variant="secondary">
          {Math.round(claim.confidence * 100)}% confidence
        </Badge>
        <span className="text-xs text-muted-foreground">
          As of {formatDate(claim.asOfDate) ?? claim.asOfDate}
        </span>
      </div>
      <p className="mt-3 leading-7">{claim.statement}</p>
      {supporting.length || counter.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Supporting evidence
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {supporting.length ? (
                supporting.map((reference) => (
                  <button
                    className="rounded-md border px-2 py-1 text-xs underline-offset-2 hover:underline"
                    key={reference.id}
                    onClick={() => onEvidenceSelect(reference.id)}
                    type="button"
                  >
                    {reference.title}
                  </button>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  None cited
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Counter-evidence
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {counter.length ? (
                counter.map((reference) => (
                  <button
                    className="rounded-md border px-2 py-1 text-xs underline-offset-2 hover:underline"
                    key={reference.id}
                    onClick={() => onEvidenceSelect(reference.id)}
                    type="button"
                  >
                    {reference.title}
                  </button>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  None cited
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          This claim has no attached evidence reference.
        </p>
      )}
      {claim.assumptions.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Assumptions: {claim.assumptions.join("; ")}
        </p>
      ) : null}
    </article>
  );
}

function MetadataCard({ research }: { research: StockResearch }) {
  const metadata = research.metadata;
  if (!metadata) return null;

  const versions = [
    ["Prompt", metadata.promptVersion],
    ["Output schema", metadata.outputSchemaVersion],
    ["Retrieval", metadata.retrievalVersion],
    ["Calculations", metadata.calculationVersion],
    ["Source data", metadata.sourceDataVersion],
    ["Input data", metadata.inputDataVersion],
    ["Report", metadata.reportVersion],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Generation record</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Provider and model</p>
          <p className="mt-1 break-words text-sm font-medium">
            {[metadata.provider, metadata.model].filter(Boolean).join(" · ") ||
              "Not applicable"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Token usage</p>
          <p className="mt-1 text-sm font-medium">
            {metadata.inputTokens ?? 0} input / {metadata.outputTokens ?? 0}{" "}
            output
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Estimated AI cost</p>
          <p className="mt-1 text-sm font-medium">
            {metadata.estimatedCostUsd === null
              ? "Not applicable"
              : `$${metadata.estimatedCostUsd.toFixed(4)}`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Source snapshot</p>
          <p
            className="mt-1 truncate font-mono text-xs"
            title={metadata.sourceSnapshotSha256 ?? undefined}
          >
            {metadata.sourceSnapshotSha256 ?? "Not recorded"}
          </p>
        </div>
        {versions.length ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-xs text-muted-foreground">Versioned inputs</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {versions.map(([label, value]) => (
                <Badge key={label} variant="outline">
                  {label}: {value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Overview({
  onEvidenceSelect,
  research,
}: {
  onEvidenceSelect: (evidenceId: string) => void;
  research: StockResearch;
}) {
  const report = research.report;
  const failedAgents = research.agents.filter(
    (agent) => agent.status === "FAILED",
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Research overview</CardTitle>
            <div className="flex flex-wrap gap-2">
              {report.rating ? (
                <Badge variant="outline">{report.rating.toLowerCase()}</Badge>
              ) : null}
              <Badge variant="secondary">
                {Math.round(report.confidence * 100)}% confidence
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="leading-7 text-muted-foreground">{report.overview}</p>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {generationDescription(research)}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Research context only—not investment advice or a buy, sell, or hold
            recommendation.
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
                <span className="text-right text-sm text-muted-foreground">
                  {agent.status === "FAILED"
                    ? "partial failure"
                    : `${agent.sources.length} source${agent.sources.length === 1 ? "" : "s"}`}
                </span>
              </div>
            ))}
        </CardContent>
      </Card>

      {failedAgents.length ? (
        <div
          className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 lg:col-span-2"
          role="status"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          This report is partial. {failedAgents.length} specialist
          {failedAgents.length === 1 ? "" : "s"} failed, and the synthesis
          preserves the resulting evidence gaps.
        </div>
      ) : null}

      {research.claims?.length ? (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Claims and evidence</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {research.claims.map((claim) => (
              <ClaimCard
                claim={claim}
                key={claim.id}
                onEvidenceSelect={onEvidenceSelect}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {[
        { title: "Supportive context", items: report.bullCase },
        { title: "Counterpoints", items: report.bearCase },
        { title: "Risks", items: report.risks },
        { title: "Missing data", items: report.missingData },
        { title: "Disagreements", items: report.disagreements ?? [] },
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

      <MetadataCard research={research} />
    </div>
  );
}

export function ResearchTabs({
  ticker,
  initialResearch,
  readOnly = false,
}: {
  ticker: string;
  initialResearch: StockResearch | null;
  readOnly?: boolean;
}) {
  return readOnly ? (
    <ReadOnlyResearchTabs research={initialResearch} />
  ) : (
    <EditableResearchTabs initialResearch={initialResearch} ticker={ticker} />
  );
}

function ReadOnlyResearchTabs({
  research,
}: {
  research: StockResearch | null;
}) {
  if (!research) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <Sparkles aria-hidden="true" className="size-8" />
          <h3 className="mt-4 text-lg font-semibold">
            Sample research is unavailable
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            The public demo is read-only and cannot start a research job. Try
            another seeded company to inspect an existing deterministic report.
          </p>
          <Badge className="mt-5" variant="outline">
            Read-only demo
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <ResearchReportContent
      action={<Badge variant="outline">Read-only sample</Badge>}
      research={research}
    />
  );
}

function EditableResearchTabs({
  ticker,
  initialResearch,
}: {
  ticker: string;
  initialResearch: StockResearch | null;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(regenerate: boolean) {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/research/${encodeURIComponent(ticker)}`,
        {
          body: JSON.stringify({ regenerate }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as {
        error?: string;
        jobId?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Research could not be queued.");
      }
      if (!body.jobId) {
        throw new Error("Research was queued without a report identifier.");
      }
      router.push(`/app/research/${encodeURIComponent(body.jobId)}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Research could not be queued.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  if (!initialResearch) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <Sparkles className="size-8" />
          <h3 className="mt-4 text-lg font-semibold">
            Research has not been generated
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Start the configured evidence-grounded pipeline. External AI remains
            default-off and can run only within the configured usage limits.
          </p>
          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="mt-6"
            disabled={isRunning}
            onClick={() => run(false)}
          >
            {isRunning ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isRunning ? "Queuing…" : "Run research"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ResearchReportContent
      action={
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button
            disabled={isRunning}
            onClick={() => run(true)}
            variant="outline"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${isRunning ? "animate-spin" : ""}`}
            />
            {isRunning ? "Queuing…" : "Regenerate report"}
          </Button>
          <span className="max-w-xs text-xs text-muted-foreground">
            Starts a new run and may consume configured AI budget.
          </span>
        </div>
      }
      error={error}
      research={initialResearch}
    />
  );
}

function EvidenceReferenceCard({
  reference,
  roles,
}: {
  reference: ResearchEvidenceRecord;
  roles: Array<"SUPPORTING" | "COUNTER">;
}) {
  const sourceUrl = safeSourceUrl(reference.sourceUrl);
  const title = sourceUrl ? (
    <a
      className="font-medium underline-offset-2 hover:underline"
      href={sourceUrl}
      rel="noreferrer"
      target="_blank"
    >
      {reference.title}
    </a>
  ) : (
    <p className="font-medium">{reference.title}</p>
  );

  return (
    <article
      className="rounded-lg border p-4"
      id={evidenceAnchor(reference.id)}
      tabIndex={-1}
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {reference.sourceKind.toLowerCase().replaceAll("_", " ")}
        </Badge>
        {roles.map((role) => (
          <Badge key={role} variant="secondary">
            {role.toLowerCase()}
          </Badge>
        ))}
      </div>
      <div className="mt-3">{title}</div>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
        {reference.sourceReference}
      </p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {reference.excerpt}
      </p>
      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {reference.section ? (
          <div>
            <dt className="inline font-medium text-foreground">Section: </dt>
            <dd className="inline">{reference.section}</dd>
          </div>
        ) : null}
        {reference.accessionNumber ? (
          <div>
            <dt className="inline font-medium text-foreground">Accession: </dt>
            <dd className="inline font-mono">{reference.accessionNumber}</dd>
          </div>
        ) : null}
        {reference.sourceDate ? (
          <div>
            <dt className="inline font-medium text-foreground">
              Source date:{" "}
            </dt>
            <dd className="inline">{formatDate(reference.sourceDate)}</dd>
          </div>
        ) : null}
        {reference.retrievedAt ? (
          <div>
            <dt className="inline font-medium text-foreground">Retrieved: </dt>
            <dd className="inline">{formatDate(reference.retrievedAt)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function ResearchReportContent({
  action,
  error,
  research,
}: {
  action: ReactNode;
  error?: string | null;
  research: StockResearch;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const agentSources = research.agents
    .filter((agent) => agent.agentName !== "SYNTHESIS")
    .flatMap((agent) =>
      agent.sources.map((source) => ({
        ...source,
        agentName: agent.agentName,
      })),
    );
  const evidenceById = new Map<string, ResearchEvidenceRecord>();
  for (const reference of research.evidenceRegistry ?? []) {
    evidenceById.set(reference.id, reference);
  }
  const evidenceRoles = new Map<string, Set<"SUPPORTING" | "COUNTER">>();
  for (const claim of research.claims ?? []) {
    for (const reference of claim.evidence) {
      evidenceById.set(reference.id, reference);
      const roles = evidenceRoles.get(reference.id) ?? new Set();
      roles.add(reference.role);
      evidenceRoles.set(reference.id, roles);
    }
  }
  const evidence = [...evidenceById.values()];
  const isAiGenerated = research.generationMode === "EXTERNAL";

  useEffect(() => {
    if (activeTab !== "sources" || !evidenceTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(evidenceAnchor(evidenceTarget));
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setEvidenceTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, evidenceTarget]);

  function selectEvidence(evidenceId: string) {
    setEvidenceTarget(evidenceId);
    setActiveTab("sources");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {isAiGenerated ? (
              <Sparkles aria-hidden="true" className="size-4" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            <p className="font-medium">Evidence-grounded research workspace</p>
            <Badge variant={isAiGenerated ? "default" : "secondary"}>
              {generationLabel(research)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Claims, counter-evidence, missing information, and generation
            versions remain visible for review.
          </p>
        </div>
        {action}
      </div>
      {error ? (
        <div
          className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="size-4" />
          {error}
        </div>
      ) : null}
      <Tabs onValueChange={setActiveTab} value={activeTab}>
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
          <Overview onEvidenceSelect={selectEvidence} research={research} />
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
                  <AgentResultCard
                    evidence={evidence}
                    onEvidenceSelect={selectEvidence}
                    result={result}
                  />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                      This specialist output is missing from the research job.
                      The gap remains visible in synthesis confidence.
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
            <CardContent className="space-y-6">
              {evidence.length ? (
                <section>
                  <h3 className="text-sm font-semibold">
                    Claim-level evidence
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {evidence.map((reference) => (
                      <EvidenceReferenceCard
                        key={reference.id}
                        reference={reference}
                        roles={[...(evidenceRoles.get(reference.id) ?? [])]}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
              {agentSources.length ? (
                <section>
                  <h3 className="text-sm font-semibold">
                    Specialist source summaries
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {agentSources.map((source, index) => (
                      <div
                        className="rounded-lg border p-4"
                        key={`${source.reference}-${index}`}
                      >
                        <Badge variant="outline">
                          {source.agentName.toLowerCase().replaceAll("_", " ")}
                        </Badge>
                        <div className="mt-3 flex items-start gap-2">
                          <BookOpen className="mt-0.5 size-4 shrink-0" />
                          <div>
                            <p className="font-medium">{source.title}</p>
                            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                              {source.reference}
                            </p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {source.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {!evidence.length && !agentSources.length ? (
                <p className="text-sm text-muted-foreground">
                  No sources are available for this report.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
