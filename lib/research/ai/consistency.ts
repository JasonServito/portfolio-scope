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
 *
 * A claim may round a cited number for readability ("$416.2 billion" for
 * 416,161,000,000 USD, "23%" for 22.7 percent) when the rounding is correct,
 * the unit family matches, and at least two significant digits remain, so
 * "0.7" for 0.66 or "400 billion" for 391 billion is still rejected.
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

type ParsedNumber = {
  token: string;
  value: number;
  unit: string;
  decimals: number;
  significantDigits: number;
};

const UNIT_SCALE: Record<string, number> = {
  "": 1,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

/** Digits that carry precision; trailing zeros of a whole number do not. */
function significantDigits(numeric: string) {
  const unsigned = numeric.replace(/^[-+]/, "");
  const digits = unsigned.replace(".", "").replace(/^0+/, "");
  return unsigned.includes(".")
    ? digits.length
    : digits.replace(/0+$/, "").length;
}

function parseValues(value: string) {
  const { stripped, tokens: dates } = extractDates(
    value.replaceAll("−", "-").replaceAll(NEGATIVE_WORD_PATTERN, "-"),
  );
  const residual = stripped.replaceAll(NON_VALUE_LABEL_PATTERN, " ");
  const numbers: ParsedNumber[] = [];
  for (const match of residual.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const numeric = raw
      .replaceAll(/[$€£,]/g, "")
      .match(/[-+]?\d+(?:\.\d+)?/)?.[0];
    if (!numeric) continue;
    const number = Number(numeric);
    if (!Number.isFinite(number)) continue;
    const unit = canonicalUnit(raw);
    numbers.push({
      token: `${number}${unit}`,
      value: number,
      unit,
      decimals: numeric.split(".")[1]?.length ?? 0,
      significantDigits: significantDigits(numeric),
    });
  }
  return { dates, numbers };
}

/** Numeric tokens normalized to `${number}${unit}`, e.g. `6.4%` or `-31796000000`, plus whole dates. */
export function numericTokens(value: string) {
  const { dates, numbers } = parseValues(value);
  for (const number of numbers) dates.add(number.token);
  return dates;
}

/**
 * Whether the claim number is the cited number rounded to the precision the
 * claim shows. Percentages only round percentages; amounts may change scale.
 */
function roundsFrom(claim: ParsedNumber, cited: ParsedNumber) {
  if (claim.significantDigits < 2) return false;
  if ((claim.unit === "%") !== (cited.unit === "%")) return false;
  const claimScale = UNIT_SCALE[claim.unit] ?? 1;
  const citedScale = UNIT_SCALE[cited.unit] ?? 1;
  const halfStep = 0.5 * 10 ** -claim.decimals * claimScale;
  const difference = Math.abs(
    cited.value * citedScale - claim.value * claimScale,
  );
  return difference <= halfStep * (1 + 1e-9);
}

/** Numeric tokens in the claim statement absent from every cited supporting excerpt. */
export function unsupportedNumericTokens(
  claim: Pick<ModelClaim, "statement" | "evidenceIds">,
  evidenceById: ReadonlyMap<string, Pick<ResearchEvidence, "excerpt">>,
) {
  const claimValues = parseValues(claim.statement);
  if (claimValues.dates.size === 0 && claimValues.numbers.length === 0) {
    return [];
  }
  const citedTokens = new Set<string>();
  const citedNumbers: ParsedNumber[] = [];
  for (const evidenceId of claim.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) continue;
    const cited = parseValues(evidence.excerpt);
    for (const token of cited.dates) citedTokens.add(token);
    for (const number of cited.numbers) {
      citedTokens.add(number.token);
      citedNumbers.push(number);
    }
  }
  const unsupported = new Set<string>();
  for (const token of claimValues.dates) {
    if (!citedTokens.has(token)) unsupported.add(token);
  }
  for (const number of claimValues.numbers) {
    if (citedTokens.has(number.token)) continue;
    if (citedNumbers.some((cited) => roundsFrom(number, cited))) continue;
    unsupported.add(number.token);
  }
  return [...unsupported];
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
      return "A claim stated a number that does not appear with the same unit in its cited supporting evidence, even after rounding.";
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
