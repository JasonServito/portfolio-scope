import { describe, expect, it, vi } from "vitest";

import { AiBudgetError } from "./budget";
import { AI_VERIFIER_MAX_OUTPUT_TOKENS, getAiResearchConfig } from "./config";
import {
  AAPL_GROUNDED_SYNTHESIS,
  CURATED_RESEARCH_EVIDENCE,
} from "./fixtures/curated-evaluation";
import { runValidatedModelCall, type RunnerDependencies } from "./model-runner";
import {
  ModelProviderError,
  ModelProviderErrorCode,
  RecordedResearchModelProvider,
  type ResearchModelProvider,
} from "./providers";
import { claimKey, validateGroundedOutput } from "./schemas";
import {
  applyClaimVerification,
  claimVerificationSchema,
  validateClaimVerification,
  verificationPrompt,
  type ClaimVerification,
} from "./verification";

const output = AAPL_GROUNDED_SYNTHESIS;
const evidence = CURATED_RESEARCH_EVIDENCE;
const config = getAiResearchConfig({
  NODE_ENV: "test",
  OPENAI_API_KEY: "fixture-only",
} as NodeJS.ProcessEnv);
const supported: ClaimVerification = {
  results: output.claims.map((claim) => ({
    claimKey: claimKey(claim),
    status: "SUPPORTED",
    contradictingEvidenceIds: [],
  })),
};

function call(
  provider: ResearchModelProvider,
  dependencies: RunnerDependencies = {},
) {
  return runValidatedModelCall(
    {
      provider,
      config,
      schema: claimVerificationSchema,
      schemaName: "research_claim_verification_v1",
      validate: (result) => validateClaimVerification(result, output),
      maxAttempts: 1,
      maxOutputTokens: AI_VERIFIER_MAX_OUTPUT_TOKENS,
      prompt: () => verificationPrompt(output, evidence),
      userId: "private-owner",
      researchJobId: "job",
      operation: "CLAIM_VERIFICATION",
      idempotencyKey: "research:job:verification",
    },
    dependencies,
  );
}

describe("one bounded claim verification pass", () => {
  it("keeps supported and partially supported claims in order, removes unsupported claims and excludes contradictions from findings", async () => {
    const fixture = structuredClone(supported);
    fixture.results[1].status = "PARTIALLY_SUPPORTED";
    fixture.results[2].status = "UNSUPPORTED";
    fixture.results[3] = {
      ...fixture.results[3],
      status: "CONTRADICTED",
      contradictingEvidenceIds: output.claims[3].evidenceIds,
    };
    const provider = new RecordedResearchModelProvider({
      fixtures: [{ result: { output: fixture } }],
    });
    const result = await call(provider);
    const final = applyClaimVerification(output, result.output);
    expect(final.claims).toEqual(
      output.claims.filter((_, index) => index !== 2 && index !== 3),
    );
    // The removal is a process note for the report, never missing information.
    expect(final.warnings).toEqual([
      "1 draft claim was removed because the cited evidence did not establish it; remaining claims show any limits.",
    ]);
    expect(final.missingData).toEqual(output.missingData);
    expect(final.summary).not.toEqual(output.summary);
    expect(final.disagreements).toEqual([]);
    expect(final.whatWouldChange).toEqual([]);
    expect(() => validateGroundedOutput(final, evidence)).not.toThrow();
    expect(provider.remainingFixtures).toBe(0);
  });

  it("preserves a draft on failure without claim edits or a duplicate warning", () => {
    // The report stores verificationCompleted=false and the page states that
    // claim support is unverified, so the draft is returned unchanged.
    const final = applyClaimVerification(output, null);
    expect(final).toEqual(output);
  });

  it.each([
    "missing",
    "duplicate",
    "reordered",
    "invented",
    "foreign citation",
    "empty contradiction",
    "extra text",
  ])("rejects %s results without a repair", async (invalid) => {
    const fixture = structuredClone(supported);
    if (invalid === "missing") fixture.results.pop();
    if (invalid === "duplicate") fixture.results[1] = fixture.results[0];
    if (invalid === "reordered") fixture.results.reverse();
    if (invalid === "invented") fixture.results[0].claimKey = "f".repeat(24);
    if (invalid === "foreign citation")
      fixture.results[0] = {
        ...fixture.results[0],
        status: "CONTRADICTED",
        contradictingEvidenceIds: ["ev_ffffffffffffffff"],
      };
    if (invalid === "empty contradiction")
      fixture.results[0].status = "CONTRADICTED";
    if (invalid === "extra text")
      Object.assign(fixture.results[0], { statement: "Replacement claim" });
    const provider = new RecordedResearchModelProvider({
      fixtures: [
        { result: { output: fixture } },
        { result: { output: supported } },
      ],
    });
    await expect(call(provider)).rejects.toMatchObject({
      code: "AI_MODEL_OUTPUT_INVALID",
    });
    expect(provider.remainingFixtures).toBe(1);
  });

  it("deduplicates whole cited excerpts, sends all claims, and sends no owner, storage keys or unrelated evidence", () => {
    const prompt = verificationPrompt(output, evidence);
    const payload = JSON.parse(prompt.input);
    expect(
      payload.claims.map((claim: { claimKey: string }) => claim.claimKey),
    ).toEqual(output.claims.map(claimKey));
    const cited = new Set(
      output.claims.flatMap((claim) => [
        ...claim.evidenceIds,
        ...claim.counterEvidenceIds,
      ]),
    );
    expect(
      payload.evidence.map((item: { id: string }) => item.id).sort(),
    ).toEqual([...cited].sort());
    for (const item of payload.evidence)
      expect(item.excerpt).toBe(
        evidence.find((source) => source.id === item.id)?.excerpt,
      );
    expect(prompt.input).not.toMatch(
      /private-owner|userId|objectKey|secRawSourceId/,
    );
  });

  it("reserves the verifier allowance with its own operation and returns successful usage for atomic settlement", async () => {
    const recorded = new RecordedResearchModelProvider({
      fixtures: [
        {
          result: {
            output: supported,
            providerRequestId: "request-verifier",
            usage: {
              inputTokens: 120,
              cachedInputTokens: 20,
              outputTokens: 40,
              reasoningTokens: 10,
              totalTokens: 160,
            },
          },
        },
      ],
    });
    const reserve = vi.fn().mockResolvedValue({ usageId: "usage-verifier" });
    const settle = vi.fn();
    const result = await call(
      {
        provider: "openai",
        model: config.model,
        generate: recorded.generate.bind(recorded),
      },
      {
        environment: {
          NODE_ENV: "test",
          AI_RESEARCH_ENABLED: "true",
        } as NodeJS.ProcessEnv,
        reserve,
        settle,
      },
    );
    expect(reserve).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "CLAIM_VERIFICATION",
        reservedOutputTokens: AI_VERIFIER_MAX_OUTPUT_TOKENS,
        idempotencyKey: "research:job:verification:model-attempt:1",
      }),
    );
    expect(result.reservation?.usageId).toBe("usage-verifier");
    expect(result.providerResult.usage).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 40,
      reasoningTokens: 10,
      totalTokens: 160,
    });
    expect(settle).not.toHaveBeenCalled();
  });

  it.each(["kill switch", "job cap", "already attempted"])(
    "makes no provider call when blocked by %s",
    async (reason) => {
      const generate = vi.fn();
      const reserve = vi
        .fn()
        .mockRejectedValue(
          new AiBudgetError(
            reason === "job cap"
              ? "AI_JOB_TOKEN_LIMIT_EXCEEDED"
              : "AI_USAGE_ALREADY_RESERVED",
            "Fixture limit",
          ),
        );
      await expect(
        call(
          { provider: "openai", model: config.model, generate },
          {
            environment: {
              NODE_ENV: "test",
              AI_RESEARCH_ENABLED: reason === "kill switch" ? "false" : "true",
            } as NodeJS.ProcessEnv,
            reserve,
          },
        ),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it("settles invalid charged output once and never repairs it", async () => {
    const recorded = new RecordedResearchModelProvider({
      fixtures: [
        {
          result: {
            output: { results: [] },
            providerRequestId: "bad-verifier",
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        },
      ],
    });
    const settle = vi.fn();
    await expect(
      call(
        {
          provider: "openai",
          model: config.model,
          generate: recorded.generate.bind(recorded),
        },
        {
          environment: {
            NODE_ENV: "test",
            AI_RESEARCH_ENABLED: "true",
          } as NodeJS.ProcessEnv,
          reserve: vi.fn().mockResolvedValue({ usageId: "bad-usage" }),
          settle,
        },
      ),
    ).rejects.toMatchObject({ code: "AI_MODEL_OUTPUT_INVALID" });
    expect(settle).toHaveBeenCalledWith(
      "bad-usage",
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 20,
        providerRequestId: "bad-verifier",
      }),
    );
  });

  it("holds an uncertain timeout for reconciliation", async () => {
    const markUnconfirmed = vi.fn();
    const recorded = new RecordedResearchModelProvider({
      fixtures: [
        {
          error: new ModelProviderError(ModelProviderErrorCode.TIMEOUT, {
            provider: "openai",
            chargeUncertain: true,
            providerRequestId: "timeout-verifier",
          }),
        },
      ],
    });
    await expect(
      call(
        {
          provider: "openai",
          model: config.model,
          generate: recorded.generate.bind(recorded),
        },
        {
          environment: {
            NODE_ENV: "test",
            AI_RESEARCH_ENABLED: "true",
          } as NodeJS.ProcessEnv,
          reserve: vi.fn().mockResolvedValue({ usageId: "timeout-usage" }),
          markUnconfirmed,
        },
      ),
    ).rejects.toThrow();
    expect(markUnconfirmed).toHaveBeenCalledWith(
      "timeout-usage",
      ModelProviderErrorCode.TIMEOUT,
      { providerRequestId: "timeout-verifier" },
    );
  });
});
