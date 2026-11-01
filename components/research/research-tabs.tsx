"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RECENT_EVENTS_LABEL,
  type ResearchClaim,
  type ResearchEvidenceRecord,
  type StockResearch,
} from "@/lib/research/types";

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
  if (research.generationMode === "EXTERNAL") return "AI-assisted";
  return "Prebuilt sample";
}

function claimKindLabel(kind: ResearchClaim["kind"]) {
  if (kind === "FACT") return "reported fact";
  if (kind === "DERIVED") return "derived value";
  if (kind === "INTERPRETATION") return "interpretation";
  return null;
}

function claimSupportLabel(status: ResearchClaim["verificationStatus"]) {
  if (status === "PARTIALLY_SUPPORTED") return "Partially supported";
  if (status === "SUPPORTED") return "Supported by cited evidence";
  if (status === "CONTRADICTED") return "Conflicts with cited evidence";
  return "Unverified";
}

function labelPartialClaim(statement: string, research: StockResearch) {
  const claim = research.claims?.find((item) => item.statement === statement);
  return claim?.verificationStatus === "PARTIALLY_SUPPORTED"
    ? `Partially supported: ${statement}`
    : statement;
}

function earningsSessionLabel(marketSession: string | null) {
  if (marketSession === "BEFORE_MARKET") return " before market open";
  if (marketSession === "AFTER_MARKET") return " after market close";
  return "";
}

function generationDescription(research: StockResearch) {
  const date = new Date(research.generatedAt).toLocaleDateString("en-US");
  if (research.generationMode === "EXTERNAL") {
    return `AI-assisted report prepared ${date} from the cited sources. It may contain mistakes, omissions, or outdated information. Verify important information independently and do not rely on it as the sole basis for investment decisions.`;
  }
  if (research.generationMode === "RECORDED") {
    return `Prepared ${date} from a saved sample report.`;
  }
  return `Prepared ${date} for the read-only demo.`;
}

const TOPIC_NAMES: Record<string, string> = {
  FINANCIALS: "financial performance",
  COMPETITORS: "peer comparison",
  RISK: "risk review",
  NEWS: "recent events",
  POLITICAL_ACTIVITY: "political activity",
};

// A topic that exhausted its model attempts is stored as completed by the
// "partial-fallback" provider but has no findings; the same provider on the
// report means the combined summary step was unavailable.
const FALLBACK_PROVIDER = "partial-fallback";

function isAiGenerated(research: StockResearch) {
  return (
    research.generationMode === "EXTERNAL" ||
    research.generationMode === "RECORDED"
  );
}

function reportCompleteness(research: StockResearch) {
  const aiGenerated = isAiGenerated(research);
  const incompleteTopics = research.agents
    .filter(
      (agent) =>
        agent.agentName !== "SYNTHESIS" &&
        (agent.status === "FAILED" ||
          (aiGenerated && agent.provider === FALLBACK_PROVIDER)),
    )
    .map(
      (agent) =>
        TOPIC_NAMES[agent.agentName] ??
        agent.agentName.toLowerCase().replaceAll("_", " "),
    );
  const combinedSummaryUnavailable =
    aiGenerated && research.metadata?.provider === FALLBACK_PROVIDER;
  return {
    incompleteTopics,
    combinedSummaryUnavailable,
    partial: incompleteTopics.length > 0 || combinedSummaryUnavailable,
  };
}

// Process notes from the combined summary step. Reports generated before
// notes were separated also appended them to Risks, so they are removed there.
function reportNotes(research: StockResearch) {
  if (!isAiGenerated(research)) return [];
  return (
    research.agents.find((agent) => agent.agentName === "SYNTHESIS")
      ?.warnings ?? []
  );
}

function partialReportMessage(
  completeness: ReturnType<typeof reportCompleteness>,
) {
  const parts = ["This report is partial."];
  if (completeness.incompleteTopics.length) {
    parts.push(
      `The ${completeness.incompleteTopics.join(", ")} ${completeness.incompleteTopics.length === 1 ? "topic" : "topics"} could not be completed, so ${completeness.incompleteTopics.length === 1 ? "its" : "their"} findings are missing.`,
    );
  }
  if (completeness.combinedSummaryUnavailable) {
    parts.push(
      "The combined summary step was unavailable, so the topic findings are listed without a combined interpretation.",
    );
  }
  return parts.join(" ");
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

  const kindLabel = claimKindLabel(claim.kind);

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{claim.category.toLowerCase()}</Badge>
        <Badge variant="secondary">
          {claimSupportLabel(claim.verificationStatus)}
        </Badge>
        {kindLabel ? (
          <Badge
            variant={claim.kind === "INTERPRETATION" ? "secondary" : "default"}
          >
            {kindLabel}
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          As of {formatDate(claim.asOfDate) ?? claim.asOfDate}
          {" · "}
          {Math.round(claim.confidence * 100)}% reported confidence
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

function ReportListSection({
  emptyMessage,
  items,
  title,
}: {
  emptyMessage: string;
  items: string[];
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={3} role="heading">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {items.map((item, index) => (
              <li className="flex gap-2" key={`${item}-${index}`}>
                <span aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}

function WhatToWatch({ research }: { research: StockResearch }) {
  const earnings = research.report.upcomingEarnings;
  const groups = [
    {
      label: RECENT_EVENTS_LABEL,
      items: (research.report.recentEvents ?? []).map(
        (event) =>
          `${formatDate(event.filingDate) ?? event.filingDate} (Form ${event.formType}): ${labelPartialClaim(event.statement, research)}`,
      ),
    },
    {
      label: "What would change this analysis",
      items: research.report.whatWouldChange ?? [],
    },
    {
      label: "Upcoming earnings",
      items: earnings
        ? [
            `An earnings event is recorded for ${formatDate(earnings.eventDate) ?? earnings.eventDate}${earningsSessionLabel(earnings.marketSession)}. The date comes from a third-party calendar and may change.`,
          ]
        : [],
    },
    {
      label: "Counterpoints",
      items: research.report.bearCase.map((item) =>
        labelPartialClaim(item, research),
      ),
    },
    { label: "Missing information", items: research.report.missingData },
    {
      label: "Areas of disagreement",
      items: research.report.disagreements ?? [],
    },
  ].filter((group) => group.items.length);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle aria-level={3} role="heading">
          What to Watch
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <section key={group.label}>
                <h4 className="text-sm font-medium">{group.label}</h4>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {group.items.map((item, index) => (
                    <li className="flex gap-2" key={`${item}-${index}`}>
                      <span aria-hidden>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No additional items were identified from the available evidence.
          </p>
        )}
        {research.report.contradictedClaims?.length ? (
          <section className="mt-5 space-y-4">
            <h4 className="text-sm font-medium">
              Claims with conflicting evidence
            </h4>
            {research.report.contradictedClaims.map((claim) => (
              <article className="rounded-lg border p-4 text-sm" key={claim.id}>
                <p className="font-medium">
                  Draft claim — not retained as a finding
                </p>
                <p className="mt-2">{claim.statement}</p>
                <p className="mt-3 font-medium">Conflicting cited evidence</p>
                {claim.evidence
                  .filter((item) =>
                    claim.contradictingEvidenceIds?.includes(item.id),
                  )
                  .map((item) => (
                    <blockquote
                      className="mt-2 border-l-2 pl-3 text-muted-foreground"
                      key={item.id}
                    >
                      <p>{item.excerpt}</p>
                      <cite className="mt-1 block not-italic">
                        {safeSourceUrl(item.sourceUrl) ? (
                          <a
                            className="underline"
                            href={safeSourceUrl(item.sourceUrl)!}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {item.title}
                          </a>
                        ) : (
                          item.title
                        )}
                        {item.accessionNumber
                          ? ` · ${item.accessionNumber}`
                          : ""}
                      </cite>
                    </blockquote>
                  ))}
              </article>
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReportSummary({ research }: { research: StockResearch }) {
  const report = research.report;
  const coverage = report.evidenceCoverage ?? null;
  const completeness = reportCompleteness(research);
  const notes = reportNotes(research);
  const risks = report.risks.filter((item) => !notes.includes(item));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle aria-level={3} role="heading">
              Summary
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              {completeness.partial ? (
                <Badge variant="outline">Partial analysis</Badge>
              ) : null}
              {coverage ? (
                <Badge variant="secondary">
                  Evidence coverage {Math.round(coverage.score * 100)}%
                </Badge>
              ) : null}
            </div>
          </div>
          {coverage ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Newest filing{" "}
              {coverage.newestFilingDate
                ? formatDate(coverage.newestFilingDate)
                : "date unavailable"}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="leading-7 text-muted-foreground">{report.overview}</p>
          {notes.length ? (
            <ul
              aria-label="Report notes"
              className="mt-3 space-y-1 text-sm text-muted-foreground"
            >
              {notes.map((note, index) => (
                <li key={`${note}-${index}`}>{note}</li>
              ))}
            </ul>
          ) : null}
          {research.generationMode === "EXTERNAL" ||
          research.generationMode === "RECORDED" ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {report.verificationCompleted
                ? "Claim support was checked against cited evidence. This automated check does not replace human source review."
                : "Claim support is unverified. Check the cited sources independently."}
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {generationDescription(research)}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Research context only—not investment advice or a buy, sell, or hold
            recommendation.
          </p>
        </CardContent>
      </Card>

      {completeness.partial ? (
        <div
          className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 lg:col-span-2"
          role="status"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          {partialReportMessage(completeness)}
        </div>
      ) : null}

      <ReportListSection
        emptyMessage="No strengths were identified from the available evidence."
        items={report.bullCase.map((item) => labelPartialClaim(item, research))}
        title="Strengths"
      />
      <ReportListSection
        emptyMessage="No specific risks were identified from the available evidence."
        items={risks.map((item) => labelPartialClaim(item, research))}
        title="Risks"
      />
      <WhatToWatch research={research} />
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
          <h2 className="mt-4 text-lg font-semibold">
            Sample research is unavailable
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            The public demo is read-only and cannot start a research job. Try
            another company to inspect an available sample report.
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
          <h2 className="mt-4 text-lg font-semibold">
            Research has not been generated
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Start a new research report using the available company information
            and sources.
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
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const evidenceDisclosure = useRef<HTMLDetailsElement>(null);
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
  const evidenceReferences = new Set(
    evidence.map((reference) => reference.sourceReference),
  );
  const additionalSourcesByReference = new Map<
    string,
    StockResearch["agents"][number]["sources"][number]
  >();
  for (const agent of research.agents) {
    if (agent.agentName === "SYNTHESIS") continue;
    for (const source of agent.sources) {
      if (
        !evidenceReferences.has(source.reference) &&
        !additionalSourcesByReference.has(source.reference)
      ) {
        additionalSourcesByReference.set(source.reference, source);
      }
    }
  }
  const additionalSources = [...additionalSourcesByReference.values()];
  const isAiGenerated = research.generationMode === "EXTERNAL";

  useEffect(() => {
    if (!evidenceTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(evidenceAnchor(evidenceTarget));
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setEvidenceTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [evidenceTarget]);

  function selectEvidence(evidenceId: string) {
    if (evidenceDisclosure.current) {
      evidenceDisclosure.current.open = true;
    }
    setEvidenceTarget(evidenceId);
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
            <h2 className="font-medium">Stock research report</h2>
            <Badge variant={isAiGenerated ? "default" : "secondary"}>
              {generationLabel(research)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the summary, strengths, risks, what to watch, and supporting
            sources.
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
      <ReportSummary research={research} />
      <details
        className="rounded-xl bg-card ring-1 ring-foreground/10"
        ref={evidenceDisclosure}
      >
        <summary className="cursor-pointer rounded-xl px-4 py-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Evidence / Sources
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {evidence.length + additionalSources.length} source
            {evidence.length + additionalSources.length === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="space-y-6 border-t p-4">
          <p className="text-sm leading-6 text-muted-foreground">
            Review the claims and original source details supporting this
            report. Important claims should be checked against the linked source
            before relying on them.
          </p>
          {research.claims?.length ? (
            <section>
              <h3 className="text-sm font-semibold">
                Claims and supporting evidence
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {research.claims.map((claim) => (
                  <ClaimCard
                    claim={claim}
                    key={claim.id}
                    onEvidenceSelect={selectEvidence}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {evidence.length ? (
            <section>
              <h3 className="text-sm font-semibold">Source details</h3>
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
          {additionalSources.length ? (
            <section>
              <h3 className="text-sm font-semibold">Additional sources</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {additionalSources.map((source) => (
                  <article
                    className="rounded-lg border p-4"
                    key={source.reference}
                  >
                    <div className="flex items-start gap-2">
                      <BookOpen
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0"
                      />
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
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {!evidence.length && !additionalSources.length ? (
            <p className="text-sm text-muted-foreground">
              No sources are available for this report.
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
