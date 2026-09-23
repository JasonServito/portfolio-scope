import type {
  GroundedModelOutput,
  ModelClaim,
  ResearchEvidence,
} from "@/lib/research/ai/schemas";
import type { AgentAvailability, ResearchRating } from "@/lib/research/types";

/**
 * Deterministic consistency rules applied to every validated model output at
 * runtime and reused by the offline evaluation. They compare the output with
 * itself and with the cited excerpts only; they never consult the model.
 *
 * A unit suffix must end at a word boundary so a date such as "2026-06-27
 * balance" is not read as "27 billion". Dates are compared as whole dates plus
 * their year (so "September 27, 2025" matches "2025-09-27" and "FY2025"
 * matches a period ending in 2025), form types and quarter labels are not
 * values, and "negative" or the Unicode minus is read as a sign.
 */
const NUMBER_PATTERN =
  /[-+]?(?:[$€£])?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|(?:percent|thousand|million|billion|trillion|bn|tn|k|m|b)(?![a-z])))?/gi;
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const LONG_DATE_PATTERN = new RegExp(
  `\\b(${MONTH_NAMES.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,
  "gi",
);
const NON_VALUE_LABEL_PATTERN = /\b(?:10-K|10-Q|8-K|20-F|6-K|40-F|Q[1-4])\b/gi;
const NEGATIVE_WORD_PATTERN = /\bnegative\s+(?=[$€£]?\d)/gi;

/** Replaces each date with a space and returns its whole-date and year tokens. */
function extractDates(value: string) {
  const tokens = new Set<string>();
  const stripped = value
    .replaceAll(ISO_DATE_PATTERN, (_match, year, month, day) => {
      tokens.add(`${year}-${month}-${day}`);
      tokens.add(year);
      return " ";
    })
    .replaceAll(LONG_DATE_PATTERN, (_match, month: string, day, year) => {
      const index = MONTH_NAMES.indexOf(month.toLowerCase()) + 1;
      tokens.add(
        `${year}-${String(index).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
      tokens.add(year);
      return " ";
    });
  return { stripped, tokens };
}

function canonicalUnit(raw: string) {
  const value = raw.toLowerCase().replaceAll(/\s+/g, "");
  if (value.endsWith("%") || value.endsWith("percent")) return "%";
  if (value.endsWith("thousand") || value.endsWith("k")) return "thousand";
  if (value.endsWith("million") || value.endsWith("m")) return "million";
  if (
    value.endsWith("billion") ||
    value.endsWith("bn") ||
    value.endsWith("b")
  ) {
    return "billion";
  }
  if (value.endsWith("trillion") || value.endsWith("tn")) return "trillion";
  return "";
}

/** Numeric tokens normalized to `${number}${unit}`, e.g. `6.4%` or `-31796000000`, plus whole dates. */
export function numericTokens(value: string) {
  const { stripped, tokens } = extractDates(
    value.replaceAll("−", "-").replaceAll(NEGATIVE_WORD_PATTERN, "-"),
  );
  const residual = stripped.replaceAll(NON_VALUE_LABEL_PATTERN, " ");
  for (const match of residual.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const numeric = raw
      .replaceAll(/[$€£,]/g, "")
      .match(/[-+]?\d+(?:\.\d+)?/)?.[0];
    if (!numeric) continue;
    const number = Number(numeric);
    if (!Number.isFinite(number)) continue;
    tokens.add(`${number}${canonicalUnit(raw)}`);
  }
  return tokens;
}

/** Numeric tokens in the claim statement absent from every cited supporting excerpt. */
export function unsupportedNumericTokens(
  claim: Pick<ModelClaim, "statement" | "evidenceIds">,
  evidenceById: ReadonlyMap<string, Pick<ResearchEvidence, "excerpt">>,
) {
  const claimNumbers = numericTokens(claim.statement);
  if (claimNumbers.size === 0) return [];
  const cited = new Set<string>();
  for (const evidenceId of claim.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) continue;
    for (const token of numericTokens(evidence.excerpt)) cited.add(token);
  }
  return [...claimNumbers].filter((token) => !cited.has(token));
}

export function claimMix(claims: readonly Pick<ModelClaim, "category">[]) {
  return {
    supportive: claims.filter((claim) => claim.category === "SUPPORTIVE")
      .length,
    counterpoint: claims.filter((claim) => claim.category === "COUNTERPOINT")
      .length,
    risk: claims.filter((claim) => claim.category === "RISK").length,
  };
}

/**
 * A rating must not contradict the claim categories: BULLISH needs a
 * supportive claim, BEARISH a counterpoint or risk claim, MIXED both. NEUTRAL
 * carries no lean and is the only rating consistent with zero claims.
 */
export function ratingAgreesWithClaims(
  rating: ResearchRating,
  claims: readonly Pick<ModelClaim, "category">[],
) {
  const mix = claimMix(claims);
  const negative = mix.counterpoint + mix.risk;
  switch (rating) {
    case "BULLISH":
      return mix.supportive > 0;
    case "BEARISH":
      return negative > 0;
    case "MIXED":
      return mix.supportive > 0 && negative > 0;
    case "NEUTRAL":
      return true;
  }
}

/** The rating the deterministic fallback assigns to a validated claim set. */
export function ratingForClaims(
  claims: readonly Pick<ModelClaim, "category">[],
): ResearchRating {
  const mix = claimMix(claims);
  return mix.supportive > 0 && mix.counterpoint + mix.risk > 0
    ? "MIXED"
    : "NEUTRAL";
}

export function availabilityAgreesWithClaims(
  availability: AgentAvailability,
  claims: readonly unknown[],
) {
  return availability === "NOT_AVAILABLE"
    ? claims.length === 0
    : claims.length > 0;
}

/**
 * Returns the first consistency failure for a grounded output, or null. The
 * caller has already verified that every cited id is inside the supplied
 * evidence, so a missing map entry here is treated as an unsupported number.
 */
export function getOutputConsistencyIssue(
  output: GroundedModelOutput & { availability?: AgentAvailability },
  evidence: readonly ResearchEvidence[],
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  for (const claim of output.claims) {
    if (unsupportedNumericTokens(claim, evidenceById).length > 0) {
      return "A claim stated a number that does not appear with the same unit in its cited supporting evidence.";
    }
    if (
      claim.kind === "DERIVED" &&
      !claim.evidenceIds.some(
        (id) => evidenceById.get(id)?.sourceKind === "DERIVED",
      )
    ) {
      return "A claim labeled DERIVED does not cite a derived evidence item.";
    }
  }
  if (!ratingAgreesWithClaims(output.rating, output.claims)) {
    return `The ${output.rating} rating does not agree with the claim categories.`;
  }
  if (
    output.availability !== undefined &&
    !availabilityAgreesWithClaims(output.availability, output.claims)
  ) {
    return output.availability === "NOT_AVAILABLE"
      ? "A NOT_AVAILABLE specialist must not return claims."
      : "A specialist with no claims must report NOT_AVAILABLE.";
  }
  return null;
}
