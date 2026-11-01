/**
 * Form 8-K current reports (M32).
 *
 * The submissions feed lists every 8-K with its item codes. Research keeps
 * the reports filed in the last twelve months as dated event evidence, and
 * for an Item 2.02 results filing it fetches the Exhibit 99.1 press release
 * named on the filing's index page. Nothing here touches 10-K or 10-Q
 * handling, and no other exhibit or form is read.
 */

export const CURRENT_REPORT_FORM_TYPE = "8-K";
export const RESULTS_ITEM_CODE = "2.02";
export const PRESS_RELEASE_EXHIBIT_TYPE = "EX-99.1";
export const CURRENT_REPORT_WINDOW_DAYS = 365;

export function isCurrentReportForm(formType: string) {
  return /^8-K(?:\/A)?$/.test(formType);
}

/** Midnight UTC twelve months before the given moment. */
export function currentReportWindowStart(asOf: Date) {
  const start = new Date(asOf);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - CURRENT_REPORT_WINDOW_DAYS);
  return start;
}

/** Parses the feed's comma-separated item string ("2.02,9.01") into codes. */
export function parseItemCodes(value: string | null | undefined) {
  if (!value) return [];
  const codes: string[] = [];
  for (const part of value.split(",")) {
    const code = part.trim();
    if (/^\d{1,2}\.\d{2}$/.test(code) && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Item titles from the Form 8-K instructions, used only to label codes. */
const ITEM_TITLES: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.04": "Mine Safety - Reporting of Shutdowns and Patterns of Violations",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03":
    "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement",
  "2.04":
    "Triggering Events That Accelerate or Increase a Direct Financial Obligation",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01":
    "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements",
  "5.01": "Changes in Control of Registrant",
  "5.02":
    "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements",
  "5.03": "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year",
  "5.04": "Temporary Suspension of Trading Under Employee Benefit Plans",
  "5.05": "Amendment to or Waiver of the Code of Ethics",
  "5.06": "Change in Shell Company Status",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "6.01": "ABS Informational and Computational Material",
  "6.02": "Change of Servicer or Trustee",
  "6.03": "Change in Credit Enhancement or Other External Support",
  "6.04": "Failure to Make a Required Distribution",
  "6.05": "Securities Act Updating Disclosure",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

/** "2.02 (Results of Operations and Financial Condition)", or the bare code when it is not a known item. */
export function describeItemCode(code: string) {
  const title = ITEM_TITLES[code];
  return title ? `${code} (${title})` : code;
}

const TABLE_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const TABLE_CELL = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const LINK_HREF = /href\s*=\s*["']([^"']+)["']/i;
const DOCUMENT_NAME = /^[A-Za-z0-9._-]+\.(?:htm|html|txt)$/i;

function cellText(cell: string) {
  return cell
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&(?:nbsp|#160);/gi, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function documentNameFrom(cell: string) {
  // The Document column links the file; an inline-XBRL link is routed
  // through the viewer ("/ix?doc=/Archives/.../file.htm"), so the file name
  // is the last path segment either way.
  const href = LINK_HREF.exec(cell)?.[1] ?? "";
  const candidates = [href.split(/[?#]/).at(-1) ?? "", href, cellText(cell)];
  for (const candidate of candidates) {
    const name = candidate.split("/").at(-1)?.trim() ?? "";
    if (DOCUMENT_NAME.test(name)) return name;
  }
  return null;
}

function normalizeExhibitType(value: string) {
  return value.toUpperCase().replace(/\.0+(\d)$/, ".$1");
}

/**
 * Finds the document name of the first exhibit of the given type on an
 * EDGAR filing index page ("{accession}-index.html"). The page lists each
 * document in a row of sequence, description, document link, type, and
 * size; the type column carries the exhibit type as filed. A press release
 * some filers label with the bare "EX-99" is accepted only when no
 * "EX-99.1" row exists. Returns null when the filing has no such exhibit,
 * which is recorded as an explicit missing state rather than guessed from
 * file names.
 */
export function findExhibitDocument(
  indexHtml: string,
  exhibitType: string = PRESS_RELEASE_EXHIBIT_TYPE,
) {
  const wanted = normalizeExhibitType(exhibitType);
  const fallbackType = wanted === "EX-99.1" ? "EX-99" : null;
  let fallback: string | null = null;
  for (const row of indexHtml.matchAll(TABLE_ROW)) {
    const cells = [...row[1].matchAll(TABLE_CELL)].map((match) => match[1]);
    if (cells.length < 4) continue;
    const type = normalizeExhibitType(cellText(cells[3]));
    const name = type === wanted || type === fallbackType ? documentNameFrom(cells[2]) : null;
    if (!name) continue;
    if (type === wanted) return name;
    fallback ??= name;
  }
  return fallback;
}
