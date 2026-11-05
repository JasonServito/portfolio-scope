import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_REPORT_ITEM_LIMITS,
  decodeFilingDocument,
  expectedFilingSectionKinds,
  extractCurrentReportItems,
  extractFilingSections,
  FILING_SECTION_LIMITS,
  htmlToText,
  PRESS_RELEASE_LIMITS,
  SEC_FILING_SECTION_PARSER_VERSION,
  type FilingSectionExtraction,
} from "@/lib/sec/filing-sections";

const fixtureDirectory = join(process.cwd(), "tests", "fixtures", "sec");
const tenK = readFileSync(
  join(fixtureDirectory, "aapl-10k-primary-document-clipped.htm"),
  "utf8",
);
const tenQ = readFileSync(
  join(fixtureDirectory, "aapl-10q-primary-document-clipped.htm"),
  "utf8",
);
const pressRelease = readFileSync(
  join(fixtureDirectory, "aapl-8k-ex991-press-release-clipped.htm"),
  "utf8",
);
const currentReport = readFileSync(
  join(fixtureDirectory, "aapl-8k-primary-document-clipped.htm"),
  "utf8",
);

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function section(extraction: FilingSectionExtraction, kind: string) {
  const found = extraction.sections.find((item) => item.kind === kind);
  if (!found) throw new Error(`Section ${kind} was not extracted.`);
  return found;
}

function sectionText(extraction: FilingSectionExtraction, kind: string) {
  const found = section(extraction, kind);
  return extraction.documentText.slice(found.start, found.end);
}

describe("SEC filing HTML normalization", () => {
  it("decodes entities, drops hidden inline-XBRL data, page numbers, and running footers", () => {
    const text = htmlToText(tenK);

    expect(text).toContain("Item 1A. Risk Factors");
    expect(text).toContain("Company\u2019s fiscal year");
    expect(text).not.toContain("&#160;");
    expect(text).not.toContain("&#8217;");
    expect(text).not.toContain("dei:AmendmentFlag");
    expect(text).not.toContain("0000320193");
    expect(text).not.toMatch(/Form 10-K \| \d+/);
    expect(text).not.toMatch(/^\d{1,3}$/m);
    expect(text).not.toMatch(/<[a-z]/i);
    // Table cells join into one line so a contents entry stays on one line.
    expect(text).toMatch(/^Item 7\. Management\u2019s Discussion and Analysis of Financial Condition and Results of Operations 22$/m);
  });

  it("decodes a fetched document by its declared charset and falls back to UTF-8", () => {
    const utf8 = new TextEncoder().encode(
      '<html><head><meta charset="utf-8"></head><body>Company\u2019s</body></html>',
    );
    expect(decodeFilingDocument(utf8, "text/html")).toContain("Company\u2019s");
    expect(decodeFilingDocument(utf8, "text/html; charset=x-not-a-charset")).toContain(
      "Company\u2019s",
    );
    const latin = Uint8Array.from([0x43, 0x61, 0x66, 0xe9]);
    expect(decodeFilingDocument(latin, "text/html; charset=iso-8859-1")).toBe(
      "Caf\u00e9",
    );
  });
});

describe("10-K section extraction", () => {
  const extraction = extractFilingSections(tenK, "10-K");

  it("extracts Business, Risk Factors, and MD&A from the section bodies rather than the contents table", () => {
    expect(extraction.parserVersion).toBe(SEC_FILING_SECTION_PARSER_VERSION);
    expect(extraction.expectedSections).toEqual(["BUSINESS", "RISK_FACTORS", "MDA"]);
    expect(extraction.sections.map((item) => item.kind)).toEqual([
      "BUSINESS",
      "RISK_FACTORS",
      "MDA",
    ]);
    expect(extraction.missingSections).toEqual([]);
    expect(extraction.truncatedSections).toEqual([]);

    const business = sectionText(extraction, "BUSINESS");
    expect(business.startsWith("Company Background")).toBe(true);
    expect(business).toContain("Competition");
    expect(business).not.toContain("Risk Factors\nThe Company\u2019s business");

    const mda = sectionText(extraction, "MDA");
    expect(mda).toContain("Fiscal Year Highlights");
    expect(mda).toContain("Liquidity and Capital Resources");
    expect(mda).not.toContain("Quantitative and Qualitative Disclosures");
    expect(section(extraction, "MDA").label).toBe(
      "Item 7. Management's Discussion and Analysis",
    );
  });

  it("spans a repeated same-section page heading and ignores in-sentence cross references", () => {
    const risks = sectionText(extraction, "RISK_FACTORS");
    // The "(continued)" page heading duplicates the Item 1A heading; the
    // section continues through it to Item 1B.
    expect(risks).toContain("Risk Factors (continued)");
    expect(risks).toContain("Legal and Regulatory Compliance Risks");
    expect(risks).toContain("Financial Risks");
    expect(risks).not.toContain("Unresolved Staff Comments");
    // Item 3 refers to Item 1A inside a sentence; that reference is not a
    // heading and Legal Proceedings stays outside the section.
    expect(risks).not.toContain("Legal Proceedings");
    expect(extraction.documentText).toContain(
      "see Part I, Item 1A of this Form 10-K",
    );
  });

  it("chunks each section into bounded, contiguous, hash-verifiable passages", () => {
    expect(extraction.chunkCount).toBeGreaterThan(6);
    for (const item of extraction.sections) {
      expect(item.chunks.length).toBeGreaterThan(0);
      item.chunks.forEach((chunk, index) => {
        expect(chunk.ordinal).toBe(index);
        expect(chunk.passageEnd).toBeGreaterThan(chunk.passageStart);
        expect(chunk.passageStart).toBeGreaterThanOrEqual(item.start);
        expect(chunk.passageEnd).toBeLessThanOrEqual(item.end);
        expect(chunk.text.length).toBeLessThanOrEqual(
          FILING_SECTION_LIMITS.maxChunkChars,
        );
        expect(chunk.text.length).toBeGreaterThanOrEqual(
          FILING_SECTION_LIMITS.minChunkChars,
        );
        expect(chunk.text).toBe(
          extraction.documentText.slice(chunk.passageStart, chunk.passageEnd),
        );
        expect(chunk.sha256).toBe(sha256(chunk.text));
        expect(chunk.text).not.toMatch(/Form 10-K \| \d+/);
        if (index > 0) {
          expect(chunk.passageStart).toBeGreaterThanOrEqual(
            item.chunks[index - 1].passageEnd,
          );
        }
      });
    }
    const first = section(extraction, "RISK_FACTORS").chunks[0];
    expect(first.text.startsWith("The Company\u2019s business, reputation")).toBe(
      true,
    );
  });

  it("is deterministic for the same document", () => {
    const again = extractFilingSections(tenK, "10-K");
    expect(again).toEqual(extraction);
  });

  it("reports a missing heading instead of falling back to the contents entry", () => {
    const withoutMdaHeading = tenK.replace(
      /<div id="i0203">[\s\S]*?<\/div>/,
      "<div><span>Discussion of results follows.</span></div>",
    );
    expect(withoutMdaHeading).not.toBe(tenK);

    const partial = extractFilingSections(withoutMdaHeading, "10-K");

    expect(partial.sections.map((item) => item.kind)).toEqual([
      "BUSINESS",
      "RISK_FACTORS",
    ]);
    expect(partial.missingSections).toEqual(["MDA"]);
    expect(partial.chunkCount).toBeGreaterThan(0);
  });

  it("applies the character and chunk caps and records truncation", () => {
    const limits = {
      ...FILING_SECTION_LIMITS,
      maxCharsPerSection: 2_000,
      targetChunkChars: 500,
      maxChunkChars: 700,
      maxChunksPerSection: 2,
      maxChunksPerFiling: 6,
    };
    const capped = extractFilingSections(tenK, "10-K", limits);

    expect(capped.sections.map((item) => item.kind)).toEqual([
      "BUSINESS",
      "RISK_FACTORS",
      "MDA",
    ]);
    expect(capped.truncatedSections).toEqual(["BUSINESS", "RISK_FACTORS", "MDA"]);
    for (const item of capped.sections) {
      expect(item.chunks.length).toBeLessThanOrEqual(2);
      for (const chunk of item.chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(700);
        expect(chunk.passageEnd - item.start).toBeLessThanOrEqual(2_000);
      }
    }
    expect(capped.chunkCount).toBeLessThanOrEqual(6);
  });

  it("splits an over-long paragraph at sentence boundaries", () => {
    const sentence = "The Company sells products in many markets around the world. ";
    const longParagraph = sentence.repeat(60);
    const html = `<html><body>
      <div>Item 1. Business</div>
      <div>${longParagraph}</div>
      <div>Item 1A. Risk Factors</div>
      <div>${"Risk text that is long enough to count as a section body. ".repeat(12)}</div>
      <div>Item 1B. Unresolved Staff Comments</div>
      <div>None.</div>
    </body></html>`;
    const result = extractFilingSections(html, "10-K");
    const business = section(result, "BUSINESS");

    expect(business.chunks.length).toBeGreaterThan(1);
    for (const chunk of business.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(
        FILING_SECTION_LIMITS.maxChunkChars,
      );
      expect(chunk.text.endsWith(".")).toBe(true);
      expect(chunk.text).toBe(
        result.documentText.slice(chunk.passageStart, chunk.passageEnd),
      );
    }
  });

  it("never leaves trimmable whitespace at a passage edge, so a re-trimmed excerpt keeps its hash", () => {
    const sentence = "The Company sells products in many markets around the world.";
    const separators = ["\r", "\u2028", "\u205f", "\ufeff", " \t "];
    const longLine = Array.from({ length: 40 }, (_, index) =>
      `${sentence}${separators[index % separators.length]}`,
    ).join("");
    const html = `<html><body>
      <div>Item 1. Business</div>
      <div>${longLine}</div>
      <div>Item 1A. Risk Factors</div>
      <div>${"Risk text that is long enough to count as a section body. ".repeat(12)}</div>
      <div>Item 1B. Unresolved Staff Comments</div>
    </body></html>`;
    const result = extractFilingSections(html, "10-K");
    const chunks = result.sections.flatMap((item) => item.chunks);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim());
      expect(sha256(chunk.text.trim())).toBe(chunk.sha256);
    }
  });

  it("keeps the passage that was pending when the section character cap is reached", () => {
    const limits = { ...FILING_SECTION_LIMITS, maxCharsPerSection: 3_000 };
    const capped = extractFilingSections(tenK, "10-K", limits);
    const business = section(capped, "BUSINESS");

    expect(capped.truncatedSections).toContain("BUSINESS");
    const last = business.chunks.at(-1)!;
    expect(last.passageEnd - business.start).toBeLessThanOrEqual(3_000);
    // The chunk closed by the cap is the last one that fits, not dropped.
    expect(last.passageEnd - business.start).toBeGreaterThan(
      3_000 - FILING_SECTION_LIMITS.targetChunkChars,
    );
  });
});

describe("10-Q section extraction", () => {
  it("extracts only the Part I Item 2 MD&A and never the Part II Item 2 heading", () => {
    const extraction = extractFilingSections(tenQ, "10-Q");

    expect(extraction.expectedSections).toEqual(["MDA", "RISK_FACTORS"]);
    expect(extraction.sections.map((item) => item.kind)).toEqual([
      "MDA",
      "RISK_FACTORS",
    ]);
    expect(extraction.missingSections).toEqual([]);
    const mda = sectionText(extraction, "MDA");
    expect(mda).toContain("Quarterly Highlights");
    expect(mda).toContain("Segment Operating Performance");
    expect(mda).not.toContain("Unregistered Sales");
    expect(mda).not.toContain("Controls and Procedures\nBased on an evaluation");
    expect(section(extraction, "MDA").label).toBe(
      "Item 2. Management's Discussion and Analysis",
    );
  });

  it("expects no sections from an unsupported form type", () => {
    expect(expectedFilingSectionKinds("DEF 14A")).toEqual([]);
    const extraction = extractFilingSections(tenQ, "DEF 14A");
    expect(extraction.expectedSections).toEqual([]);
    expect(extraction.sections).toEqual([]);
    expect(extraction.missingSections).toEqual([]);
  });
});

describe("8-K press-release exhibit extraction", () => {
  const extraction = extractFilingSections(pressRelease, "8-K");

  it("expects one PRESS_RELEASE section and chunks the whole exhibit into hash-verifiable passages", () => {
    expect(expectedFilingSectionKinds("8-K", ["2.02", "9.01"])).toEqual(["PRESS_RELEASE"]);
    expect(extraction).toMatchObject({
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      formType: "8-K",
      expectedSections: ["PRESS_RELEASE"],
      missingSections: [],
      truncatedSections: [],
    });
    const release = section(extraction, "PRESS_RELEASE");
    expect(release.label).toBe("Exhibit 99.1 Press Release");
    expect(release.chunks.length).toBeGreaterThan(3);
    expect(release.chunks.length).toBeLessThanOrEqual(
      PRESS_RELEASE_LIMITS.maxChunksPerSection,
    );
    expect(extraction.chunkCount).toBe(release.chunks.length);
    expect(release.chunks[0].text).toContain("Apple reports third quarter results");
    expect(release.chunks[0].text).toContain("quarterly revenue of $94.0 billion");
    expect(extraction.documentText).not.toMatch(/<[a-z]/i);
    release.chunks.forEach((chunk, index) => {
      expect(chunk.ordinal).toBe(index);
      expect(chunk.text).toBe(
        extraction.documentText.slice(chunk.passageStart, chunk.passageEnd),
      );
      expect(sha256(chunk.text)).toBe(chunk.sha256);
      expect(chunk.text.length).toBeLessThanOrEqual(PRESS_RELEASE_LIMITS.maxChunkChars);
      expect(chunk.text).toBe(chunk.text.trim());
    });
    // Passages are contiguous and in document order.
    for (let index = 1; index < release.chunks.length; index += 1) {
      expect(release.chunks[index].passageStart).toBeGreaterThanOrEqual(
        release.chunks[index - 1].passageEnd,
      );
    }
  });

  it("reports an exhibit too short to be a press release as missing", () => {
    const short = extractFilingSections(
      "<html><body><div>Exhibit 99.1</div><div>Press release to follow.</div></body></html>",
      "8-K",
    );
    expect(short.sections).toEqual([]);
    expect(short.missingSections).toEqual(["PRESS_RELEASE"]);
    expect(short.chunkCount).toBe(0);
  });

  it("applies the press-release passage cap and records truncation", () => {
    const capped = extractFilingSections(pressRelease, "8-K", {
      ...PRESS_RELEASE_LIMITS,
      maxChunksPerSection: 2,
      maxChunksPerFiling: 2,
    });
    expect(section(capped, "PRESS_RELEASE").chunks).toHaveLength(2);
    expect(capped.truncatedSections).toEqual(["PRESS_RELEASE"]);
  });

  it("leaves 10-K and 10-Q section extraction unchanged", () => {
    expect(extractFilingSections(tenK, "10-K").expectedSections).toEqual([
      "BUSINESS",
      "RISK_FACTORS",
      "MDA",
    ]);
    expect(extractFilingSections(tenQ, "10-Q").expectedSections).toEqual([
      "MDA",
      "RISK_FACTORS",
    ]);
  });
});

describe("10-Q Part II Item 1A risk-factor update", () => {
  it("extracts the Part II Item 1A update as a 10-Q RISK_FACTORS section, never the contents entry", () => {
    const extraction = extractFilingSections(tenQ, "10-Q");
    const update = section(extraction, "RISK_FACTORS");
    expect(update.label).toBe("Part II, Item 1A. Risk Factors");
    const text = sectionText(extraction, "RISK_FACTORS");
    expect(text).toContain("There have been no material changes to those risk factors");
    expect(text).not.toContain("Unregistered Sales");
    expect(text).not.toContain("Legal Proceedings");
    expect(update.chunks).toHaveLength(1);
  });

  it("records a one-sentence \"no material changes\" update as present, not missing", () => {
    const html = `<html><body>
      <div>Part II</div>
      <div>Item 1. Legal Proceedings</div>
      <div>None.</div>
      <div>Item 1A. Risk Factors</div>
      <div>There have been no material changes to the Company&#8217;s risk factors since the 2025 Form 10-K.</div>
      <div>Item 2. Unregistered Sales of Equity Securities and Use of Proceeds</div>
      <div>None.</div>
    </body></html>`;
    const extraction = extractFilingSections(html, "10-Q");
    expect(extraction.missingSections).toEqual(["MDA"]);
    expect(sectionText(extraction, "RISK_FACTORS")).toBe(
      "There have been no material changes to the Company\u2019s risk factors since the 2025 Form 10-K.",
    );
    // A 10-K still needs a real section, not a sentence.
    expect(
      extractFilingSections(html.replace("Part II", ""), "10-K").missingSections,
    ).toContain("RISK_FACTORS");
  });
});

describe("8-K item text extraction", () => {
  it("expects item text for listed items other than 2.02 and 9.01, and a press release only for a results filing", () => {
    expect(expectedFilingSectionKinds("8-K", ["5.07"])).toEqual(["CURRENT_REPORT_ITEM"]);
    expect(expectedFilingSectionKinds("8-K", ["2.02", "8.01", "9.01"])).toEqual([
      "CURRENT_REPORT_ITEM",
      "PRESS_RELEASE",
    ]);
    expect(expectedFilingSectionKinds("8-K", ["7.01", "9.01"])).toEqual([
      "CURRENT_REPORT_ITEM",
    ]);
    expect(expectedFilingSectionKinds("8-K", ["9.01"])).toEqual([]);
  });

  it("extracts the listed item's text from a primary 8-K document into hash-verifiable passages", () => {
    const extraction = extractCurrentReportItems(currentReport, ["5.07"]);
    expect(extraction).toMatchObject({
      parserVersion: SEC_FILING_SECTION_PARSER_VERSION,
      formType: "8-K",
      expectedSections: ["CURRENT_REPORT_ITEM"],
      missingSections: [],
      missingItems: [],
      truncatedSections: [],
    });
    const item = section(extraction, "CURRENT_REPORT_ITEM");
    expect(item.label).toBe("Item 5.07");
    // The heading line holds only the title; the text starts with the event.
    expect(item.chunks[0].text).toMatch(
      /^The Company held its annual meeting of shareholders on February 24, 2026\./,
    );
    expect(item.chunks[0].text.length).toBeLessThanOrEqual(
      CURRENT_REPORT_ITEM_LIMITS.targetChunkChars,
    );
    const text = sectionText(extraction, "CURRENT_REPORT_ITEM");
    expect(text).toContain("Proposal 4: Shareholder Proposal");
    // The cover page and signature block are not item text.
    expect(text).not.toContain("Check the appropriate box");
    expect(text).not.toContain("SIGNATURE");
    expect(text).not.toContain("duly authorized");
    item.chunks.forEach((chunk, index) => {
      expect(chunk.ordinal).toBe(index);
      expect(chunk.text).toBe(
        extraction.documentText.slice(chunk.passageStart, chunk.passageEnd),
      );
      expect(sha256(chunk.text)).toBe(chunk.sha256);
    });
  });

  it("splits several items at their \"Item 5.02\" headings, keeps text that shares the heading line, and continues ordinals across items", () => {
    const html = `<html><body>
      <div>FORM 8-K</div>
      <div>CURRENT REPORT</div>
      <div><b>Item 1.05</b>&#160;&#160;Material Cybersecurity Incidents.</div>
      <div>On March 3, 2026, the Company detected unauthorized access to an internal system that stores customer contact information. The Company activated its incident response plan and engaged outside experts.</div>
      <div>The Company has not yet determined whether the incident is reasonably likely to materially affect its financial condition or results of operations.</div>
      <div>ITEM 5.02. DEPARTURE OF DIRECTORS OR CERTAIN OFFICERS</div>
      <div>(b) On March 4, 2026, the Chief Financial Officer informed the Company of her decision to retire effective June 30, 2026.</div>
      <div>Item 8.01 Other Events. On March 5, 2026, the Board of Directors declared a quarterly cash dividend of $0.27 per share.</div>
      <div>Item 9.01 Financial Statements and Exhibits.</div>
      <div>(d) Exhibits. 99.1 Press release dated March 5, 2026.</div>
      <div>SIGNATURES</div>
      <div>Pursuant to the requirements of the Securities Exchange Act of 1934 the registrant has duly caused this report to be signed.</div>
    </body></html>`;
    const extraction = extractCurrentReportItems(html, ["1.05", "5.02", "7.01", "8.01", "9.01"]);
    expect(extraction.sections.map((item) => item.label)).toEqual([
      "Item 1.05",
      "Item 5.02",
      "Item 8.01",
    ]);
    // Item 7.01 is listed but has no heading: reported, never guessed.
    expect(extraction.missingItems).toEqual(["7.01"]);
    expect(extraction.missingSections).toEqual([]);
    const [cyber, officer, other] = extraction.sections.map((item) =>
      extraction.documentText.slice(item.start, item.end),
    );
    expect(cyber).toMatch(/^On March 3, 2026, the Company detected/);
    expect(cyber).toContain("has not yet determined");
    expect(cyber).not.toContain("Chief Financial Officer");
    expect(officer).toMatch(/^\(b\) On March 4, 2026/);
    // Text on the heading line itself is item text, not a title.
    expect(other).toContain("declared a quarterly cash dividend of $0.27 per share");
    expect(other).not.toContain("Exhibits");
    const ordinals = extraction.sections.flatMap((item) =>
      item.chunks.map((chunk) => chunk.ordinal),
    );
    expect(ordinals).toEqual(ordinals.map((_, index) => index));
    expect(extraction.chunkCount).toBe(ordinals.length);
  });

  it("extracts nothing for a results or exhibit-only filing and reports a document with no listed heading as missing", () => {
    expect(extractCurrentReportItems(currentReport, ["2.02", "9.01"])).toMatchObject({
      expectedSections: [],
      sections: [],
      missingSections: [],
    });
    expect(extractCurrentReportItems(currentReport, ["5.02"])).toMatchObject({
      expectedSections: ["CURRENT_REPORT_ITEM"],
      sections: [],
      missingSections: ["CURRENT_REPORT_ITEM"],
      missingItems: ["5.02"],
      chunkCount: 0,
    });
  });
});
