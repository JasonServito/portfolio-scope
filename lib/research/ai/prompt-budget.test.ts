import { describe, expect, it } from "vitest";

import { calculateAiCostUsd } from "@/lib/research/ai/budget";
import {
  AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
  AI_HARD_MAX_COST_PER_JOB_USD,
  AI_HARD_MAX_TOKENS_PER_JOB,
  AI_SPECIALIST_CONTEXT_CHAR_BUDGETS,
  AI_SPECIALIST_MAX_OUTPUT_TOKENS,
  AI_VERIFIER_MAX_OUTPUT_TOKENS,
  getSupportedResearchModels,
} from "@/lib/research/ai/config";
import {
  aaplFixtureCurrentReports,
  buildAaplFixtureSnapshot,
} from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
import {
  AAPL_GROUNDED_SYNTHESIS,
  AAPL_RECORDED_SPECIALIST_OUTPUTS,
} from "@/lib/research/ai/fixtures/curated-evaluation";
import {
  PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE,
  serializeProviderInput,
} from "@/lib/research/ai/model-runner";
import { specialistPrompt, synthesisPrompt } from "@/lib/research/ai/prompts";
import {
  selectSpecialistEvidence,
  selectSynthesisEvidence,
} from "@/lib/research/ai/retrieval";
import {
  specialistModelOutputSchema,
  synthesisModelOutputSchema,
  validateGroundedOutput,
} from "@/lib/research/ai/schemas";
import {
  DEFERRED_EXTERNAL_SPECIALIST_AGENT_NAMES,
  initialSpecialistAgentNames,
} from "@/lib/research/types";
import {
  claimVerificationSchema,
  verificationPrompt,
} from "@/lib/research/ai/verification";

/**
 * Reservations treat every serialized provider-input byte as a token, so the
 * m29 context and output limits plus the m30 research questions and claim
 * contract, the m31 filing passages, and the m32 News specialist must keep
 * the job inside the 50,000-token and $0.25 caps under a conservative
 * model: the three first-stage specialists reserve concurrently; News
 * reserves only after they settle; and synthesis reserves after News
 * settles, with one specialist repair allowed. Settled usage is
 * approximated conservatively at three bytes per input token plus the
 * call's full output allowance.
 */

const CONSERVATIVE_BYTES_PER_INPUT_TOKEN = 3;
// Headroom kept under the job cap for larger registries, longer company
// names, and multi-byte characters that the AAPL fixture does not exercise.
const CONCURRENT_SPECIALIST_HEADROOM_TOKENS = 2_000;
// Everything in a specialist reservation other than its evidence context:
// instructions, research questions, registry, output schema, envelope, and
// output allowance.
const SPECIALIST_RESERVATION_OVERHEAD_TOKENS = 9_500;
// Applied to the evidence payload (prompt input), not the safety instructions,
// which legitimately name the user data the model must never receive. Filing
// passages are public disclosure text and may contain words such as
// "portfolio", so their verbatim excerpts are removed before the check.
const PRIVATE_DATA_PATTERN =
  /userId|portfolio|holding|alert|targetPrice|costBasis|quantity|email|@/i;

const snapshot = buildAaplFixtureSnapshot({
  currentReports: aaplFixtureCurrentReports(),
});
const firstStageAgents = initialSpecialistAgentNames("EXTERNAL").filter(
  (agent): agent is "FINANCIALS" | "COMPETITORS" | "RISK" =>
    agent === "FINANCIALS" || agent === "COMPETITORS" || agent === "RISK",
);
const deferredAgents = DEFERRED_EXTERNAL_SPECIALIST_AGENT_NAMES;
const modelAgents = [...firstStageAgents, ...deferredAgents] as const;
type ModelAgent = (typeof modelAgents)[number];
const specialistClaims = modelAgents.flatMap(
  (agent) => AAPL_RECORDED_SPECIALIST_OUTPUTS[agent].claims,
);

function bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function escaped(value: string) {
  return JSON.stringify(value).slice(1, -1);
}

function withoutFilingPassages(input: string, evidence: readonly { sourceKind: string; excerpt: string }[]) {
  return evidence
    .filter((item) => item.sourceKind === "SEC_FILING")
    .reduce((text, item) => text.replaceAll(escaped(item.excerpt), ""), input);
}

function specialistSerialized(agent: ModelAgent) {
  const selection = selectSpecialistEvidence(snapshot, agent);
  const prompt = specialistPrompt({
    agentName: agent,
    ticker: snapshot.stock.ticker,
    companyName: snapshot.stock.companyName,
    asOfDate: "2026-09-22",
    evidence: [...selection.evidence],
    evidenceContext: selection.context,
  });
  return {
    agent,
    evidence: selection.evidence,
    input: prompt.input,
    serialized: serializeProviderInput(
      prompt,
      `research_${agent.toLowerCase()}_v1`,
      specialistModelOutputSchema,
    ),
    outputTokens: AI_SPECIALIST_MAX_OUTPUT_TOKENS[agent],
  };
}

function synthesisSerialized(
  specialists: Parameters<typeof synthesisPrompt>[0]["specialists"] = modelAgents.map(
    (agentName) => ({
      agentName,
      output: AAPL_RECORDED_SPECIALIST_OUTPUTS[agentName],
    }),
  ),
) {
  const selection = selectSynthesisEvidence(snapshot, { specialistClaims });
  const prompt = synthesisPrompt({
    ticker: snapshot.stock.ticker,
    companyName: snapshot.stock.companyName,
    asOfDate: "2026-09-22",
    evidence: [...selection.evidence],
    evidenceContext: selection.context,
    specialists,
  });
  return {
    evidence: selection.evidence,
    input: prompt.input,
    serialized: serializeProviderInput(
      prompt,
      "research_synthesis_v1",
      synthesisModelOutputSchema,
    ),
    outputTokens: AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
  };
}

function reservation(call: { serialized: string; outputTokens: number }) {
  return (
    bytes(call.serialized) +
    PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE +
    call.outputTokens
  );
}

function settled(call: { serialized: string; outputTokens: number }) {
  return (
    Math.ceil(bytes(call.serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN) +
    call.outputTokens
  );
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

describe("m33 prompt envelope with the AAPL fixture", () => {
  const specialists = modelAgents.map(specialistSerialized);
  const firstStage = specialists.filter((item) =>
    (firstStageAgents as readonly string[]).includes(item.agent),
  );
  const deferred = specialists.filter((item) =>
    (deferredAgents as readonly string[]).includes(item.agent),
  );
  const largestFirstStage = firstStage.reduce((largest, item) =>
    settled(item) > settled(largest) ? item : largest,
  );
  const synthesis = synthesisSerialized();
  const verifier = {
    serialized: serializeProviderInput(
      verificationPrompt(AAPL_GROUNDED_SYNTHESIS, snapshot.evidence),
      "research_claim_verification_v1",
      claimVerificationSchema,
    ),
    outputTokens: AI_VERIFIER_MAX_OUTPUT_TOKENS,
  };

  it("fits one verifier reservation after synthesis settles, including one specialist repair", () => {
    expect(
      sum(specialists.map(settled)) +
        settled(largestFirstStage) +
        settled(synthesis) +
        reservation(verifier),
    ).toBeLessThanOrEqual(AI_HARD_MAX_TOKENS_PER_JOB);
  });

  it("keeps the three concurrent first-stage specialist reservations inside the job token cap", () => {
    expect(firstStage.map((item) => item.agent)).toEqual([
      "FINANCIALS",
      "COMPETITORS",
      "RISK",
    ]);
    expect(sum(firstStage.map(reservation))).toBeLessThanOrEqual(
      AI_HARD_MAX_TOKENS_PER_JOB - CONCURRENT_SPECIALIST_HEADROOM_TOKENS,
    );
    for (const item of specialists) {
      expect(reservation(item)).toBeLessThan(
        AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[item.agent] +
          SPECIALIST_RESERVATION_OVERHEAD_TOKENS,
      );
      expect(item.outputTokens).toBeLessThanOrEqual(
        AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
      );
    }
    // The first-stage budgets stay within three uniform 7,200-character
    // budgets; the M31 and M32 prompt rules spend the difference.
    expect(
      sum(firstStageAgents.map((agent) => AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[agent])),
    ).toBeLessThanOrEqual(3 * 7_200);
  });

  it("defers the News specialist because a fourth concurrent reservation would not fit, then fits it after the first stage settles", () => {
    expect(deferred.map((item) => item.agent)).toEqual(["NEWS"]);
    const news = deferred[0];
    expect(sum(firstStage.map(reservation)) + reservation(news)).toBeGreaterThan(
      AI_HARD_MAX_TOKENS_PER_JOB - CONCURRENT_SPECIALIST_HEADROOM_TOKENS,
    );
    expect(sum(firstStage.map(settled)) + reservation(news)).toBeLessThanOrEqual(
      AI_HARD_MAX_TOKENS_PER_JOB - CONCURRENT_SPECIALIST_HEADROOM_TOKENS,
    );
  });

  it("leaves room for synthesis after all four specialists settle, including one repair", () => {
    expect(
      sum(specialists.map(settled)) +
        settled(largestFirstStage) +
        reservation(synthesis),
    ).toBeLessThanOrEqual(AI_HARD_MAX_TOKENS_PER_JOB);
  });

  it("keeps synthesis inside the job cap even when every specialist fills its output allowance", () => {
    // Worst case: each specialist returns the schema maximum of twelve long
    // claims with assumptions and a long summary (about 8,000 characters,
    // the size of a 2,000-token output).
    const verbose = (agentName: ModelAgent) => ({
      agentName,
      output: {
        rating: "MIXED" as const,
        confidence: 0.6,
        availability: "COMPLETE" as const,
        summary: "s".repeat(1_500),
        claims: Array.from({ length: 12 }, (_, index) => ({
          category: "SUPPORTIVE" as const,
          kind: "INTERPRETATION" as const,
          statement: `${"c".repeat(380)} ${index}`,
          confidence: 0.5 + index / 100,
          evidenceIds: [snapshot.evidence[0].id],
          counterEvidenceIds: [],
          assumptions: ["a".repeat(120)],
        })),
        warnings: ["w".repeat(200)],
        missingData: ["m".repeat(200)],
      },
    });
    const verboseSynthesis = synthesisSerialized(modelAgents.map(verbose));
    expect(JSON.parse(verboseSynthesis.input).omittedSpecialistClaims).toBeGreaterThan(0);
    expect(
      sum(specialists.map(settled)) + reservation(verboseSynthesis),
    ).toBeLessThanOrEqual(AI_HARD_MAX_TOKENS_PER_JOB);
  });

  it("keeps the reserved and estimated per-report cost far below the job cost cap", () => {
    const pricing = getSupportedResearchModels()[0];
    const calls = [...specialists, synthesis, verifier];
    const reservedCost = sum(
      calls.map((call) =>
        calculateAiCostUsd(
          {
            inputTokens:
              bytes(call.serialized) + PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE,
            outputTokens: call.outputTokens,
          },
          pricing,
        ),
      ),
    );
    expect(reservedCost).toBeLessThan(AI_HARD_MAX_COST_PER_JOB_USD / 2);
    const estimatedCost = sum(
      calls.map((call) =>
        calculateAiCostUsd(
          {
            inputTokens: Math.ceil(
              bytes(call.serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN,
            ),
            outputTokens: call.outputTokens,
          },
          pricing,
        ),
      ),
    );
    expect(estimatedCost).toBeLessThan(0.07);
  });

  it("grounds every recorded output inside the evidence its agent actually receives", () => {
    for (const item of specialists) {
      expect(() =>
        validateGroundedOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS[item.agent], [
          ...item.evidence,
        ]),
      ).not.toThrow();
    }
    expect(() =>
      validateGroundedOutput(AAPL_GROUNDED_SYNTHESIS, [...synthesis.evidence]),
    ).not.toThrow();
  });

  it("supplies at least one filing passage to every model specialist and the cited passages to synthesis", () => {
    for (const item of specialists) {
      const passages = item.evidence.filter(
        (evidence) => evidence.metadata.evidenceType === "SEC_FILING_PASSAGE",
      );
      expect(passages.length).toBeGreaterThan(0);
      for (const passage of passages) {
        expect(item.input).toContain(escaped(passage.excerpt));
      }
    }
    const citedPassages = specialistClaims
      .flatMap((claim) => claim.evidenceIds)
      .filter((id) =>
        snapshot.evidence.some(
          (item) => item.id === id && item.sourceKind === "SEC_FILING",
        ),
      );
    expect(citedPassages.length).toBeGreaterThan(0);
    const synthesisPassages = synthesis.evidence.filter(
      (item) => item.sourceKind === "SEC_FILING",
    );
    expect(synthesisPassages.length).toBeGreaterThan(0);
    expect(
      AAPL_GROUNDED_SYNTHESIS.claims.some((claim) =>
        claim.evidenceIds.some((id) =>
          synthesisPassages.some((item) => item.id === id),
        ),
      ),
    ).toBe(true);
    for (const call of [...specialists, synthesis]) {
      expect(call.serialized).toContain("Evidence of kind SEC_FILING");
    }
  });

  it("gives the News specialist every listed current report, its coverage statement, and a press-release passage", () => {
    const news = deferred[0];
    const types = news.evidence.map((item) => item.metadata.evidenceType);
    expect(
      types.filter((type) => type === "SEC_CURRENT_REPORT"),
    ).toHaveLength(
      snapshot.evidence.filter(
        (item) => item.metadata.evidenceType === "SEC_CURRENT_REPORT",
      ).length,
    );
    expect(types).toContain("SEC_CURRENT_REPORT_COVERAGE");
    expect(
      news.evidence.some(
        (item) =>
          item.metadata.evidenceType === "SEC_FILING_PASSAGE" &&
          item.metadata.sectionKind === "PRESS_RELEASE",
      ),
    ).toBe(true);
    expect(
      news.evidence.every(
        (item) =>
          item.metadata.evidenceType !== "SEC_FILING_PASSAGE" ||
          item.metadata.sectionKind === "PRESS_RELEASE",
      ),
    ).toBe(true);
    expect(news.input).toContain("What remains unknown");
    // Synthesis receives the dated 8-K items the News specialist cited, ahead
    // of the passages, and its own event claim cites one of them.
    const citedReports = AAPL_RECORDED_SPECIALIST_OUTPUTS.NEWS.claims
      .flatMap((claim) => claim.evidenceIds)
      .filter((id) =>
        snapshot.evidence.some(
          (item) =>
            item.id === id && item.metadata.evidenceType === "SEC_CURRENT_REPORT",
        ),
      );
    expect(citedReports.length).toBeGreaterThan(0);
    for (const id of citedReports) {
      expect(synthesis.evidence.some((item) => item.id === id)).toBe(true);
    }
    const synthesisEventClaims = AAPL_GROUNDED_SYNTHESIS.claims.filter((claim) =>
      claim.evidenceIds.some((id) => citedReports.includes(id)),
    );
    expect(synthesisEventClaims.length).toBeGreaterThan(0);
  });

  it("sends no private portfolio, alert, note, email, or user identifier to the provider", () => {
    for (const call of [...specialists, synthesis]) {
      expect(withoutFilingPassages(call.input, call.evidence)).not.toMatch(
        PRIVATE_DATA_PATTERN,
      );
      expect(call.serialized).toContain("DERIVED");
      expect(call.serialized).toContain("never calculate");
    }
  });
});
