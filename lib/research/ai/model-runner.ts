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
  ModelOutputConsistencyError,
  ModelOutputSafetyError,
  validateGroundedOutput,
  type GroundedModelOutput,
  type ResearchEvidence,
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

export const PROVIDER_INPUT_ENVELOPE_TOKEN_ALLOWANCE = 1_024;

/** The exact provider input the runner reserves against, byte for byte. */
export function serializeProviderInput(
  prompt: Prompt,
  schemaName: string,
  schema: z.ZodType,
) {
  return JSON.stringify({
    instructions: prompt.instructions,
    input: prompt.input,
    outputSchemaName: schemaName,
    outputSchema: z.toJSONSchema(schema),
  });
}

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
export async function runGroundedModelCall<T extends GroundedModelOutput>(
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
    /** Output allowance for this call; never above the configured per-call maximum. */
    maxOutputTokens?: number;
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
  const maxOutputTokens = Math.min(
    input.config.maxOutputTokensPerCall,
    input.maxOutputTokens ?? input.config.maxOutputTokensPerCall,
  );
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
      serializedProviderInput = serializeProviderInput(
        prompt,
        input.schemaName,
        input.schema,
      );
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
        reservedOutputTokens: maxOutputTokens,
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
        maxOutputTokens,
        signal: input.signal,
      });
    } catch (error) {
      if (reservation) {
        if (error instanceof ModelProviderError && error.chargeUncertain) {
          await markUnconfirmed(reservation.usageId, error.code, {
            ...(error.usage
              ? {
                  inputTokens: error.usage.inputTokens,
                  cachedInputTokens: error.usage.cachedInputTokens,
                  outputTokens: error.usage.outputTokens,
                  reasoningTokens: error.usage.reasoningTokens,
                  providerTotalTokens: error.usage.totalTokens,
                }
              : {}),
            providerRequestId: error.providerRequestId ?? null,
          });
        } else if (error instanceof ModelProviderError && error.usage) {
          await settle(reservation.usageId, {
            inputTokens: error.usage.inputTokens,
            cachedInputTokens: error.usage.cachedInputTokens,
            outputTokens: error.usage.outputTokens,
            reasoningTokens: error.usage.reasoningTokens,
            providerTotalTokens: error.usage.totalTokens,
            providerRequestId: error.providerRequestId ?? null,
          });
        } else {
          await release(
            reservation.usageId,
            error instanceof ModelProviderError
              ? error.code
              : "AI_MODEL_PROVIDER_UNKNOWN",
            {
              providerRequestId:
                error instanceof ModelProviderError
                  ? (error.providerRequestId ?? null)
                  : null,
            },
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
          reasoningTokens: generated.usage.reasoningTokens,
          providerTotalTokens: generated.usage.totalTokens,
          providerRequestId: generated.providerRequestId,
        });
      }
      const checkFailure =
        error instanceof ModelOutputSafetyError ||
        error instanceof ModelOutputConsistencyError;
      if (attemptNumber === 2) {
        throw new GroundedModelCallError(
          checkFailure ? error.code : "AI_MODEL_OUTPUT_INVALID",
          false,
          true,
          { cause: error },
        );
      }
      // The check messages are fixed application strings, never model or
      // user text, so they are safe to echo back as repair guidance.
      repairFeedback = `The prior response failed the required runtime schema, evidence safety, or consistency checks${checkFailure ? `: ${error.message}` : "."} Return a corrected object only; cite only supplied evidence ids, state numbers exactly as they appear in cited evidence with the same unit, keep the rating and availability consistent with the claims, and do not add recommendations.`;
    }
  }

  throw new GroundedModelCallError("AI_MODEL_OUTPUT_INVALID", false, true);
}
