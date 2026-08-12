import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentResultCard } from "@/components/research/agent-result-card";
import { PrivateResearch } from "@/components/research/private-research";
import { ResearchJobDetail } from "@/components/research/research-job-detail";
import { ResearchTabs } from "@/components/research/research-tabs";
import type {
  AgentResult,
  ResearchEvidenceReference,
  StockResearch,
} from "@/lib/research/types";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.stubGlobal("React", React);

const supportingEvidence: ResearchEvidenceReference = {
  id: "evidence-support",
  role: "SUPPORTING",
  sourceKind: "SEC_FACT",
  title: "Revenue fact",
  sourceReference: "sec-fact:revenue",
  sourceUrl: "https://www.sec.gov/example",
  accessionNumber: "0000000000-26-000001",
  section: "Revenue",
  sourceDate: "2026-06-30T00:00:00.000Z",
  retrievedAt: "2026-08-11T00:00:00.000Z",
  excerpt: "Reported revenue increased in the period.",
};

const counterEvidence: ResearchEvidenceReference = {
  ...supportingEvidence,
  id: "evidence-counter",
  role: "COUNTER",
  title: "Margin fact",
  sourceReference: "sec-fact:margin",
  excerpt: "Reported gross margin decreased in the period.",
};

const failedAgent: AgentResult = {
  agentName: "FINANCIALS",
  status: "FAILED",
  rating: "MIXED",
  confidence: 0.55,
  summary: "Revenue improved while margin evidence was incomplete.",
  findings: [],
  sources: [],
  warnings: ["The latest cash-flow fact was unavailable."],
  missingData: ["Current cash-flow statement"],
  provider: "openai",
  model: "gpt-test",
  agentVersion: "financials-v2",
  claims: [
    {
      category: "SUPPORTIVE",
      statement: "Revenue increased.",
      confidence: 0.72,
      evidenceIds: [supportingEvidence.id],
      counterEvidenceIds: [counterEvidence.id],
      assumptions: ["Reported facts are comparable."],
    },
  ],
};

const externalResearch: StockResearch = {
  jobId: "job-external",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  status: "COMPLETED",
  generatedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-09-10T00:00:00.000Z",
  generationMode: "EXTERNAL",
  agents: [failedAgent],
  report: {
    rating: "MIXED",
    overview: "Evidence-grounded overview.",
    bullCase: ["Revenue increased."],
    bearCase: ["Margins decreased."],
    risks: ["Evidence remains incomplete."],
    missingData: ["Current cash-flow statement"],
    confidence: 0.61,
    disagreements: ["Revenue and margin trends diverged."],
  },
  claims: [
    {
      id: "claim-1",
      claimKey: "revenue-growth",
      category: "SUPPORTIVE",
      statement: "Revenue increased while margin compressed.",
      confidence: 0.68,
      assumptions: ["SEC facts are period-comparable."],
      sourceDate: "2026-06-30T00:00:00.000Z",
      asOfDate: "2026-08-11T00:00:00.000Z",
      evidence: [supportingEvidence, counterEvidence],
    },
  ],
  metadata: {
    provider: "openai",
    model: "gpt-test",
    promptVersion: "prompt-v2",
    outputSchemaVersion: "schema-v2",
    retrievalVersion: "retrieval-v2",
    calculationVersion: "calculation-v1",
    sourceDataVersion: "source-v2",
    inputDataVersion: "input-v2",
    reportVersion: "report-v2",
    sourceSnapshotSha256: "abc123",
    inputTokens: 120,
    outputTokens: 45,
    estimatedCostUsd: 0.0023,
  },
};

describe("M18 research UI", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

  it("links each private history row to its owner-scoped report", () => {
    const markup = renderToStaticMarkup(
      <PrivateResearch
        jobs={[
          {
            id: "job-private",
            ticker: "AAPL",
            companyName: "Apple Inc.",
            status: "RUNNING",
            createdAt: "2026-08-11T00:00:00.000Z",
            generationMode: "EXTERNAL",
          },
        ]}
      />,
    );

    expect(markup).toContain('href="/app/research/job-private"');
    expect(markup).toContain("Open private report");
    expect(markup).toContain("AI-generated");
  });

  it("renders active and partial job states without a new-run control", () => {
    const activeMarkup = renderToStaticMarkup(
      <ResearchJobDetail
        initialJob={{
          id: "job-running",
          status: "RUNNING",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          createdAt: "2026-08-11T00:00:00.000Z",
          completedAt: null,
          research: null,
        }}
      />,
    );
    const partialMarkup = renderToStaticMarkup(
      <ResearchJobDetail
        initialJob={{
          id: "job-partial",
          status: "PARTIALLY_COMPLETED",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          createdAt: "2026-08-11T00:00:00.000Z",
          completedAt: null,
          research: null,
        }}
      />,
    );

    expect(activeMarkup).toContain("without queuing another run");
    expect(partialMarkup).toContain("will not start another billable run");
    expect(activeMarkup).not.toContain("Run research");
    expect(partialMarkup).not.toContain("Regenerate report");
  });

  it("summarizes report changes and links to the previous owner-scoped run", () => {
    const markup = renderToStaticMarkup(
      <ResearchJobDetail
        initialJob={{
          id: "job-current",
          status: "COMPLETED",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          generationMode: "EXTERNAL",
          createdAt: "2026-08-11T00:00:00.000Z",
          completedAt: "2026-08-11T00:05:00.000Z",
          research: externalResearch,
          comparison: {
            previousJobId: "job-previous",
            diff: {
              rating: {
                previous: "NEUTRAL",
                current: "MIXED",
                changed: true,
              },
              confidence: {
                previous: 0.5,
                current: 0.61,
                delta: 0.11,
                materiallyChanged: true,
              },
              newClaims: [],
              removedClaims: [],
              changedClaims: [],
              evidenceChanges: [],
              source: {
                previousSnapshotSha256: "old",
                currentSnapshotSha256: "new",
                snapshotChanged: true,
                previousDataVersion: "data-v1",
                currentDataVersion: "data-v2",
                dataChanged: true,
              },
              hasMaterialChanges: true,
            },
          },
        }}
      />,
    );

    expect(markup).toContain("Changes from previous report");
    expect(markup).toContain("Material changes");
    expect(markup).toContain("11 percentage points");
    expect(markup).toContain('href="/app/research/job-previous"');
    expect(markup).toContain("Regenerate report");
  });

  it("labels external reports and exposes claims, counter-evidence, versions, and cost", () => {
    const markup = renderToStaticMarkup(
      <ResearchTabs
        initialResearch={externalResearch}
        readOnly
        ticker="AAPL"
      />,
    );

    expect(markup).toContain("AI-generated");
    expect(markup).toContain("Claims and evidence");
    expect(markup).toContain("Counter-evidence");
    expect(markup).toContain("Margin fact");
    expect(markup).toContain("Report: report-v2");
    expect(markup).toContain("$0.0023");
    expect(markup).toContain("This report is partial");
    expect(markup).not.toContain("Regenerate report");
  });

  it("shows specialist claims, citations, missing information, and partial failure", () => {
    const markup = renderToStaticMarkup(
      <AgentResultCard
        evidence={[supportingEvidence, counterEvidence]}
        result={failedAgent}
      />,
    );

    expect(markup).toContain("Evidence-grounded claims");
    expect(markup).toContain("Revenue fact");
    expect(markup).toContain("Counter: Margin fact");
    expect(markup).toContain("Missing information");
    expect(markup).toContain("partial failure");
  });
});
