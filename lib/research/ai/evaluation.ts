import {
  claimKey,
  researchEvidenceSchema,
  synthesisModelOutputSchema,
  validateGroundedOutput,
  type ModelClaim,
  type ResearchEvidence,
  type SynthesisModelOutput,
} from "@/lib/research/ai/schemas";

export type EvaluationUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type ClaimCitationExpectation = {
  acceptableSupportingEvidenceIds: string[];
  acceptableCounterEvidenceIds?: string[];
  requiredSupportingEvidenceIds?: string[];
  requiredCounterEvidenceIds?: string[];
};

export type ResearchEvaluationExpectations = {
  citationsByClaimKey?: Record<string, ClaimCitationExpectation>;
  missingData?: string[];
  contradictionEvidencePairs?: Array<{
    supportingEvidenceId: string;
    counterEvidenceId: string;
  }>;
};

export type ResearchEvaluationCase = {
  id: string;
  output: unknown;
  evidence: unknown[];
  expectations?: ResearchEvaluationExpectations;
  latencyMs: number;
  usage: EvaluationUsage;
};

export type ResearchEvaluationMetrics = {
  citationCorrectness: number | null;
  citationCompleteness: number | null;
  unsupportedClaimRate: number | null;
  numericalSupport: number | null;
  missingDataHonesty: number | null;
  contradictionIndicator: boolean;
  contradictionPreserved: boolean | null;
};

export type ResearchEvaluationResult = {
  id: string;
  schemaValid: boolean;
  evidenceSchemaValid: boolean;
  noRecommendationValid: boolean;
  groundingValid: boolean;
  metrics: ResearchEvaluationMetrics;
  counts: {
    claims: number;
    citations: number;
    unsupportedClaims: number;
    numericalClaims: number;
    numericallySupportedClaims: number;
  };
  latencyMs: number;
  usage: EvaluationUsage & { totalTokens: number };
  issues: string[];
};

export type ResearchEvaluationSummary = {
  cases: ResearchEvaluationResult[];
  aggregate: {
    caseCount: number;
    schemaValidityRate: number | null;
    evidenceSchemaValidityRate: number | null;
    noRecommendationValidityRate: number | null;
    groundingValidityRate: number | null;
    citationCorrectness: number | null;
    citationCompleteness: number | null;
    unsupportedClaimRate: number | null;
    numericalSupport: number | null;
    missingDataHonesty: number | null;
    contradictionRate: number | null;
    contradictionPreservationRate: number | null;
    averageLatencyMs: number | null;
    totalInputTokens: number;
    totalCachedInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCostUsd: number;
  };
};

const forbiddenRecommendation = /\b(?:buy|sell|hold)\b/i;
const NUMBER_PATTERN =
  /[-+]?(?:[$€£])?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|thousand|million|billion|trillion|k|m|bn|b|tn))?/gi;

function round(value: number, places = 6) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : round(numerator / denominator);
}

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function formatIssues(
  prefix: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
    return `${prefix}${path}: ${issue.message}`;
  });
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function textSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (normalizedLeft === normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;

  const leftTokens = new Set(normalizedLeft.split(" "));
  const rightTokens = new Set(normalizedRight.split(" "));
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function matchesExpectedText(actual: string, expected: string) {
  const actualNormalized = normalizeText(actual);
  const expectedNormalized = normalizeText(expected);
  return (
    actualNormalized.includes(expectedNormalized) ||
    expectedNormalized.includes(actualNormalized) ||
    textSimilarity(actual, expected) >= 0.5
  );
}

function missingDataHonesty(actual: string[], expected: string[] | undefined) {
  if (expected === undefined) return null;
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;

  const expectedMatches = expected.filter((item) =>
    actual.some((candidate) => matchesExpectedText(candidate, item)),
  ).length;
  const actualMatches = actual.filter((item) =>
    expected.some((candidate) => matchesExpectedText(item, candidate)),
  ).length;
  const precision = actual.length === 0 ? 0 : actualMatches / actual.length;
  const recall = expectedMatches / expected.length;
  return precision + recall === 0
    ? 0
    : round((2 * precision * recall) / (precision + recall));
}

function canonicalUnit(raw: string) {
  const value = raw.toLowerCase().replaceAll(/\s+/g, "");
  if (value.endsWith("%") || value.endsWith("percent")) return "%";
  if (value.endsWith("thousand") || value.endsWith("k")) return "thousand";
  if (value.endsWith("million") || value.endsWith("m")) return "million";
  if (
    value.endsWith("billion") ||
    value.endsWith("bn") ||
    value.endsWith("b")
  ) {
    return "billion";
  }
  if (value.endsWith("trillion") || value.endsWith("tn")) return "trillion";
  return "";
}

function numericTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of value.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const numeric = raw
      .replaceAll(/[$€£,]/g, "")
      .match(/[-+]?\d+(?:\.\d+)?/)?.[0];
    if (!numeric) continue;
    const number = Number(numeric);
    if (!Number.isFinite(number)) continue;
    tokens.add(`${number}${canonicalUnit(raw)}`);
  }
  return tokens;
}

function numericalClaimSupported(
  claim: ModelClaim,
  evidenceById: Map<string, ResearchEvidence>,
) {
  const claimNumbers = numericTokens(claim.statement);
  if (claimNumbers.size === 0) return null;

  const citedNumbers = new Set<string>();
  for (const evidenceId of claim.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) continue;
    for (const token of numericTokens(evidence.excerpt))
      citedNumbers.add(token);
  }
  return [...claimNumbers].every((token) => citedNumbers.has(token));
}

function expectedCitationSets(expectation: ClaimCitationExpectation) {
  const supporting = new Set([
    ...expectation.acceptableSupportingEvidenceIds,
    ...(expectation.requiredSupportingEvidenceIds ?? []),
  ]);
  const counter = new Set([
    ...(expectation.acceptableCounterEvidenceIds ?? []),
    ...(expectation.requiredCounterEvidenceIds ?? []),
  ]);
  return { supporting, counter };
}

function citationMetrics(
  output: SynthesisModelOutput,
  evidenceById: Map<string, ResearchEvidence>,
  expectations: ResearchEvaluationExpectations | undefined,
) {
  const citationsByClaimKey = expectations?.citationsByClaimKey;
  let citationCount = 0;
  let correctCitations = 0;
  let unsupportedClaims = 0;

  for (const claim of output.claims) {
    const expectation = citationsByClaimKey?.[claimKey(claim)];
    const expected = expectation ? expectedCitationSets(expectation) : null;
    let validSupportingCitation = false;

    for (const evidenceId of claim.evidenceIds) {
      citationCount += 1;
      const correct = expected
        ? expected.supporting.has(evidenceId)
        : evidenceById.has(evidenceId);
      if (correct) {
        correctCitations += 1;
        validSupportingCitation = true;
      }
    }
    for (const evidenceId of claim.counterEvidenceIds) {
      citationCount += 1;
      const correct = expected
        ? expected.counter.has(evidenceId)
        : evidenceById.has(evidenceId);
      if (correct) correctCitations += 1;
    }

    if (!validSupportingCitation) unsupportedClaims += 1;
  }

  let citationCompleteness: number | null;
  const expectationEntries = Object.entries(citationsByClaimKey ?? {});
  if (expectationEntries.length > 0) {
    const claimsByKey = new Map(
      output.claims.map((claim) => [claimKey(claim), claim]),
    );
    let required = 0;
    let present = 0;
    for (const [key, expectation] of expectationEntries) {
      const claim = claimsByKey.get(key);
      const requiredSupporting =
        expectation.requiredSupportingEvidenceIds ??
        expectation.acceptableSupportingEvidenceIds;
      const requiredCounter =
        expectation.requiredCounterEvidenceIds ??
        expectation.acceptableCounterEvidenceIds ??
        [];
      for (const evidenceId of requiredSupporting) {
        required += 1;
        if (claim?.evidenceIds.includes(evidenceId)) present += 1;
      }
      for (const evidenceId of requiredCounter) {
        required += 1;
        if (claim?.counterEvidenceIds.includes(evidenceId)) present += 1;
      }
    }
    citationCompleteness = ratio(present, required);
  } else {
    const supportedClaims = output.claims.filter((claim) =>
      claim.evidenceIds.some((id) => evidenceById.has(id)),
    ).length;
    citationCompleteness = ratio(supportedClaims, output.claims.length);
  }

  return {
    citationCount,
    unsupportedClaims,
    citationCorrectness: ratio(correctCitations, citationCount),
    citationCompleteness,
    unsupportedClaimRate:
      output.claims.length === 0
        ? 0
        : round(unsupportedClaims / output.claims.length),
  };
}

function contradictionMetrics(
  output: SynthesisModelOutput,
  expectations: ResearchEvaluationExpectations | undefined,
) {
  const supporting = new Set(
    output.claims.flatMap((claim) => claim.evidenceIds),
  );
  const counter = new Set(
    output.claims.flatMap((claim) => claim.counterEvidenceIds),
  );
  const pairs = expectations?.contradictionEvidencePairs ?? [];
  const expectedContradiction = pairs.length > 0;
  const observedCounterEvidence = counter.size > 0;
  const explicitDisagreement = output.disagreements.length > 0;
  const contradictionIndicator =
    expectedContradiction || observedCounterEvidence || explicitDisagreement;

  if (!contradictionIndicator) {
    return { contradictionIndicator: false, contradictionPreserved: null };
  }

  const preservedPair = pairs.some(
    (pair) =>
      supporting.has(pair.supportingEvidenceId) &&
      counter.has(pair.counterEvidenceId),
  );
  return {
    contradictionIndicator: true,
    contradictionPreserved:
      pairs.length === 0
        ? observedCounterEvidence || explicitDisagreement
        : preservedPair || explicitDisagreement,
  };
}

export function evaluateResearchOutput(
  input: ResearchEvaluationCase,
): ResearchEvaluationResult {
  const issues: string[] = [];
  const parsedOutput = synthesisModelOutputSchema.safeParse(input.output);
  const parsedEvidence = researchEvidenceSchema
    .array()
    .safeParse(input.evidence);
  if (!parsedOutput.success) {
    issues.push(...formatIssues("output", parsedOutput.error.issues));
  }
  if (!parsedEvidence.success) {
    issues.push(...formatIssues("evidence", parsedEvidence.error.issues));
  }

  const noRecommendationValid = !forbiddenRecommendation.test(
    safeSerialize(input.output),
  );
  if (!noRecommendationValid) {
    issues.push("output: prohibited buy, sell, or hold language was present.");
  }

  let groundingValid = false;
  if (parsedOutput.success && parsedEvidence.success) {
    try {
      validateGroundedOutput(parsedOutput.data, parsedEvidence.data);
      groundingValid = true;
    } catch (error) {
      issues.push(
        `grounding: ${error instanceof Error ? error.message : "validation failed."}`,
      );
    }
  }

  const output = parsedOutput.success ? parsedOutput.data : null;
  const evidence = parsedEvidence.success ? parsedEvidence.data : [];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const citations = output
    ? citationMetrics(output, evidenceById, input.expectations)
    : {
        citationCount: 0,
        unsupportedClaims: 0,
        citationCorrectness: null,
        citationCompleteness: null,
        unsupportedClaimRate: null,
      };
  const numericalResults = output
    ? output.claims
        .map((claim) => numericalClaimSupported(claim, evidenceById))
        .filter((result): result is boolean => result !== null)
    : [];
  const numericallySupportedClaims = numericalResults.filter(Boolean).length;
  const contradiction = output
    ? contradictionMetrics(output, input.expectations)
    : { contradictionIndicator: false, contradictionPreserved: null };

  return {
    id: input.id,
    schemaValid: parsedOutput.success,
    evidenceSchemaValid: parsedEvidence.success,
    noRecommendationValid,
    groundingValid,
    metrics: {
      citationCorrectness: citations.citationCorrectness,
      citationCompleteness: citations.citationCompleteness,
      unsupportedClaimRate: citations.unsupportedClaimRate,
      numericalSupport: ratio(
        numericallySupportedClaims,
        numericalResults.length,
      ),
      missingDataHonesty: output
        ? missingDataHonesty(
            output.missingData,
            input.expectations?.missingData,
          )
        : null,
      ...contradiction,
    },
    counts: {
      claims: output?.claims.length ?? 0,
      citations: citations.citationCount,
      unsupportedClaims: citations.unsupportedClaims,
      numericalClaims: numericalResults.length,
      numericallySupportedClaims,
    },
    latencyMs: input.latencyMs,
    usage: {
      ...input.usage,
      totalTokens: input.usage.inputTokens + input.usage.outputTokens,
    },
    issues,
  };
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

function booleanRate(values: boolean[]) {
  return values.length === 0
    ? null
    : round(values.filter(Boolean).length / values.length);
}

export function evaluateResearchDataset(
  evaluationCases: ResearchEvaluationCase[],
): ResearchEvaluationSummary {
  const cases = evaluationCases.map(evaluateResearchOutput);
  const contradictionCases = cases.filter(
    (item) => item.metrics.contradictionIndicator,
  );

  return {
    cases,
    aggregate: {
      caseCount: cases.length,
      schemaValidityRate: booleanRate(cases.map((item) => item.schemaValid)),
      evidenceSchemaValidityRate: booleanRate(
        cases.map((item) => item.evidenceSchemaValid),
      ),
      noRecommendationValidityRate: booleanRate(
        cases.map((item) => item.noRecommendationValid),
      ),
      groundingValidityRate: booleanRate(
        cases.map((item) => item.groundingValid),
      ),
      citationCorrectness: average(
        cases.map((item) => item.metrics.citationCorrectness),
      ),
      citationCompleteness: average(
        cases.map((item) => item.metrics.citationCompleteness),
      ),
      unsupportedClaimRate: average(
        cases.map((item) => item.metrics.unsupportedClaimRate),
      ),
      numericalSupport: average(
        cases.map((item) => item.metrics.numericalSupport),
      ),
      missingDataHonesty: average(
        cases.map((item) => item.metrics.missingDataHonesty),
      ),
      contradictionRate: booleanRate(
        cases.map((item) => item.metrics.contradictionIndicator),
      ),
      contradictionPreservationRate: booleanRate(
        contradictionCases
          .map((item) => item.metrics.contradictionPreserved)
          .filter((value): value is boolean => value !== null),
      ),
      averageLatencyMs: average(cases.map((item) => item.latencyMs)),
      totalInputTokens: cases.reduce(
        (sum, item) => sum + item.usage.inputTokens,
        0,
      ),
      totalCachedInputTokens: cases.reduce(
        (sum, item) => sum + item.usage.cachedInputTokens,
        0,
      ),
      totalOutputTokens: cases.reduce(
        (sum, item) => sum + item.usage.outputTokens,
        0,
      ),
      totalEstimatedCostUsd: round(
        cases.reduce((sum, item) => sum + item.usage.estimatedCostUsd, 0),
      ),
    },
  };
}
