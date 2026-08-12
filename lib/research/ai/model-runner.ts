import { z } from "zod";

import { isFeatureEnabled } from "@/lib/operations/feature-flags";
import {
  estimateInputTokenUpperBound,
  markAiUsageUnconfirmed,
  releaseAiUsage,
  reserveAiUsage,
  settleAiUsage,
  type AiUsageReservation,
} from "@/lib/research/ai/budget";
import {
  AI_PROMPT_VERSION,
  type AiResearchConfig,
} from "@/lib/research/ai/config";
import {
  ModelProviderError,
  type ResearchModelProvider,
  type ResearchModelResult,
} from "@/lib/research/ai/providers";
import {
  ModelOutputSafetyError,
  validateGroundedOutput,
  type ResearchEvidence,
  type SpecialistModelOutput,
} from "@/lib/research/ai/schemas";

export type GroundedModelCallResult<T> = {
  output: T;
  providerResult: ResearchModelResult;
  reservation: AiUsageReservation | null;
  attemptNumber: number;
};

export class GroundedModelCallError extends Error {
  readonly name = "GroundedModelCallError";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly partialResultAllowed: boolean,
    options?: ErrorOptions,
  ) {
    super(
      "Evidence-grounded model generation could not complete safely.",
      options,
    );
  }
}

type Prompt = { instructions: string; input: string };

const PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE = 1_024;

type RunnerDependencies = {
  environment?: NodeJS.ProcessEnv;
  reserve?: typeof reserveAiUsage;
  settle?: typeof settleAiUsage;
  release?: typeof releaseAiUsage;
  markUnconfirmed?: typeof markAiUsageUnconfirmed;
};

/**
 * Runs one structured generation and at most one constrained repair. The
 * successful reservation is intentionally returned unsettled so the caller can
 * persist the validated output and settle usage in the same transaction.
 */
export async function runGroundedModelCall<T extends SpecialistModelOutput>(
  input: {
    provider: ResearchModelProvider;
    config: AiResearchConfig;
    schema: z.ZodType<T>;
    schemaName: string;
    evidence: ResearchEvidence[];
    prompt: (repairFeedback?: string) => Prompt;
    userId: string;
    researchJobId: string;
    agentRunId?: string | null;
    operation: string;
    idempotencyKey: string;
    now?: Date;
    signal?: AbortSignal;
  },
  dependencies: RunnerDependencies = {},
): Promise<GroundedModelCallResult<T>> {
  const reserve = dependencies.reserve ?? reserveAiUsage;
  const settle = dependencies.settle ?? settleAiUsage;
  const release = dependencies.release ?? releaseAiUsage;
  const markUnconfirmed =
    dependencies.markUnconfirmed ?? markAiUsageUnconfirmed;
  const environment = dependencies.environment ?? process.env;
  const metered = input.provider.provider === "openai";
  let repairFeedback: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    if (input.signal?.aborted) {
      throw new GroundedModelCallError(
        "AI_MODEL_PROVIDER_ABORTED",
        false,
        true,
      );
    }
    if (metered && !isFeatureEnabled("AI_RESEARCH_ENABLED", environment)) {
      throw new GroundedModelCallError("AI_RESEARCH_DISABLED", false, true);
    }

    const prompt = input.prompt(repairFeedback);
    let serializedProviderInput: string;
    try {
      serializedProviderInput = JSON.stringify({
        instructions: prompt.instructions,
        input: prompt.input,
        outputSchemaName: input.schemaName,
        outputSchema: z.toJSONSchema(input.schema),
      });
    } catch (error) {
      throw new GroundedModelCallError(
        "AI_MODEL_PROVIDER_CONFIGURATION",
        false,
        true,
        { cause: error },
      );
    }
    let reservation: AiUsageReservation | null = null;
    if (metered) {
      reservation = await reserve({
        idempotencyKey: `${input.idempotencyKey}:model-attempt:${attemptNumber}`,
        userId: input.userId,
        researchJobId: input.researchJobId,
        agentRunId: input.agentRunId,
        operation: input.operation,
        promptVersion: AI_PROMPT_VERSION,
        attemptNumber,
        reservedInputTokens:
          estimateInputTokenUpperBound(serializedProviderInput) +
          PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE,
        reservedOutputTokens: input.config.maxOutputTokensPerCall,
        config: input.config,
        now: input.now,
      });
    }

    let generated: ResearchModelResult;
    try {
      generated = await input.provider.generate({
        instructions: prompt.instructions,
        input: prompt.input,
        outputSchema: input.schema,
        outputSchemaName: input.schemaName,
        maxOutputTokens: input.config.maxOutputTokensPerCall,
        signal: input.signal,
      });
    } catch (error) {
      if (reservation) {
        if (error instanceof ModelProviderError && error.usage) {
          await settle(reservation.usageId, {
            inputTokens: error.usage.inputTokens,
            cachedInputTokens: error.usage.cachedInputTokens,
            outputTokens: error.usage.outputTokens,
            providerRequestId: error.providerRequestId ?? null,
          });
        } else if (
          error instanceof ModelProviderError &&
          error.chargeUncertain
        ) {
          await markUnconfirmed(reservation.usageId, error.code, {
            providerRequestId: error.providerRequestId ?? null,
          });
        } else {
          await release(
            reservation.usageId,
            error instanceof ModelProviderError
              ? error.code
              : "AI_MODEL_PROVIDER_UNKNOWN",
          );
        }
      }
      if (error instanceof ModelProviderError) {
        throw new GroundedModelCallError(
          error.code,
          error.retryable,
          !error.retryable,
          { cause: error },
        );
      }
      throw new GroundedModelCallError(
        "AI_MODEL_PROVIDER_UNKNOWN",
        true,
        false,
        { cause: error },
      );
    }

    const parsed = input.schema.safeParse(generated.output);
    try {
      if (!parsed.success) throw parsed.error;
      validateGroundedOutput(parsed.data, input.evidence);
      return {
        output: parsed.data,
        providerResult: generated,
        reservation,
        attemptNumber,
      };
    } catch (error) {
      if (reservation) {
        await settle(reservation.usageId, {
          inputTokens: generated.usage.inputTokens,
          cachedInputTokens: generated.usage.cachedInputTokens,
          outputTokens: generated.usage.outputTokens,
          providerRequestId: generated.providerRequestId,
        });
      }
      if (attemptNumber === 2) {
        throw new GroundedModelCallError(
          error instanceof ModelOutputSafetyError
            ? error.code
            : "AI_MODEL_OUTPUT_INVALID",
          false,
          true,
          { cause: error },
        );
      }
      repairFeedback =
        "The prior response failed the required runtime schema or evidence safety checks. Return a corrected object only; cite only supplied evidence ids and do not add recommendations.";
    }
  }

  throw new GroundedModelCallError("AI_MODEL_OUTPUT_INVALID", false, true);
}
