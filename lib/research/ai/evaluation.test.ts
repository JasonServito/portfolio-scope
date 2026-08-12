import { describe, expect, it } from "vitest";

import {
  evaluateResearchDataset,
  evaluateResearchOutput,
} from "@/lib/research/ai/evaluation";
import { CURATED_EVALUATION_CASES } from "@/lib/research/ai/fixtures/curated-evaluation";

describe("offline research evaluation", () => {
  it("scores a grounded curated report across evidence and safety metrics", () => {
    const result = evaluateResearchOutput(CURATED_EVALUATION_CASES[0]);

    expect(result).toMatchObject({
      id: "grounded-example",
      schemaValid: true,
      evidenceSchemaValid: true,
      noRecommendationValid: true,
      groundingValid: true,
      metrics: {
        citationCorrectness: 1,
        citationCompleteness: 1,
        unsupportedClaimRate: 0,
        numericalSupport: 1,
        missingDataHonesty: 1,
        contradictionIndicator: true,
        contradictionPreserved: true,
      },
      counts: {
        claims: 2,
        citations: 3,
        unsupportedClaims: 0,
        numericalClaims: 2,
        numericallySupportedClaims: 2,
      },
      latencyMs: 840,
      usage: {
        inputTokens: 1_200,
        cachedInputTokens: 200,
        outputTokens: 320,
        totalTokens: 1_520,
        estimatedCostUsd: 0.0011,
      },
      issues: [],
    });
  });

  it("measures curated unsupported citations, numbers, omissions, and advice", () => {
    const result = evaluateResearchOutput(CURATED_EVALUATION_CASES[1]);

    expect(result.schemaValid).toBe(true);
    expect(result.evidenceSchemaValid).toBe(true);
    expect(result.noRecommendationValid).toBe(false);
    expect(result.groundingValid).toBe(false);
    expect(result.metrics).toEqual({
      citationCorrectness: 0,
      citationCompleteness: 0,
      unsupportedClaimRate: 1,
      numericalSupport: 0,
      missingDataHonesty: 0,
      contradictionIndicator: true,
      contradictionPreserved: false,
    });
    expect(result.counts).toMatchObject({
      claims: 1,
      unsupportedClaims: 1,
      numericalClaims: 1,
      numericallySupportedClaims: 0,
    });
    expect(result.issues.join(" ")).toMatch(/prohibited|buy, sell, or hold/i);
  });

  it("fails malformed boundaries explicitly without manufacturing scores", () => {
    const result = evaluateResearchOutput({
      id: "malformed",
      output: { summary: "Hold this position." },
      evidence: [{}],
      latencyMs: 10,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      },
    });

    expect(result).toMatchObject({
      schemaValid: false,
      evidenceSchemaValid: false,
      noRecommendationValid: false,
      groundingValid: false,
      metrics: {
        citationCorrectness: null,
        citationCompleteness: null,
        unsupportedClaimRate: null,
        numericalSupport: null,
        missingDataHonesty: null,
        contradictionIndicator: false,
        contradictionPreserved: null,
      },
    });
    expect(result.issues.length).toBeGreaterThan(2);
  });

  it("aggregates quality, latency, token, and estimated-cost diagnostics", () => {
    const summary = evaluateResearchDataset(CURATED_EVALUATION_CASES);

    expect(summary.aggregate).toEqual({
      caseCount: 2,
      schemaValidityRate: 1,
      evidenceSchemaValidityRate: 1,
      noRecommendationValidityRate: 0.5,
      groundingValidityRate: 0.5,
      citationCorrectness: 0.5,
      citationCompleteness: 0.5,
      unsupportedClaimRate: 0.5,
      numericalSupport: 0.5,
      missingDataHonesty: 0.5,
      contradictionRate: 1,
      contradictionPreservationRate: 0.5,
      averageLatencyMs: 730,
      totalInputTokens: 2_100,
      totalCachedInputTokens: 200,
      totalOutputTokens: 500,
      totalEstimatedCostUsd: 0.0017,
    });
  });

  it("returns null aggregate rates for an empty evaluation set", () => {
    expect(evaluateResearchDataset([]).aggregate).toMatchObject({
      caseCount: 0,
      schemaValidityRate: null,
      citationCorrectness: null,
      averageLatencyMs: null,
      totalInputTokens: 0,
      totalEstimatedCostUsd: 0,
    });
  });
});
