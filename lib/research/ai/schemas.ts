import { createHash } from "node:crypto";

import { z } from "zod";

export const evidenceSourceKindSchema = z.enum([
  "SEC_FACT",
  "SEC_FILING",
  "COMPANY_PROFILE",
  "PEER_SET",
  "DETERMINISTIC",
]);

export const researchEvidenceSchema = z
  .object({
    id: z.string().regex(/^ev_[a-f0-9]{16}$/),
    sourceKind: evidenceSourceKindSchema,
    title: z.string().trim().min(1).max(240),
    sourceReference: z.string().trim().min(1).max(1_000),
    sourceUrl: z.string().url().nullable(),
    accessionNumber: z.string().nullable(),
    section: z.string().trim().min(1).max(240).nullable(),
    objectKey: z.string().trim().min(1).max(1_000).nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    sourceDate: z.string().date().nullable(),
    retrievedAt: z.string().datetime({ offset: true }).nullable(),
    excerpt: z.string().trim().min(1).max(4_000),
    passageStart: z.number().int().nonnegative().nullable(),
    passageEnd: z.number().int().positive().nullable(),
    secFilingId: z.string().nullable(),
    secRawSourceId: z.string().nullable(),
    secFinancialFactId: z.string().nullable(),
    metadata: z.record(z.string(), z.json()),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.passageStart === null) !== (value.passageEnd === null)) {
      context.addIssue({
        code: "custom",
        message: "Passage boundaries must both be present or absent.",
      });
    }
    if (
      value.passageStart !== null &&
      value.passageEnd !== null &&
      value.passageEnd <= value.passageStart
    ) {
      context.addIssue({
        code: "custom",
        message: "The passage end must follow the passage start.",
      });
    }
  });

export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;

export const modelClaimSchema = z
  .object({
    category: z.enum(["SUPPORTIVE", "COUNTERPOINT", "RISK"]),
    statement: z.string().trim().min(1).max(1_200),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string()).min(1).max(6),
    counterEvidenceIds: z.array(z.string()).max(6),
    assumptions: z.array(z.string().trim().min(1).max(400)).max(6),
  })
  .strict();

export type ModelClaim = z.infer<typeof modelClaimSchema>;

const commonModelOutput = {
  rating: z.enum(["BEARISH", "NEUTRAL", "BULLISH", "MIXED"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(2_000),
  claims: z.array(modelClaimSchema).max(12),
  warnings: z.array(z.string().trim().min(1).max(600)).max(10),
  missingData: z.array(z.string().trim().min(1).max(600)).max(10),
};

export const specialistModelOutputSchema = z.object(commonModelOutput).strict();

export const synthesisModelOutputSchema = z
  .object({
    ...commonModelOutput,
    disagreements: z.array(z.string().trim().min(1).max(600)).max(10),
  })
  .strict();

export type SpecialistModelOutput = z.infer<typeof specialistModelOutputSchema>;
export type SynthesisModelOutput = z.infer<typeof synthesisModelOutputSchema>;

const forbiddenRecommendations = [
  /(?:^|[.!?]\s+|")\s*(?:buy|sell|hold)\s+/i,
  /\b(?:a|an)\s+(?:buy|sell|hold)\b|\b(?:buy|sell|hold)\s+(?:rating|recommendation|signal|opportunity)\b/i,
  /\b(?:you|investors?|shareholders?|readers?)\s+(?:should|must|can|could|need(?:s)?\s+to|ought\s+to|may\s+want\s+to)\s+(?:consider\s+)?(?:buy(?:ing)?|purchase|purchasing|acquire|acquiring|sell(?:ing)?|dispose|disposing|exit|exiting|add|adding|trim|trimming|hold(?:ing)?)\b/i,
  /(?:^|[.!?]\s+|")\s*(?:consider\s+(?:buying|purchasing|acquiring|selling|disposing\s+of|exiting|adding\s+to|trimming|holding)\s+(?:(?:the|this|these|more|some|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation)|avoid\s+(?:(?:the|this|these|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation))\b/i,
  /\b(?:it\s+)?(?:may|would|could)\s+be\s+(?:wise|prudent|advisable|appropriate)\s+to\s+(?:buy|purchase|acquire|sell|dispose\s+of|exit|add\s+to|trim|hold)\s+(?:(?:the|this|these|more|some|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation)\b/i,
  /(?:^|[.!?]\s+|")\s*place\s+(?:a|an|the|your)\s+(?:(?:limit|market)\s+)?order\s+to\s+(?:buy|purchase|acquire|sell|dispose\s+of|exit|add\s+to|trim)\s+(?:(?:the|this|these|more|some|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation)\b/i,
  /(?:^|[.!?]\s+|")\s*(?:(?:purchase|acquire)\s+|(?:dispose\s+of|exit|add\s+to|trim)\s+)(?:(?:the|this|these|more|some|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation)\b/i,
  /\b(?:buying|purchasing|acquiring|selling|disposing\s+of|exiting|adding\s+to|trimming)\s+(?:(?:the|this|these|more|some|your)\s+)?(?:stock|shares?|position|holding|exposure|allocation)\b[^.!?]{0,60}\b(?:attractive|advisable|recommended|wise|prudent|compelling|appropriate|suitable|opportune)\b/i,
];
const forbiddenPersonalContext =
  /\b(?:given|based\s+on)\s+your\s+(?:portfolio|position|holdings?|risk\s+tolerance|financial\s+goals?|time\s+horizon)\b|\b(?:suitable|appropriate|right)\s+for\s+your\s+(?:portfolio|risk\s+tolerance|financial\s+goals?|time\s+horizon)\b/i;
const forbiddenPersonalAllocation =
  /\b(?:allocate|allocating|invest|investing|put)\b[^.!?]{0,80}\byour\s+(?:portfolio|capital|money|savings)\b|\b(?:increase|increasing|reduce|reducing|trim|trimming|exit|exiting|close|closing|add|adding)(?:\s+to)?\s+your\s+(?:position|holding|allocation|exposure)\b/i;
const forbiddenStockPriceTarget =
  /\b(?:price\s+target|target\s+price)\b|\bfair\s+value\s+(?:is|would\s+be|could\s+be|of)\s+[$€£]?\s*\d[\d,.]*\s+per\s+share\b/i;
const forbiddenStockPricePredictions = [
  /\b(?:stocks?|(?<!per\s)shares?)\s+(?:will|would|should|could|may|(?:is|are)\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:rise|fall|reach|hit|trade(?:\s+at)?|be\s+worth|outperform|underperform)\b/i,
  /\b(?:stock|share)\s+price\s+(?:will|would|should|could|may|is\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:rise|fall|increase|decrease|reach|hit|trade(?:\s+at)?|be\s+worth|outperform|underperform)\b/i,
  /\b(?:stocks?|shares?)\s+(?:will|would|should|could|may|(?:is|are)\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:increase|decrease)\s+(?:in\s+(?:price|value)|to\s+[$€£]?\d)\b/i,
  /(?:^|[.!?]\s+|")\s*(?:the\s+)?price\s+(?:will|would|should|could|may|is\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:rise|fall|increase|decrease|reach|hit|trade(?:\s+at)?|be\s+worth)\b/i,
  /\b(?!(?:EPS|GAAP|EBIT|EBITDA|FCF)\b)[A-Z]{1,5}\s+price\s+(?:will|would|should|could|may|is\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:rise|fall|increase|decrease|reach|hit|trade(?:\s+at)?|be\s+worth|outperform|underperform)\b/,
  /\b(?!(?:EPS|GAAP|EBIT|EBITDA|FCF)\b)[A-Z]{1,5}\b\s+(?:will|would|should|could|may|is\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:(?:rise|fall|outperform|underperform)\b|(?:reach|hit|trade(?:\s+at)?|be\s+worth)\s+(?:(?:[$€£]\s*)\d[\d,.]*\b(?!\s*(?:thousand|million|billion|trillion|in\s+(?:revenue|sales|earnings|EPS|cash\s+flow))\b)|\d[\d,.]*\s*(?:dollars?|USD)\b))/,
  /\b(?:predict|predicts|predicted|predicting|prediction|forecast|forecasts|forecasted|forecasting|project|projects|projected|projecting|projection|expected)\b[^.!?]{0,80}\b(?:stock|share)\s+price\b/i,
  /\b(?:stock|share)\s+price\b[^.!?]{0,80}\b(?:prediction|projection|forecast)\b/i,
];

export class ModelOutputSafetyError extends Error {
  readonly code = "AI_UNSAFE_OUTPUT";

  constructor(message: string) {
    super(message);
    this.name = "ModelOutputSafetyError";
  }
}

function collectStringLeaves(value: unknown) {
  const leaves: string[] = [];
  const pending = [value];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      leaves.push(current);
      continue;
    }
    if (current === null || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);

    try {
      for (const descriptor of Object.values(
        Object.getOwnPropertyDescriptors(current),
      )) {
        if (descriptor.enumerable && "value" in descriptor) {
          pending.push(descriptor.value);
        }
      }
    } catch {
      continue;
    }
  }

  return leaves;
}

export function getModelOutputSafetyIssue(output: unknown) {
  const leaves = collectStringLeaves(output);

  if (
    leaves.some((value) =>
      forbiddenRecommendations.some((pattern) => pattern.test(value)),
    )
  ) {
    return "The generated output contained a prohibited investment action.";
  }
  if (
    leaves.some(
      (value) =>
        forbiddenPersonalContext.test(value) ||
        forbiddenPersonalAllocation.test(value),
    )
  ) {
    return "The generated output contained prohibited personalized investment instructions.";
  }
  if (
    leaves.some(
      (value) =>
        forbiddenStockPriceTarget.test(value) ||
        forbiddenStockPricePredictions.some((pattern) => pattern.test(value)),
    )
  ) {
    return "The generated output contained a prohibited stock-price target or prediction.";
  }
  return null;
}

export function validateGroundedOutput<T extends SpecialistModelOutput>(
  output: T,
  evidence: ResearchEvidence[],
) {
  const allowed = new Set(evidence.map((item) => item.id));
  const safetyIssue = getModelOutputSafetyIssue(output);
  if (safetyIssue) throw new ModelOutputSafetyError(safetyIssue);

  const claimKeys = new Set<string>();
  for (const claim of output.claims) {
    const key = claimKey(claim);
    if (claimKeys.has(key)) {
      throw new ModelOutputSafetyError(
        "The generated output repeated a material claim.",
      );
    }
    claimKeys.add(key);
    const references = [...claim.evidenceIds, ...claim.counterEvidenceIds];
    if (new Set(references).size !== references.length) {
      throw new ModelOutputSafetyError(
        "A claim repeated the same evidence reference.",
      );
    }
    if (references.some((reference) => !allowed.has(reference))) {
      throw new ModelOutputSafetyError(
        "A claim referenced evidence outside the supplied snapshot.",
      );
    }
  }
  return output;
}

export function stableHash(value: unknown) {
  const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (
      nestedValue === null ||
      typeof nestedValue !== "object" ||
      Array.isArray(nestedValue)
    ) {
      return nestedValue;
    }

    const record = nestedValue as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
  if (serialized === undefined) {
    throw new TypeError("Stable hashes require a JSON-serializable value.");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

export function evidenceId(value: unknown) {
  return `ev_${stableHash(value).slice(0, 16)}`;
}

export function claimKey(claim: Pick<ModelClaim, "category" | "statement">) {
  const normalized = claim.statement
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
  return stableHash({ category: claim.category, statement: normalized }).slice(
    0,
    24,
  );
}
