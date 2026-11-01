import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  currentReportWindowStart,
  describeItemCode,
  findExhibitDocument,
  isCurrentReportForm,
  parseItemCodes,
} from "@/lib/sec/current-reports";

const indexPage = readFileSync(
  join(process.cwd(), "tests", "fixtures", "sec", "aapl-8k-filing-index-clipped.htm"),
  "utf8",
);

describe("Form 8-K current reports", () => {
  it("recognizes current-report forms and parses the feed's item codes", () => {
    expect(isCurrentReportForm("8-K")).toBe(true);
    expect(isCurrentReportForm("8-K/A")).toBe(true);
    expect(isCurrentReportForm("10-K")).toBe(false);
    expect(isCurrentReportForm("8-K12B")).toBe(false);
    expect(parseItemCodes("2.02,9.01")).toEqual(["2.02", "9.01"]);
    expect(parseItemCodes(" 5.02 , 9.01,9.01,")).toEqual(["5.02", "9.01"]);
    expect(parseItemCodes("")).toEqual([]);
    expect(parseItemCodes(undefined)).toEqual([]);
    expect(parseItemCodes("results")).toEqual([]);
  });

  it("labels known item codes and leaves an unknown code bare", () => {
    expect(describeItemCode("2.02")).toBe(
      "2.02 (Results of Operations and Financial Condition)",
    );
    expect(describeItemCode("5.07")).toBe(
      "5.07 (Submission of Matters to a Vote of Security Holders)",
    );
    expect(describeItemCode("12.34")).toBe("12.34");
  });

  it("starts the twelve-month window at midnight UTC one year earlier", () => {
    expect(
      currentReportWindowStart(new Date("2026-09-23T15:30:00.000Z")).toISOString(),
    ).toBe("2025-09-23T00:00:00.000Z");
  });

  it("finds the Exhibit 99.1 document on a filing index page and nothing else", () => {
    expect(findExhibitDocument(indexPage)).toBe("a8-kex991q3202506282025.htm");
    expect(findExhibitDocument(indexPage, "EX-99.01")).toBe(
      "a8-kex991q3202506282025.htm",
    );
    expect(findExhibitDocument(indexPage, "EX-99.2")).toBeNull();
    expect(findExhibitDocument(indexPage, "8-K")).toBe("aapl-20250731.htm");
  });

  it("reads the file name through the inline-XBRL viewer link and reports missing or unsafe names as absent", () => {
    const row = (document: string) =>
      `<table><tr><td>1</td><td>EX-99.1</td><td>${document}</td><td>EX-99.1</td><td>10</td></tr></table>`;
    expect(
      findExhibitDocument(
        row(
          '<a href="/ix?doc=/Archives/edgar/data/1/000000000100000001/release.htm">release.htm</a>',
        ),
      ),
    ).toBe("release.htm");
    expect(findExhibitDocument(row("&nbsp;"))).toBeNull();
    // A bare "EX-99" press release is accepted only when no "EX-99.1" row exists.
    const bare =
      '<table><tr><td>2</td><td>EX-99</td><td><a href="/a/release.htm">release.htm</a></td><td>EX-99</td><td>10</td></tr></table>';
    expect(findExhibitDocument(bare)).toBe("release.htm");
    expect(
      findExhibitDocument(
        `${bare}<table><tr><td>3</td><td>EX-99.1</td><td><a href="/a/exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td><td>10</td></tr></table>`,
      ),
    ).toBe("exhibit991.htm");
    expect(findExhibitDocument(bare, "EX-99.2")).toBeNull();
    expect(
      findExhibitDocument(row('<a href="/x/../evil name.htm">evil name.htm</a>')),
    ).toBeNull();
    expect(findExhibitDocument("<html><body>No tables</body></html>")).toBeNull();
  });
});
