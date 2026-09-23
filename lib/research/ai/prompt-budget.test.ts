import { describe, expect, it } from "vitest";

import { calculateAiCostUsd } from "@/lib/research/ai/budget";
import {
  AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
  AI_HARD_MAX_COST_PER_JOB_USD,
  AI_HARD_MAX_TOKENS_PER_JOB,
  AI_SPECIALIST_CONTEXT_CHAR_BUDGETS,
  getSupportedResearchModels,
} from "@/lib/research/ai/config";
import { buildAaplFixtureSnapshot } from "@/lib/research/ai/fixtures/aapl-evidence-snapshot";
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

/**
 * Reservations treat every serialized provider-input byte as a token, so the
 * m29 context and output limits plus the m30 research questions and claim
 * contract and the m31 filing passages must keep three concurrent specialist
 * reservations, and synthesis after their settlement, inside the 50,000-token
 * and $0.25 job caps. Settled specialist usage is approximated conservatively
 * at three bytes per input token plus the full output allowance.
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

const snapshot = buildAaplFixtureSnapshot();
const modelAgents = ["FINANCIALS", "COMPETITORS", "RISK"] as const;
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

function specialistSerialized(agent: (typeof modelAgents)[number]) {
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
    evidence: selection.evidence,
    input: prompt.input,
    serialized: serializeProviderInput(
      prompt,
      `research_${agent.toLowerCase()}_v1`,
      specialistModelOutputSchema,
    ),
  };
}

function synthesisSerialized() {
  const selection = selectSynthesisEvidence(snapshot, { specialistClaims });
  const prompt = synthesisPrompt({
    ticker: snapshot.stock.ticker,
    companyName: snapshot.stock.companyName,
    asOfDate: "2026-09-22",
    evidence: [...selection.evidence],
    evidenceContext: selection.context,
    specialists: [
      ...modelAgents.map((agentName) => ({
        agentName,
        output: AAPL_RECORDED_SPECIALIST_OUTPUTS[agentName],
      })),
      {
        agentName: "NEWS" as const,
        output: {
          rating: "NEUTRAL" as const,
          confidence: 0,
          availability: "NOT_AVAILABLE" as const,
          summary:
            "Licensed current-news evidence is not configured; filings are not treated as current news.",
          claims: [],
          warnings: [],
          missingData: [
            "Licensed current-news evidence is not configured; filings are not treated as current news.",
          ],
        },
      },
    ],
  });
  return {
    evidence: selection.evidence,
    input: prompt.input,
    serialized: serializeProviderInput(
      prompt,
      "research_synthesis_v1",
      synthesisModelOutputSchema,
    ),
  };
}

function reservation(serialized: string) {
  return (
    bytes(serialized) +
    PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE +
    AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL
  );
}

describe("m29 prompt envelope with the AAPL fixture", () => {
  const specialists = modelAgents.map((agent) => ({
    agent,
    ...specialistSerialized(agent),
  }));
  const synthesis = synthesisSerialized();

  it("keeps three concurrent specialist reservations inside the job token cap", () => {
    const total = specialists.reduce(
      (sum, item) => sum + reservation(item.serialized),
      0,
    );
    expect(total).toBeLessThanOrEqual(
      AI_HARD_MAX_TOKENS_PER_JOB - CONCURRENT_SPECIALIST_HEADROOM_TOKENS,
    );
    for (const item of specialists) {
      expect(reservation(item.serialized)).toBeLessThan(
        AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[item.agent] +
          SPECIALIST_RESERVATION_OVERHEAD_TOKENS,
      );
    }
    // The rebalanced per-agent budgets stay within three uniform
    // 7,200-character budgets; the M31 prompt rule spends the difference.
    expect(
      modelAgents.reduce(
        (sum, agent) => sum + AI_SPECIALIST_CONTEXT_CHAR_BUDGETS[agent],
        0,
      ),
    ).toBeLessThanOrEqual(3 * 7_200);
  });

  it("leaves room for synthesis after the specialists settle, including one repair", () => {
    const settledSpecialists = specialists.reduce(
      (sum, item) =>
        sum +
        Math.ceil(bytes(item.serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN) +
        AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
      0,
    );
    const oneRepair =
      Math.ceil(bytes(specialists[0].serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN) +
      AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL;
    expect(
      settledSpecialists + oneRepair + reservation(synthesis.serialized),
    ).toBeLessThanOrEqual(AI_HARD_MAX_TOKENS_PER_JOB);
  });

  it("keeps synthesis inside the job cap even when every specialist fills its output allowance", () => {
    // Worst case: each specialist returns the schema maximum of twelve long
    // claims with assumptions and a long summary (about 8,000 characters,
    // the size of a 2,000-token output).
    const verbose = (agentName: (typeof modelAgents)[number]) => ({
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
    const selection = selectSynthesisEvidence(snapshot, { specialistClaims });
    const prompt = synthesisPrompt({
      ticker: snapshot.stock.ticker,
      companyName: snapshot.stock.companyName,
      asOfDate: "2026-09-22",
      evidence: [...selection.evidence],
      evidenceContext: selection.context,
      specialists: modelAgents.map(verbose),
    });
    const serialized = serializeProviderInput(
      prompt,
      "research_synthesis_v1",
      synthesisModelOutputSchema,
    );
    const settledSpecialists = specialists.reduce(
      (sum, item) =>
        sum +
        Math.ceil(bytes(item.serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN) +
        AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
      0,
    );
    expect(JSON.parse(prompt.input).omittedSpecialistClaims).toBeGreaterThan(0);
    expect(settledSpecialists + reservation(serialized)).toBeLessThanOrEqual(
      AI_HARD_MAX_TOKENS_PER_JOB,
    );
  });

  it("keeps the reserved and estimated per-report cost far below the job cost cap", () => {
    const pricing = getSupportedResearchModels()[0];
    const reservedCost = [
      ...specialists.map((item) => item.serialized),
      synthesis.serialized,
    ]
      .map((serialized) =>
        calculateAiCostUsd(
          {
            inputTokens: bytes(serialized) + PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE,
            outputTokens: AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
          },
          pricing,
        ),
      )
      .reduce((sum, value) => sum + value, 0);
    expect(reservedCost).toBeLessThan(AI_HARD_MAX_COST_PER_JOB_USD / 2);
    const estimatedCost = [
      ...specialists.map((item) => item.serialized),
      synthesis.serialized,
    ]
      .map((serialized) =>
        calculateAiCostUsd(
          {
            inputTokens: Math.ceil(
              bytes(serialized) / CONSERVATIVE_BYTES_PER_INPUT_TOKEN,
            ),
            outputTokens: AI_DEFAULT_MAX_OUTPUT_TOKENS_PER_CALL,
          },
          pricing,
        ),
      )
      .reduce((sum, value) => sum + value, 0);
    expect(estimatedCost).toBeLessThan(0.06);
  });

  it("grounds every recorded output inside the evidence its agent actually receives", () => {
    for (const agent of modelAgents) {
      const selection = selectSpecialistEvidence(snapshot, agent);
      expect(() =>
        validateGroundedOutput(AAPL_RECORDED_SPECIALIST_OUTPUTS[agent], [
          ...selection.evidence,
        ]),
      ).not.toThrow();
    }
    const synthesisSelection = selectSynthesisEvidence(snapshot, {
      specialistClaims,
    });
    expect(() =>
      validateGroundedOutput(AAPL_GROUNDED_SYNTHESIS, [
        ...synthesisSelection.evidence,
      ]),
    ).not.toThrow();
  });

  it("supplies at least one filing passage to every model specialist and the cited passage to synthesis", () => {
    for (const item of specialists) {
      const passages = item.evidence.filter(
        (evidence) => evidence.sourceKind === "SEC_FILING",
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
