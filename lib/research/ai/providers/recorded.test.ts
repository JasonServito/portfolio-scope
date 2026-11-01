import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DeterministicResearchModelProvider,
  ModelProviderError,
  ModelProviderErrorCode,
  RecordedResearchModelProvider,
  type ResearchModelRequest,
} from "@/lib/research/ai/providers";

function request(
  overrides: Partial<ResearchModelRequest> = {},
): ResearchModelRequest {
  return {
    instructions: "Return JSON.",
    input: { ticker: "AAPL" },
    outputSchema: z.object({ sequence: z.number() }).strict(),
    outputSchemaName: "recorded_output",
    ...overrides,
  };
}

describe("recorded research model provider", () => {
  it("consumes successful fixtures in deterministic queue order", async () => {
    const provider = new RecordedResearchModelProvider({
      model: "recorded-default",
      fixtures: [
        {
          result: {
            output: { sequence: 1 },
            providerRequestId: "fixture_request_1",
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          },
        },
        {
          result: {
            output: { sequence: 2 },
            model: "recorded-override",
            usage: {
              inputTokens: 20,
              cachedInputTokens: 5,
              outputTokens: 6,
              totalTokens: 26,
            },
          },
        },
      ],
    });

    await expect(provider.generate(request())).resolves.toMatchObject({
      output: { sequence: 1 },
      provider: "recorded",
      model: "recorded-default",
      providerRequestId: "fixture_request_1",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    expect(provider.remainingFixtures).toBe(1);
    await expect(provider.generate(request())).resolves.toMatchObject({
      output: { sequence: 2 },
      model: "recorded-override",
      usage: { cachedInputTokens: 5 },
    });
    expect(provider.remainingFixtures).toBe(0);
  });

  it("replays typed failures and fails explicitly after queue exhaustion", async () => {
    const recordedFailure = new ModelProviderError(
      ModelProviderErrorCode.RATE_LIMITED,
      { provider: "recorded", retryAfterMs: 1_000 },
    );
    const provider = new RecordedResearchModelProvider({
      fixtures: [{ error: recordedFailure }],
    });

    await expect(provider.generate(request())).rejects.toBe(recordedFailure);
    await expect(provider.generate(request())).rejects.toMatchObject({
      code: ModelProviderErrorCode.RECORDED_FIXTURES_EXHAUSTED,
      retryable: false,
      chargeUncertain: false,
    });
  });

  it("does not consume a fixture when its parent signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new RecordedResearchModelProvider({
      fixtures: [{ result: { output: { sequence: 1 } } }],
    });

    await expect(
      provider.generate(request({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: ModelProviderErrorCode.ABORTED });
    expect(provider.remainingFixtures).toBe(1);
  });
});

describe("deterministic research model provider", () => {
  it("returns repeatable output without provider usage", async () => {
    const provider = new DeterministicResearchModelProvider({
      output: (modelRequest: ResearchModelRequest) => ({
        sequence: 1,
        input: modelRequest.input,
      }),
    });

    const first = await provider.generate(request());
    const second = await provider.generate(request());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      provider: "deterministic",
      model: "deterministic-research-v1",
      output: { sequence: 1, input: { ticker: "AAPL" } },
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
    });
  });
});
