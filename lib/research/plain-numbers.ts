const SCALES = [
  { size: 1e12, word: "trillion" },
  { size: 1e9, word: "billion" },
  { size: 1e6, word: "million" },
] as const;

const LARGE_USD = /(-)?\b(\d{1,3}(?:,\d{3}){2,}|\d{7,})(?:\.\d+)?\s*USD\b/g;
const PER_SHARE_USD = /(-)?\b(\d[\d,]*(?:\.\d+)?)\s*USD per share\b/g;
const SMALL_USD = /(-)?\b(\d[\d,]*(?:\.\d+)?)\s*USD\b/g;
const PERCENT_WORD = /(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*percent\b/g;

function dollars(sign: string | undefined, amount: string) {
  return `${sign ?? ""}$${amount}`;
}

/**
 * Rewrites the raw figures that filing-grounded claims carry into the form a
 * reader expects: "416,161,000,000 USD" becomes "$416.2 billion", "7.46 USD
 * per share" becomes "$7.46 per share", and "6.4 percent" becomes "6.4%".
 * Display only: the stored claim and its cited evidence keep the exact value.
 */
export function plainNumbers(text: string) {
  return text
    .replaceAll(LARGE_USD, (_match, sign: string | undefined, digits: string) => {
      const value = Number(digits.replaceAll(",", ""));
      const scale = SCALES.find((item) => value >= item.size) ?? SCALES[2];
      return dollars(sign, `${(value / scale.size).toFixed(1)} ${scale.word}`);
    })
    .replaceAll(PER_SHARE_USD, (_match, sign: string | undefined, amount: string) =>
      `${dollars(sign, amount)} per share`,
    )
    .replaceAll(SMALL_USD, (_match, sign: string | undefined, amount: string) =>
      dollars(sign, amount),
    )
    .replaceAll(PERCENT_WORD, "$1%");
}
