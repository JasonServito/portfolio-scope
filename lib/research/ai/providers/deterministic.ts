import {
  EMPTY_RESEARCH_MODEL_USAGE,
  ModelProviderError,
  ModelProviderErrorCode,
  normalizeResearchModelUsage,
  type ResearchModelProvider,
  type ResearchModelRequest,
  type ResearchModelResult,
  type ResearchModelTokenUsage,
} from "@/lib/research/ai/providers/types";

export type DeterministicResearchModelProviderOptions = {
  output:
    | unknown
    | ((request: ResearchModelRequest) => unknown | Promise<unknown>);
  model?: string;
  usage?: Partial<ResearchModelTokenUsage>;
};

export class DeterministicResearchModelProvider implements ResearchModelProvider {
  readonly provider = "deterministic";
  readonly model: string;
  private readonly output: DeterministicResearchModelProviderOptions["output"];
  private readonly usage: ResearchModelTokenUsage;

  constructor(options: DeterministicResearchModelProviderOptions) {
    this.model = options.model ?? "deterministic-research-v1";
    this.output = options.output;
    this.usage = options.usage
      ? normalizeResearchModelUsage(options.usage)
      : EMPTY_RESEARCH_MODEL_USAGE;
  }

  async generate(request: ResearchModelRequest): Promise<ResearchModelResult> {
    assertNotAborted(request.signal, this.provider);
    const output =
      typeof this.output === "function"
        ? await this.output(request)
        : this.output;
    assertNotAborted(request.signal, this.provider);

    return {
      output,
      provider: this.provider,
      model: this.model,
      providerRequestId: null,
      responseId: null,
      usage: { ...this.usage },
    };
  }
}

function assertNotAborted(signal: AbortSignal | undefined, provider: string) {
  if (signal?.aborted) {
    throw new ModelProviderError(ModelProviderErrorCode.ABORTED, {
      provider,
      chargeUncertain: false,
    });
  }
}
