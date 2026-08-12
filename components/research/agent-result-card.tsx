import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CircleHelp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentResult, ResearchEvidenceRecord } from "@/lib/research/types";

const agentLabels: Record<AgentResult["agentName"], string> = {
  NEWS: "News Agent",
  FINANCIALS: "Financials Agent",
  COMPETITORS: "Competitors Agent",
  POLITICAL_ACTIVITY: "Political Activity Agent",
  RISK: "Risk Agent",
  SYNTHESIS: "Synthesis",
};

function ClaimCitation({
  evidence,
  evidenceId,
  onEvidenceSelect,
  role,
}: {
  evidence: Map<string, ResearchEvidenceRecord>;
  evidenceId: string;
  onEvidenceSelect?: (evidenceId: string) => void;
  role: "supporting" | "counter";
}) {
  const reference = evidence.get(evidenceId);

  return reference && onEvidenceSelect ? (
    <button
      className="rounded-md border px-2 py-1 text-xs underline-offset-2 hover:underline"
      onClick={() => onEvidenceSelect(reference.id)}
      type="button"
    >
      {role === "counter" ? "Counter: " : ""}
      {reference.title}
    </button>
  ) : reference ? (
    <span className="rounded-md border px-2 py-1 text-xs">
      {role === "counter" ? "Counter: " : ""}
      {reference.title}
    </span>
  ) : (
    <span className="rounded-md border px-2 py-1 font-mono text-xs text-muted-foreground">
      {role === "counter" ? "counter:" : "source:"}
      {evidenceId}
    </span>
  );
}

export function AgentResultCard({
  evidence = [],
  onEvidenceSelect,
  result,
}: {
  evidence?: ResearchEvidenceRecord[];
  onEvidenceSelect?: (evidenceId: string) => void;
  result: AgentResult;
}) {
  const evidenceById = new Map(
    evidence.map((reference) => [reference.id, reference]),
  );
  const findings = result.findings ?? [];
  const sources = result.sources ?? [];
  const warnings = result.warnings ?? [];
  const claims = result.claims ?? [];
  const missingData = result.missingData ?? [];

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{agentLabels[result.agentName]}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {result.status === "FAILED" ? (
              <Badge variant="destructive">partial failure</Badge>
            ) : null}
            <Badge variant="outline">{result.rating.toLowerCase()}</Badge>
            <Badge variant="secondary">
              {Math.round(result.confidence * 100)}% confidence
            </Badge>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {result.summary || "This specialist did not return a summary."}
        </p>
        {result.provider || result.model || result.agentVersion ? (
          <p className="text-xs text-muted-foreground">
            {[result.provider, result.model, result.agentVersion]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {claims.length ? (
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence-grounded claims
              </p>
              <div className="space-y-3">
                {claims.map((claim, index) => (
                  <article
                    className="rounded-lg border bg-muted/20 p-4"
                    key={`${claim.statement}-${index}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {claim.category.toLowerCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(claim.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6">{claim.statement}</p>
                    {claim.evidenceIds.length ||
                    claim.counterEvidenceIds.length ? (
                      <div
                        aria-label="Claim citations"
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        {claim.evidenceIds.map((id) => (
                          <ClaimCitation
                            evidence={evidenceById}
                            evidenceId={id}
                            key={`support-${id}`}
                            onEvidenceSelect={onEvidenceSelect}
                            role="supporting"
                          />
                        ))}
                        {claim.counterEvidenceIds.map((id) => (
                          <ClaimCitation
                            evidence={evidenceById}
                            evidenceId={id}
                            key={`counter-${id}`}
                            onEvidenceSelect={onEvidenceSelect}
                            role="counter"
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                        No evidence citation was returned for this claim.
                      </p>
                    )}
                    {claim.assumptions.length ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Assumptions: {claim.assumptions.join("; ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Findings
            </p>
            {findings.length ? (
              <div className="space-y-3">
                {findings.map((finding, index) => (
                  <div
                    className="rounded-lg border bg-muted/20 p-4"
                    key={`${finding.label}-${index}`}
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                      <div>
                        <p className="font-medium">{finding.label}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {finding.detail}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No findings are available for this specialist.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            {sources.length ? (
              sources.map((source) => (
                <div
                  className="mb-3 rounded-lg border p-4"
                  key={source.reference}
                >
                  <div className="flex items-start gap-2">
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
              ))
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No source is available. This gap is included in synthesis
                confidence.
              </p>
            )}
          </section>

          {missingData.length ? (
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Missing information
              </p>
              <div className="space-y-2">
                {missingData.map((item) => (
                  <div
                    className="flex gap-2 rounded-lg border p-3 text-sm text-muted-foreground"
                    key={item}
                  >
                    <CircleHelp className="mt-0.5 size-4 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {warnings.length ? (
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Warnings
              </p>
              <div className="space-y-2">
                {warnings.map((warning) => (
                  <div
                    className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                    key={warning}
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
