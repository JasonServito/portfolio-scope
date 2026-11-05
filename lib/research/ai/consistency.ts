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
 * matches a period ending in 2025), form types, quarter labels, and periodic
 * report section labels ("Part II", "Item 1A", "Item 7") are not values, and
 * "negative" or the Unicode minus is read as a sign. A Form 8-K item code such
 * as "Item 2.02" stays a checked value, because the cited current-report
 * excerpt states it.
 *
 * A claim number that is not an exact cited value is still supported when it
 * is a correct rounding of one at the precision the claim states, after
 * converting thousand/million/billion/trillion to the claim's scale, so
 * "$71.3 billion" matches "71,340,000,000 USD". The rounding keeps the sign
 * and the percent unit, never adds precision, and needs at least two
 * significant digits, so "0.7" does not stand in for 0.66.
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
const NON_VALUE_LABEL_PATTERN =
  /\b(?:10-K|10-Q|8-K|20-F|6-K|40-F|Q[1-4]|Part\s+(?:IV|I{1,3})|Items?\s+\d{1,2}[A-D]?(?!\.?\d))\b/gi;
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

const UNIT_SCALE: Record<string, number> = {
  "": 1,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};
const MIN_ROUNDED_SIGNIFICANT_DIGITS = 2;

type StatedNumber = {
  token: string;
  value: number;
  unit: string;
  decimals: number;
  significantDigits: number;
};

/** Decimal places and significant digits as written; integer trailing zeros are not significant. */
function writtenPrecision(numeric: string) {
  const [whole, fraction = ""] = numeric.replace(/^[-+]/, "").split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  return {
    decimals: fraction.length,
    significantDigits: fraction
      ? digits.length
      : digits.replace(/0+$/, "").length,
  };
}

function readNumbers(value: string) {
  const { stripped, tokens: dates } = extractDates(
    value.replaceAll("−", "-").replaceAll(NEGATIVE_WORD_PATTERN, "-"),
  );
  const residual = stripped.replaceAll(NON_VALUE_LABEL_PATTERN, " ");
  const numbers: StatedNumber[] = [];
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
      ...writtenPrecision(numeric),
    });
  }
  return { dates, numbers };
}

/** Numeric tokens normalized to `${number}${unit}`, e.g. `6.4%` or `-31796000000`, plus whole dates. */
export function numericTokens(value: string) {
  const { dates, numbers } = readNumbers(value);
  for (const number of numbers) dates.add(number.token);
  return dates;
}

/** Whether the stated number is the cited value rounded to the stated precision. */
function roundsCitedValue(stated: StatedNumber, cited: StatedNumber) {
  if (stated.significantDigits < MIN_ROUNDED_SIGNIFICANT_DIGITS) return false;
  if ((stated.unit === "%") !== (cited.unit === "%")) return false;
  const citedInStatedUnit =
    stated.unit === "%"
      ? cited.value
      : (cited.value * UNIT_SCALE[cited.unit]) / UNIT_SCALE[stated.unit];
  const halfStep = 0.5 * 10 ** -stated.decimals;
  return Math.abs(citedInStatedUnit - stated.value) <= halfStep * (1 + 1e-9);
}

/** Numeric tokens in the claim statement that no cited supporting excerpt states or rounds to. */
export function unsupportedNumericTokens(
  claim: Pick<ModelClaim, "statement" | "evidenceIds">,
  evidenceById: ReadonlyMap<string, Pick<ResearchEvidence, "excerpt">>,
) {
  const stated = readNumbers(claim.statement);
  if (stated.dates.size === 0 && stated.numbers.length === 0) return [];
  const citedTokens = new Set<string>();
  const citedNumbers: StatedNumber[] = [];
  for (const evidenceId of claim.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) continue;
    const cited = readNumbers(evidence.excerpt);
    for (const token of cited.dates) citedTokens.add(token);
    for (const number of cited.numbers) {
      citedTokens.add(number.token);
      citedNumbers.push(number);
    }
  }
  const unsupported = new Set<string>();
  for (const token of stated.dates) {
    if (!citedTokens.has(token)) unsupported.add(token);
  }
  for (const number of stated.numbers) {
    if (
      citedTokens.has(number.token) ||
      citedNumbers.some((cited) => roundsCitedValue(number, cited))
    ) {
      continue;
    }
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

export type OutputConsistencyIssue = {
  /** A fixed application string, safe to log. */
  message: string;
  /**
   * For claim-level failures, every failing claim (numbered from 1) and its
   * exact unsupported number tokens, so the single repair can fix them all.
   * It repeats model numbers, so it goes only into the repair request and is
   * never logged.
   */
  repairDetail: string | null;
};

const MAX_REPAIR_TOKENS_PER_CLAIM = 8;

/**
 * Returns the first consistency failure for a grounded output, or null. The
 * caller has already verified that every cited id is inside the supplied
 * evidence, so a missing map entry here is treated as an unsupported number.
 */
export function getOutputConsistencyIssue(
  output: GroundedModelOutput & { availability?: AgentAvailability },
  evidence: readonly ResearchEvidence[],
): OutputConsistencyIssue | null {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  let message: string | null = null;
  const failingClaims: string[] = [];
  for (const [index, claim] of output.claims.entries()) {
    const tokens = unsupportedNumericTokens(claim, evidenceById);
    if (tokens.length > 0) {
      message ??=
        "A claim stated a number that does not appear with the same unit in its cited supporting evidence.";
      failingClaims.push(
        `claim ${index + 1} states ${tokens.slice(0, MAX_REPAIR_TOKENS_PER_CLAIM).join(", ")}, which its cited supporting excerpts do not contain`,
      );
    }
    if (
      claim.kind === "DERIVED" &&
      !claim.evidenceIds.some(
        (id) => evidenceById.get(id)?.sourceKind === "DERIVED",
      )
    ) {
      message ??=
        "A claim labeled DERIVED does not cite a derived evidence item.";
      failingClaims.push(
        `claim ${index + 1} is labeled DERIVED but cites no DERIVED evidence`,
      );
    }
  }
  if (message) return { message, repairDetail: failingClaims.join("; ") };
  if (!ratingAgreesWithClaims(output.rating, output.claims)) {
    return {
      message: `The ${output.rating} rating does not agree with the claim categories.`,
      repairDetail: null,
    };
  }
  if (
    output.availability !== undefined &&
    !availabilityAgreesWithClaims(output.availability, output.claims)
  ) {
    return {
      message:
        output.availability === "NOT_AVAILABLE"
          ? "A NOT_AVAILABLE specialist must not return claims."
          : "A specialist with no claims must report NOT_AVAILABLE.",
      repairDetail: null,
    };
  }
  return null;
}
