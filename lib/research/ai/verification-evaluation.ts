import {
  AI_OUTPUT_SCHEMA_VERSION,
  AI_PRICING_VERSION,
  AI_PROMPT_VERSION,
  AI_REPORT_VERSION,
  AI_RETRIEVAL_VERSION,
  AI_VERIFIER_MAX_OUTPUT_TOKENS,
  getAiResearchConfig,
} from "./config";
import { evaluateResearchOutput } from "./evaluation";
import {
  M33_EVALUATION_CASES,
  type VerificationEvaluationCase,
} from "./fixtures/m33-evaluation";
import {
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
  CURATED_AAPL_SNAPSHOT,
} from "./fixtures/curated-evaluation";
import { specialistPrompt, synthesisPrompt } from "./prompts";
import { runValidatedModelCall } from "./model-runner";
import { RecordedResearchModelProvider } from "./providers";
import {
  RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
  selectSpecialistEvidence,
  selectSynthesisEvidence,
} from "./retrieval";
import { SEC_DERIVED_METRICS_VERSION } from "@/lib/sec/derived-metrics";
import { SEC_FILING_SECTION_PARSER_VERSION } from "@/lib/sec/filing-sections";
import {
  claimKey,
  specialistModelOutputSchema,
  stableHash,
  validateGroundedOutput,
} from "./schemas";
import {
  applyClaimVerification,
  claimVerificationSchema,
  validateClaimVerification,
  verificationPrompt,
} from "./verification";

// Deliberately literal: version changes need an explicit new baseline decision.
// These repository regression floors implement M33's acceptance contract;
// they do not assert human approval to activate an external provider.
export const M33_EVALUATION_BASELINE = {
  versions: {
    prompt: "m33-research-v5",
    retrieval: "m32-structured-lexical-v3",
    outputSchema: "m30-claims-v2",
    report: "m33-report-v3",
    snapshot: "m32-public-evidence-snapshot-v4",
    model: "gpt-5.4-mini-2026-03-17",
    pricing: "openai-pricing-2026-08-24",
    calculation: "sec-derived-v1",
    filingParser: "sec-filing-sections-v1",
  },
  inputsSha256:
    "d592bf777897f1d2cf34d94c1bcf60fb37aab8b7559bd9852e40e196c6ddd533",
  thresholds: {
    caseCount: 8,
    passedCases: 8,
    retainedUnsupportedClaims: 0,
    verdictAccuracy: 1,
    citationCorrectness: 1,
    citationCompleteness: 1,
    numericalSupport: 1,
    missingDataHonesty: 1,
    preservedContradictions: 1,
    rejectedGuidance: 1,
  },
  humanActivationReviewRequired: true,
} as const;

function regressionInputs(cases: VerificationEvaluationCase[]) {
  const snapshot = CURATED_AAPL_SNAPSHOT;
  const specialists = Object.entries(AAPL_RECORDED_SPECIALIST_OUTPUTS).map(
    ([agentName, output]) => ({
      agentName: agentName as keyof typeof AAPL_RECORDED_SPECIALIST_OUTPUTS,
      output,
    }),
  );
  const common = {
    ticker: snapshot.stock.ticker,
    companyName: snapshot.stock.companyName,
    asOfDate: "2026-09-23",
  };
  const synthesisEvidence = selectSynthesisEvidence(snapshot, {
    specialistClaims: specialists.flatMap((item) => item.output.claims),
  });
  return {
    snapshotSha256: snapshot.sourceSnapshotSha256,
    inputDataVersion: snapshot.inputDataVersion,
    specialistPrompts: specialists.map(({ agentName }) => {
      const selection = selectSpecialistEvidence(snapshot, agentName);
      return specialistPrompt({
        ...common,
        agentName,
        evidence: [...selection.evidence],
        evidenceContext: selection.context,
      });
    }),
    synthesisPrompt: synthesisPrompt({
      ...common,
      specialists,
      evidence: [...synthesisEvidence.evidence],
      evidenceContext: synthesisEvidence.context,
    }),
    verificationPrompts: cases.map((item) =>
      verificationPrompt(item.output, item.evidence),
    ),
    cases,
  };
}

export async function runVerificationEvaluation(
  cases: VerificationEvaluationCase[] = M33_EVALUATION_CASES,
) {
  const config = getAiResearchConfig({
    NODE_ENV: "test",
    OPENAI_API_KEY: "recorded-only-no-network",
  } as NodeJS.ProcessEnv);
  const versions = {
    prompt: AI_PROMPT_VERSION,
    retrieval: AI_RETRIEVAL_VERSION,
    outputSchema: AI_OUTPUT_SCHEMA_VERSION,
    report: AI_REPORT_VERSION,
    snapshot: RESEARCH_EVIDENCE_SNAPSHOT_VERSION,
    model: config.model,
    pricing: AI_PRICING_VERSION,
    calculation: SEC_DERIVED_METRICS_VERSION,
    filingParser: SEC_FILING_SECTION_PARSER_VERSION,
  };
  const failures: string[] = [];
  const inputsSha256 = stableHash(regressionInputs(cases));
  if (inputsSha256 !== M33_EVALUATION_BASELINE.inputsSha256)
    failures.push(
      "Prompt, retrieval, evidence, or gold fixture inputs changed; review and record a new baseline.",
    );
  if (stableHash(versions) !== stableHash(M33_EVALUATION_BASELINE.versions))
    failures.push(
      "Version tuple has no approved repository regression baseline.",
    );
  if (cases.length !== M33_EVALUATION_BASELINE.thresholds.caseCount)
    failures.push("Case count changed; review the baseline denominators.");
  const results = [];
  let retainedUnsupportedClaims = 0;
  let preservedContradictions = 0;
  let rejectedGuidance = 0;
  let correctVerdicts = 0;
  let totalVerdicts = 0;
  for (const item of cases) {
    const issues: string[] = [];
    let rejected = false;
    try {
      validateGroundedOutput(item.output, item.evidence);
      if (item.specialist)
        validateGroundedOutput(
          specialistModelOutputSchema.parse(item.specialist),
          item.evidence,
        );
    } catch {
      rejected = true;
    }
    if (item.rejectBeforeVerification) {
      if (!rejected) issues.push("Prohibited guidance reached verification.");
      if (rejected) rejectedGuidance += 1;
      results.push({
        id: item.id,
        passed: issues.length === 0,
        rejectedBeforeVerification: rejected,
        issues,
      });
      failures.push(...issues.map((issue) => `${item.id}: ${issue}`));
      continue;
    }
    if (rejected) issues.push("An accepted fixture failed the M30 gate.");
    const provider = new RecordedResearchModelProvider({
      fixtures: [{ result: { output: item.recording } }],
    });
    try {
      const verified = await runValidatedModelCall({
        provider,
        config,
        schema: claimVerificationSchema,
        schemaName: "research_claim_verification_v1",
        validate: (value) => validateClaimVerification(value, item.output),
        maxAttempts: 1,
        maxOutputTokens: AI_VERIFIER_MAX_OUTPUT_TOKENS,
        prompt: () => verificationPrompt(item.output, item.evidence),
        userId: "offline-evaluation",
        researchJobId: item.id,
        operation: "CLAIM_VERIFICATION",
        idempotencyKey: item.id,
      });
      const actualStatuses = verified.output.results.map(
        (result) => result.status,
      );
      totalVerdicts += item.expectedStatuses.length;
      correctVerdicts += item.expectedStatuses.filter(
        (status, index) => status === actualStatuses[index],
      ).length;
      preservedContradictions += item.expectedStatuses.filter(
        (status, index) =>
          status === "CONTRADICTED" &&
          actualStatuses[index] === "CONTRADICTED" &&
          verified.output.results[index].contradictingEvidenceIds.every((id) =>
            item.evidence.some((source) => source.id === id),
          ),
      ).length;
      if (stableHash(actualStatuses) !== stableHash(item.expectedStatuses))
        issues.push("Verdict accuracy below 1.0.");
      const final = applyClaimVerification(item.output, verified.output);
      retainedUnsupportedClaims += item.output.claims.filter(
        (claim, index) =>
          item.expectedStatuses[index] === "UNSUPPORTED" &&
          final.claims.some(
            (retained) => claimKey(retained) === claimKey(claim),
          ),
      ).length;
      const expectedClaims = item.output.claims.filter((_, index) =>
        ["SUPPORTED", "PARTIALLY_SUPPORTED"].includes(
          item.expectedStatuses[index],
        ),
      );
      if (stableHash(final.claims) !== stableHash(expectedClaims))
        issues.push("Retained claims differ from the reviewed gold set.");
      const expectedMissing = [...item.output.missingData];
      const unsupported = item.expectedStatuses.filter(
        (status) => status === "UNSUPPORTED",
      ).length;
      if (unsupported)
        expectedMissing.unshift(
          `${unsupported} unsupported claim${unsupported === 1 ? " was" : "s were"} removed because the cited evidence did not establish the statement.`,
        );
      const evaluation = evaluateResearchOutput({
        id: item.id,
        output: final,
        evidence: item.evidence,
        latencyMs: 0,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
        expectations: {
          citationsByClaimKey: Object.fromEntries(
            expectedClaims.map((claim) => [
              claimKey(claim),
              {
                acceptableSupportingEvidenceIds: claim.evidenceIds,
                requiredSupportingEvidenceIds: claim.evidenceIds,
                acceptableCounterEvidenceIds: claim.counterEvidenceIds,
                requiredCounterEvidenceIds: claim.counterEvidenceIds,
              },
            ]),
          ),
          missingData: expectedMissing,
        },
      });
      if (
        !evaluation.schemaValid ||
        !evaluation.groundingValid ||
        !evaluation.noRecommendationValid
      )
        issues.push("Final output failed validation.");
      for (const metric of [
        "citationCorrectness",
        "citationCompleteness",
        "numericalSupport",
        "missingDataHonesty",
      ] as const) {
        const value = evaluation.metrics[metric];
        if (
          value !== null &&
          value < M33_EVALUATION_BASELINE.thresholds[metric]
        )
          issues.push(`${metric} below threshold.`);
      }
      if (evaluation.counts.unsupportedClaims !== 0)
        issues.push("Unsupported claim reached the report.");
      results.push({
        id: item.id,
        passed: issues.length === 0,
        verdicts: actualStatuses,
        retainedClaims: final.claims.length,
        metrics: evaluation.metrics,
        issues,
      });
    } catch {
      issues.push("Verifier response failed its contract.");
      results.push({ id: item.id, passed: false, issues });
    }
    failures.push(...issues.map((issue) => `${item.id}: ${issue}`));
  }
  const observed = {
    passedCases: results.filter((item) => item.passed).length,
    retainedUnsupportedClaims,
    preservedContradictions,
    rejectedGuidance,
    verdictAccuracy: totalVerdicts ? correctVerdicts / totalVerdicts : 0,
  };
  for (const key of Object.keys(observed) as Array<keyof typeof observed>) {
    if (observed[key] !== M33_EVALUATION_BASELINE.thresholds[key])
      failures.push(`${key} differs from the recorded threshold.`);
  }
  return {
    versions,
    inputsSha256,
    thresholds: M33_EVALUATION_BASELINE.thresholds,
    observed,
    humanActivationReviewRequired: true,
    providerCalls: "recorded only; no external calls or billing",
    passed: failures.length === 0,
    cases: results,
    failures,
  };
}
