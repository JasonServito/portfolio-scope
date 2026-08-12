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

const forbiddenRecommendation = /\b(?:buy|sell|hold)\b/i;

export class ModelOutputSafetyError extends Error {
  readonly code = "AI_UNSAFE_OUTPUT";

  constructor(message: string) {
    super(message);
    this.name = "ModelOutputSafetyError";
  }
}

export function validateGroundedOutput<T extends SpecialistModelOutput>(
  output: T,
  evidence: ResearchEvidence[],
) {
  const allowed = new Set(evidence.map((item) => item.id));
  const serialized = JSON.stringify(output);
  if (forbiddenRecommendation.test(serialized)) {
    throw new ModelOutputSafetyError(
      "The generated output contained a prohibited investment action.",
    );
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
