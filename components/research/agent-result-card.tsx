import { AlertTriangle, BookOpen, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentResult } from "@/lib/research/types";

const agentLabels: Record<AgentResult["agentName"], string> = {
  NEWS: "News Agent",
  FINANCIALS: "Financials Agent",
  COMPETITORS: "Competitors Agent",
  POLITICAL_ACTIVITY: "Political Activity Agent",
  RISK: "Risk Agent",
  SYNTHESIS: "Synthesis",
};

export function AgentResultCard({ result }: { result: AgentResult }) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{agentLabels[result.agentName]}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{result.rating.toLowerCase()}</Badge>
            <Badge variant="secondary">
              {Math.round(result.confidence * 100)}% confidence
            </Badge>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {result.summary}
        </p>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Findings
          </p>
          {result.findings.length ? (
            <div className="space-y-3">
              {result.findings.map((finding, index) => (
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
              No findings are available in the seeded dataset.
            </p>
          )}
        </div>
        <div className="space-y-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            {result.sources.length ? (
              result.sources.map((source) => (
                <div
                  className="mb-3 rounded-lg border p-4"
                  key={source.reference}
                >
                  <div className="flex items-start gap-2">
                    <BookOpen className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-medium">{source.title}</p>
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
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
          </div>
          {result.warnings.length ? (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Warnings
              </p>
              <div className="space-y-2">
                {result.warnings.map((warning) => (
                  <div
                    className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                    key={warning}
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
