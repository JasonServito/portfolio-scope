import {
  ModelProviderError,
  ModelProviderErrorCode,
  normalizeResearchModelUsage,
  type ResearchModelProvider,
  type ResearchModelRequest,
  type ResearchModelResult,
  type ResearchModelTokenUsage,
} from "@/lib/research/ai/providers/types";

export type RecordedResearchModelSuccess = {
  output: unknown;
  model?: string;
  providerRequestId?: string | null;
  responseId?: string | null;
  usage?: Partial<ResearchModelTokenUsage>;
};

export type RecordedResearchModelFixture =
  | { result: RecordedResearchModelSuccess; error?: never }
  | { result?: never; error: ModelProviderError };

export type RecordedResearchModelProviderOptions = {
  fixtures: readonly RecordedResearchModelFixture[];
  model?: string;
};

export class RecordedResearchModelProvider implements ResearchModelProvider {
  readonly provider = "recorded";
  readonly model: string;
  private readonly fixtures: readonly RecordedResearchModelFixture[];
  private nextFixtureIndex = 0;

  constructor(options: RecordedResearchModelProviderOptions) {
    this.model = options.model ?? "recorded-research-v1";
    this.fixtures = [...options.fixtures];
  }

  get remainingFixtures() {
    return this.fixtures.length - this.nextFixtureIndex;
  }

  async generate(request: ResearchModelRequest): Promise<ResearchModelResult> {
    if (request.signal?.aborted) {
      throw new ModelProviderError(ModelProviderErrorCode.ABORTED, {
        provider: this.provider,
        chargeUncertain: false,
      });
    }

    const fixture = this.fixtures[this.nextFixtureIndex];
    if (!fixture) {
      throw new ModelProviderError(
        ModelProviderErrorCode.RECORDED_FIXTURES_EXHAUSTED,
        { provider: this.provider },
      );
    }
    this.nextFixtureIndex += 1;

    if (fixture.error) throw fixture.error;

    return {
      output: fixture.result.output,
      provider: this.provider,
      model: fixture.result.model ?? this.model,
      providerRequestId: fixture.result.providerRequestId ?? null,
      responseId: fixture.result.responseId ?? null,
      usage: normalizeResearchModelUsage(fixture.result.usage),
    };
  }
}
