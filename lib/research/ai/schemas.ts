import { createHash } from "node:crypto";

import { z } from "zod";

import { getOutputConsistencyIssue } from "@/lib/research/ai/consistency";

export const evidenceSourceKindSchema = z.enum([
  "SEC_FACT",
  "SEC_FILING",
  "COMPANY_PROFILE",
  "PEER_SET",
  "DETERMINISTIC",
  "DERIVED",
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

export const researchClaimKindSchema = z.enum([
  "FACT",
  "DERIVED",
  "INTERPRETATION",
]);

export const agentAvailabilitySchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "NOT_AVAILABLE",
]);

export const modelClaimSchema = z
  .object({
    category: z.enum(["SUPPORTIVE", "COUNTERPOINT", "RISK"]),
    kind: researchClaimKindSchema,
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

export const specialistModelOutputSchema = z
  .object({ ...commonModelOutput, availability: agentAvailabilitySchema })
  .strict();

export const synthesisModelOutputSchema = z
  .object({
    ...commonModelOutput,
    disagreements: z.array(z.string().trim().min(1).max(600)).max(10),
    whatWouldChange: z.array(z.string().trim().min(1).max(600)).max(6),
  })
  .strict();

export type SpecialistModelOutput = z.infer<typeof specialistModelOutputSchema>;
export type SynthesisModelOutput = z.infer<typeof synthesisModelOutputSchema>;
/** The fields every grounded output shares; the runner validates against these. */
export type GroundedModelOutput = Omit<SpecialistModelOutput, "availability">;

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
  // A share count ("diluted shares would fall") is not a share price.
  /\b(?:stocks?|(?<!per\s|(?:diluted|basic|weighted[- ]average)\s)shares?)\s+(?:will|would|should|could|may|(?:is|are)\s+(?:expected|likely|projected|forecast)\s+to)\s+(?:rise|fall|reach|hit|trade(?:\s+at)?|be\s+worth|outperform|underperform)\b/i,
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

  /**
   * repairDetail quotes the flagged model text for the repair request only;
   * it is never logged.
   */
  constructor(
    message: string,
    readonly repairDetail: string | null = null,
  ) {
    super(message);
    this.name = "ModelOutputSafetyError";
  }
}

/**
 * A schema-valid, safely cited output whose numbers, rating, or availability
 * disagree with its own claims or cited excerpts. The message is a fixed
 * application string for logs; repairDetail names the failing claims and
 * number tokens for the repair request only.
 */
export class ModelOutputConsistencyError extends Error {
  readonly code = "AI_INCONSISTENT_OUTPUT";

  constructor(
    message: string,
    readonly repairDetail: string | null = null,
  ) {
    super(message);
    this.name = "ModelOutputConsistencyError";
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

const SAFETY_PATTERNS = [
  ...forbiddenRecommendations,
  forbiddenPersonalContext,
  forbiddenPersonalAllocation,
  forbiddenStockPriceTarget,
  ...forbiddenStockPricePredictions,
];

/** The first model phrase a safety pattern matched, so a repair can reword it. */
function flaggedSafetyPhrase(output: unknown) {
  for (const value of collectStringLeaves(output)) {
    for (const pattern of SAFETY_PATTERNS) {
      const match = value.match(pattern);
      if (match) return match[0].trim().slice(0, 120);
    }
  }
  return null;
}

/**
 * Drops a repeated citation inside one claim: an id listed twice, or listed
 * as both supporting and counter evidence, where it stays supporting so the
 * number check still reads its excerpt. A repeated id cites nothing new, so
 * removing it changes no claim and no grounding; every remaining id is still
 * checked by validateGroundedOutput.
 */
export function withDistinctClaimReferences<T extends GroundedModelOutput>(
  output: T,
): T {
  return {
    ...output,
    claims: output.claims.map((claim) => {
      const evidenceIds = [...new Set(claim.evidenceIds)];
      return {
        ...claim,
        evidenceIds,
        counterEvidenceIds: [...new Set(claim.counterEvidenceIds)].filter(
          (id) => !evidenceIds.includes(id),
        ),
      };
    }),
  };
}

const MAX_CLAIM_EVIDENCE_IDS = 6;

/**
 * A passage of a Form 8-K (its item text or press release) does not itself
 * state the filing date or item codes; the dated current-report item of the
 * same filing does. When a claim cites such a passage but not that filing's
 * dated item, and the item was supplied to the same call, the item is added
 * as a supporting citation, so the date and item codes the claim states are
 * checked against the filing's own record rather than rejected. No other
 * citation is added, and the number check stays exactly as strict.
 */
export function withCitedCurrentReportItems<T extends GroundedModelOutput>(
  output: T,
  evidence: readonly ResearchEvidence[],
): T {
  const itemByAccession = new Map<string, string>();
  for (const item of evidence) {
    if (item.metadata.evidenceType === "SEC_CURRENT_REPORT" && item.accessionNumber) {
      itemByAccession.set(item.accessionNumber, item.id);
    }
  }
  if (itemByAccession.size === 0) return output;
  const passageItem = new Map<string, string>();
  for (const item of evidence) {
    const reportItem = item.accessionNumber
      ? itemByAccession.get(item.accessionNumber)
      : undefined;
    if (item.metadata.evidenceType === "SEC_FILING_PASSAGE" && reportItem) {
      passageItem.set(item.id, reportItem);
    }
  }
  return {
    ...output,
    claims: output.claims.map((claim) => {
      const evidenceIds = [...claim.evidenceIds];
      for (const id of claim.evidenceIds) {
        const reportItem = passageItem.get(id);
        if (
          reportItem &&
          !evidenceIds.includes(reportItem) &&
          evidenceIds.length < MAX_CLAIM_EVIDENCE_IDS
        ) {
          evidenceIds.push(reportItem);
        }
      }
      return evidenceIds.length === claim.evidenceIds.length
        ? claim
        : { ...claim, evidenceIds };
    }),
  };
}

export function validateGroundedOutput<T extends GroundedModelOutput>(
  output: T,
  evidence: ResearchEvidence[],
) {
  const allowed = new Set(evidence.map((item) => item.id));
  const safetyIssue = getModelOutputSafetyIssue(output);
  if (safetyIssue) {
    throw new ModelOutputSafetyError(safetyIssue, flaggedSafetyPhrase(output));
  }

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
  const consistencyIssue = getOutputConsistencyIssue(output, evidence);
  if (consistencyIssue) {
    throw new ModelOutputConsistencyError(
      consistencyIssue.message,
      consistencyIssue.repairDetail,
    );
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
