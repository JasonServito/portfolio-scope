import { createHash } from "node:crypto";

import { CURRENT_REPORT_FORM_TYPE } from "@/lib/sec/current-reports";

/**
 * Heuristic section extraction for SEC 10-K and 10-Q primary documents, and
 * whole-document passages for an 8-K Exhibit 99.1 press release (M32).
 *
 * The parser converts the inline-XBRL HTML to normalized plain text, locates
 * the Item headings it needs (Item 1 Business, Item 1A Risk Factors, and Item
 * 7 MD&A in a 10-K; Item 2 MD&A in a 10-Q), and splits each bounded section
 * into passages. Every passage records its character range in the normalized
 * document text and a SHA-256 of exactly that text, so a cited excerpt can be
 * verified against the stored chunk without re-parsing the filing.
 *
 * Headings appear several times in a filing (table of contents, the section
 * itself, cross references, and sometimes repeated page headers). A candidate
 * heading wins when the text that follows it, up to the next different Item
 * heading, is the longest; a table-of-contents entry is followed almost
 * immediately by the next Item and so never wins when the section exists. A
 * cross reference that itself starts a line ("Item 1A of this Form 10-K
 * describes...") is read as a heading and ends the enclosing section early;
 * the result is a shorter section, never text from the wrong section.
 */

export const SEC_FILING_SECTION_PARSER_VERSION = "sec-filing-sections-v1";

export type FilingSectionKind =
  | "BUSINESS"
  | "RISK_FACTORS"
  | "MDA"
  | "PRESS_RELEASE";

/** The forms whose latest primary document supplies narrative evidence. */
export const FILING_TEXT_FORM_TYPES = ["10-K", "10-Q"] as const;

export const PRESS_RELEASE_SECTION_LABEL = "Exhibit 99.1 Press Release";

export type FilingSectionLimits = {
  /** Characters of one section that are chunked; the remainder is dropped and recorded as truncated. */
  maxCharsPerSection: number;
  /** A chunk closes once adding the next line would exceed this many characters. */
  targetChunkChars: number;
  /** A single line longer than this is split at sentence boundaries. */
  maxChunkChars: number;
  maxChunksPerSection: number;
  maxChunksPerFiling: number;
  /** A heading whose following text is shorter than this is a contents entry or cross reference, not the section. */
  minSectionChars: number;
  minChunkChars: number;
};

export const FILING_SECTION_LIMITS: Readonly<FilingSectionLimits> = {
  maxCharsPerSection: 60_000,
  targetChunkChars: 1_200,
  maxChunkChars: 1_600,
  maxChunksPerSection: 50,
  maxChunksPerFiling: 150,
  minSectionChars: 400,
  minChunkChars: 40,
};

// An earnings press release is a few narrative paragraphs followed by
// condensed statements; the cap keeps the narrative and the first tables.
export const PRESS_RELEASE_LIMITS: Readonly<FilingSectionLimits> = {
  maxCharsPerSection: 24_000,
  targetChunkChars: 1_200,
  maxChunkChars: 1_600,
  maxChunksPerSection: 20,
  maxChunksPerFiling: 20,
  minSectionChars: 200,
  minChunkChars: 40,
};

export type FilingSectionChunk = {
  ordinal: number;
  passageStart: number;
  passageEnd: number;
  text: string;
  sha256: string;
};

export type FilingSection = {
  kind: FilingSectionKind;
  label: string;
  /** Offset of the winning heading in the normalized document text. */
  headingStart: number;
  /** Range of the section body in the normalized document text before the character cap. */
  start: number;
  end: number;
  truncated: boolean;
  chunks: FilingSectionChunk[];
};

export type FilingSectionExtraction = {
  parserVersion: typeof SEC_FILING_SECTION_PARSER_VERSION;
  formType: string;
  /** The normalized document text every passage range refers to. */
  documentText: string;
  expectedSections: FilingSectionKind[];
  sections: FilingSection[];
  missingSections: FilingSectionKind[];
  truncatedSections: FilingSectionKind[];
  chunkCount: number;
};

type SectionDefinition = {
  kind: FilingSectionKind;
  label: string;
  heading: RegExp;
};

// A heading starts a line, may carry a "Part I" prefix, and may put its title
// on the following line when the filer renders number and title as separate
// blocks. Cross references inside a sentence never start a line.
const ITEM_PREFIX = String.raw`^[ \t]*(?:part[ \t]+[ivx]+[ \t]*[,.:\-\u2013\u2014]?[ \t]*)?item[ \t]*`;
const TITLE_SEPARATOR = String.raw`[ \t]*[.:\-\u2013\u2014]?[ \t]*(?:\n[ \t]*)?`;
const MDA_TITLE = String.raw`management['\u2019\u2018]?s?[ \t]+discussion[ \t]+and[ \t]+analysis\b`;

function headingPattern(item: string, title: string) {
  return new RegExp(`${ITEM_PREFIX}${item}${TITLE_SEPARATOR}${title}`, "gim");
}

const ANY_ITEM_HEADING = new RegExp(
  `${ITEM_PREFIX}\\d{1,2}[a-c]?${TITLE_SEPARATOR}[a-z(\\[]`,
  "gim",
);

const SECTION_DEFINITIONS: Record<"10-K" | "10-Q", SectionDefinition[]> = {
  "10-K": [
    {
      kind: "BUSINESS",
      label: "Item 1. Business",
      heading: headingPattern("1", String.raw`business\b`),
    },
    {
      kind: "RISK_FACTORS",
      label: "Item 1A. Risk Factors",
      heading: headingPattern("1a", String.raw`risk[ \t]+factors\b`),
    },
    {
      kind: "MDA",
      label: "Item 7. Management's Discussion and Analysis",
      heading: headingPattern("7", MDA_TITLE),
    },
  ],
  "10-Q": [
    {
      kind: "MDA",
      label: "Item 2. Management's Discussion and Analysis",
      heading: headingPattern("2", MDA_TITLE),
    },
  ],
};

export function expectedFilingSectionKinds(formType: string): FilingSectionKind[] {
  if (formType === CURRENT_REPORT_FORM_TYPE) return ["PRESS_RELEASE"];
  const definitions = SECTION_DEFINITIONS[formType as "10-K" | "10-Q"];
  return definitions ? definitions.map((definition) => definition.kind) : [];
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  ndash: "\u2013",
  mdash: "\u2014",
  minus: "\u2212",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  trade: "\u2122",
  reg: "\u00ae",
  copy: "\u00a9",
  sect: "\u00a7",
  para: "\u00b6",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  cent: "\u00a2",
  pound: "\u00a3",
  euro: "\u20ac",
  yen: "\u00a5",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  prime: "\u2032",
  Prime: "\u2033",
  shy: "",
  zwj: "",
  zwnj: "",
};

function decodeCodePoint(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return "";
  if (value >= 0xd800 && value <= 0xdfff) return "";
  return String.fromCodePoint(value);
}

function decodeEntities(value: string) {
  return value
    .replaceAll(/&#x([0-9a-f]{1,6});/gi, (_match, hex: string) =>
      decodeCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll(/&#(\d{1,7});/g, (_match, decimal: string) =>
      decodeCodePoint(Number.parseInt(decimal, 10)),
    )
    .replaceAll(/&([a-z][a-z0-9]{1,8});/gi, (match, name: string) =>
      Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
    )
    .replaceAll("&amp;", "&");
}

const BLOCK_TAGS =
  /<\/?(?:p|div|li|ul|ol|tr|table|thead|tbody|tfoot|h[1-6]|section|article|hr|blockquote|pre|caption|dd|dt|dl|center)\b[^>]*>/gi;
const CELL_TAGS = /<\/?(?:td|th)\b[^>]*>/gi;
const DROPPED_ELEMENTS =
  /<(script|style|head|title|ix:header)\b[\s\S]*?<\/\1\s*>/gi;
const PAGE_NUMBER_LINE = /^\d{1,3}$/;
const PAGE_FOOTER_LINE = /\bform\s+10-[kq]\b[^\n]*\|\s*\d{1,3}$/i;
const CONTENTS_LINK_LINE = /^(?:table\s+of\s+contents|index)$/i;

function keepLine(line: string) {
  return (
    line.length > 0 &&
    !PAGE_NUMBER_LINE.test(line) &&
    !PAGE_FOOTER_LINE.test(line) &&
    !CONTENTS_LINK_LINE.test(line)
  );
}

/**
 * Converts filing HTML to normalized plain text: one trimmed line per block,
 * table cells joined by single spaces, entities decoded, scripts, styles, and
 * the hidden inline-XBRL header removed, and page numbers and running page
 * footers dropped. The output is deterministic for a given parser version.
 */
export function htmlToText(html: string) {
  const stripped = html
    .replaceAll(/<!--[\s\S]*?-->/g, " ")
    .replaceAll(DROPPED_ELEMENTS, " ")
    .replaceAll(/<\s*br\s*\/?>/gi, "\n")
    .replaceAll(BLOCK_TAGS, "\n")
    .replaceAll(CELL_TAGS, " ")
    .replaceAll(/<[^>]+>/g, "");
  const decoded = decodeEntities(stripped)
    .replaceAll("\u00a0", " ")
    .replaceAll(/[ \t\f\v\u2000-\u200a\u202f\u3000]+/g, " ");
  return decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(keepLine)
    .join("\n");
}

/**
 * Decodes a fetched primary document using its declared charset when Node
 * supports it, falling back to UTF-8 with replacement characters.
 */
export function decodeFilingDocument(body: Uint8Array, contentType: string) {
  const head = new TextDecoder("latin1").decode(body.subarray(0, 2_048));
  const declared =
    /charset=["']?([a-z0-9._-]+)/i.exec(contentType)?.[1] ??
    /charset=["']?([a-z0-9._-]+)/i.exec(head)?.[1] ??
    /encoding=["']([a-z0-9._-]+)["']/i.exec(head)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(body);
    } catch {
      // Unknown or unsupported label: fall through to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(body);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// The same whitespace definition as String.prototype.trim(), so a stored
// passage never gains or loses an edge character when it is trimmed again as
// an evidence excerpt.
function isSpace(character: string) {
  return /\s/.test(character);
}

type Range = { start: number; end: number };

function trimRange(text: string, range: Range): Range {
  let { start, end } = range;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return { start, end };
}

function linesWithin(text: string, range: Range) {
  const lines: Range[] = [];
  let cursor = range.start;
  while (cursor < range.end) {
    let lineEnd = text.indexOf("\n", cursor);
    if (lineEnd === -1 || lineEnd > range.end) lineEnd = range.end;
    const trimmed = trimRange(text, { start: cursor, end: lineEnd });
    if (trimmed.end > trimmed.start) lines.push(trimmed);
    cursor = lineEnd + 1;
  }
  return lines;
}

const SENTENCE_BOUNDARY = /[.!?]["\u201d\u2019)]?\s+(?=["\u201c(]?[A-Z])/g;

/** Splits one over-long line into sentence-packed pieces no longer than the chunk maximum. */
function splitLongLine(text: string, line: Range, maximum: number): Range[] {
  const slice = text.slice(line.start, line.end);
  const boundaries: number[] = [];
  for (const match of slice.matchAll(SENTENCE_BOUNDARY)) {
    boundaries.push(line.start + match.index + match[0].length);
  }
  const pieces: Range[] = [];
  let pieceStart = line.start;
  let lastBoundary = line.start;
  const flush = (end: number) => {
    const trimmed = trimRange(text, { start: pieceStart, end });
    if (trimmed.end > trimmed.start) pieces.push(trimmed);
    pieceStart = end;
  };
  for (const boundary of [...boundaries, line.end]) {
    if (boundary - pieceStart > maximum) {
      if (lastBoundary > pieceStart) flush(lastBoundary);
      // A single sentence longer than the maximum is hard-split at spaces.
      while (boundary - pieceStart > maximum) {
        const window = text.slice(pieceStart, pieceStart + maximum);
        const space = window.lastIndexOf(" ");
        flush(pieceStart + (space > maximum / 2 ? space : maximum));
      }
    }
    lastBoundary = boundary;
  }
  if (line.end > pieceStart) flush(line.end);
  return pieces;
}

function chunkRange(
  text: string,
  range: Range,
  limits: Readonly<FilingSectionLimits>,
  maximumChunks: number,
) {
  const chunks: FilingSectionChunk[] = [];
  let truncated = false;
  let current: Range | null = null;
  const push = (candidate: Range) => {
    if (candidate.end - candidate.start < limits.minChunkChars) return true;
    if (chunks.length >= maximumChunks) {
      truncated = true;
      return false;
    }
    const passage = text.slice(candidate.start, candidate.end);
    chunks.push({
      ordinal: chunks.length,
      passageStart: candidate.start,
      passageEnd: candidate.end,
      text: passage,
      sha256: sha256(passage),
    });
    return true;
  };
  const flush = () => {
    if (!current) return true;
    const accepted = push(current);
    current = null;
    return accepted;
  };

  for (const line of linesWithin(text, range)) {
    if (line.end > range.start + limits.maxCharsPerSection) {
      // The pending chunk ends before the cap and is kept by the final flush.
      truncated = true;
      break;
    }
    if (line.end - line.start > limits.maxChunkChars) {
      if (!flush()) break;
      let accepted = true;
      for (const piece of splitLongLine(text, line, limits.maxChunkChars)) {
        accepted = push(piece);
        if (!accepted) break;
      }
      if (!accepted) break;
      continue;
    }
    if (current && line.end - current.start > limits.targetChunkChars) {
      if (!flush()) break;
    }
    current = current ? { start: current.start, end: line.end } : { ...line };
  }
  flush();
  return { chunks, truncated };
}

type HeadingMatch = { index: number; end: number };

function matchesAt(pattern: RegExp, text: string, index: number) {
  // Sticky and multiline so the line-start anchor holds at the given offset.
  const sticky = new RegExp(pattern.source, "imy");
  sticky.lastIndex = index;
  return sticky.test(text);
}

function findSection(
  text: string,
  definition: SectionDefinition,
  itemHeadings: readonly HeadingMatch[],
  limits: Readonly<FilingSectionLimits>,
): Omit<FilingSection, "chunks" | "truncated"> | null {
  let best: { headingStart: number; start: number; end: number } | null = null;
  for (const match of text.matchAll(definition.heading)) {
    const start = match.index + match[0].length;
    // The section runs to the next Item heading of a different item, so a
    // repeated page header for the same section does not end it early.
    const boundary = itemHeadings.find(
      (heading) =>
        heading.index >= start && !matchesAt(definition.heading, text, heading.index),
    );
    const end = boundary ? boundary.index : text.length;
    if (!best || end - start > best.end - best.start) {
      best = { headingStart: match.index, start, end };
    }
  }
  if (!best) return null;
  const body = trimRange(text, { start: best.start, end: best.end });
  if (body.end - body.start < limits.minSectionChars) return null;
  return {
    kind: definition.kind,
    label: definition.label,
    headingStart: best.headingStart,
    start: body.start,
    end: body.end,
  };
}

/**
 * An 8-K press-release exhibit has no Item headings: the whole normalized
 * document is the one expected section, chunked with the same passage
 * rules, so a cited excerpt verifies against its stored chunk exactly as a
 * 10-K passage does. An exhibit too short to be a release is reported
 * missing rather than chunked.
 */
function extractPressRelease(
  html: string,
  limits: Readonly<FilingSectionLimits>,
): FilingSectionExtraction {
  const documentText = htmlToText(html);
  const body = trimRange(documentText, { start: 0, end: documentText.length });
  const chunked =
    body.end - body.start >= limits.minSectionChars
      ? chunkRange(documentText, body, limits, limits.maxChunksPerSection)
      : { chunks: [], truncated: false };
  const sections: FilingSection[] =
    chunked.chunks.length > 0
      ? [
          {
            kind: "PRESS_RELEASE",
            label: PRESS_RELEASE_SECTION_LABEL,
            headingStart: 0,
            start: body.start,
            end: body.end,
            truncated:
              chunked.truncated || body.end - body.start > limits.maxCharsPerSection,
            chunks: chunked.chunks,
          },
        ]
      : [];
  return {
    parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    formType: CURRENT_REPORT_FORM_TYPE,
    documentText,
    expectedSections: ["PRESS_RELEASE"],
    sections,
    missingSections: sections.length === 0 ? ["PRESS_RELEASE"] : [],
    truncatedSections: sections
      .filter((section) => section.truncated)
      .map((section) => section.kind),
    chunkCount: chunked.chunks.length,
  };
}

/**
 * Extracts the expected sections of a 10-K or 10-Q primary document, or the
 * press-release passages of an 8-K exhibit. An unsupported form type yields
 * no expected sections; a missing heading is reported, never guessed.
 */
export function extractFilingSections(
  html: string,
  formType: string,
  limits?: Readonly<FilingSectionLimits>,
): FilingSectionExtraction {
  if (formType === CURRENT_REPORT_FORM_TYPE) {
    return extractPressRelease(html, limits ?? PRESS_RELEASE_LIMITS);
  }
  return extractItemSections(html, formType, limits ?? FILING_SECTION_LIMITS);
}

function extractItemSections(
  html: string,
  formType: string,
  limits: Readonly<FilingSectionLimits>,
): FilingSectionExtraction {
  const documentText = htmlToText(html);
  const definitions = SECTION_DEFINITIONS[formType as "10-K" | "10-Q"] ?? [];
  const itemHeadings: HeadingMatch[] = [...documentText.matchAll(ANY_ITEM_HEADING)].map(
    (match) => ({ index: match.index, end: match.index + match[0].length }),
  );
  const perSectionChunkLimit = Math.max(
    1,
    Math.min(
      limits.maxChunksPerSection,
      Math.floor(limits.maxChunksPerFiling / Math.max(1, definitions.length)),
    ),
  );
  const sections: FilingSection[] = [];
  const missingSections: FilingSectionKind[] = [];
  for (const definition of definitions) {
    const located = findSection(documentText, definition, itemHeadings, limits);
    if (!located) {
      missingSections.push(definition.kind);
      continue;
    }
    const chunked = chunkRange(
      documentText,
      { start: located.start, end: located.end },
      limits,
      perSectionChunkLimit,
    );
    if (chunked.chunks.length === 0) {
      missingSections.push(definition.kind);
      continue;
    }
    sections.push({
      ...located,
      truncated:
        chunked.truncated || located.end - located.start > limits.maxCharsPerSection,
      chunks: chunked.chunks,
    });
  }
  return {
    parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
    formType,
    documentText,
    expectedSections: definitions.map((definition) => definition.kind),
    sections,
    missingSections,
    truncatedSections: sections
      .filter((section) => section.truncated)
      .map((section) => section.kind),
    chunkCount: sections.reduce((sum, section) => sum + section.chunks.length, 0),
  };
}
