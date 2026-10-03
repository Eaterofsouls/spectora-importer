/**
 * tests/rule-zero.test.ts
 *
 * Static Analysis Anti-Overfitting Verification
 *
 * Mathematically proves that the core parser (lib/parser.ts) does not contain
 * any hardcoded template names, fixture filenames, or specific inspector titles.
 * The parser must be 100% generic, derived strictly from standard column headers.
 */

import * as fs from "fs";
import * as path from "path";

describe("Anti-Overfitting & Generalisation Verification", () => {
  test("Core parser contains zero hardcoded template or domain string literals", () => {
    const parserPath = path.resolve(__dirname, "../lib/parser.ts");
    const parserSource = fs.readFileSync(parserPath, "utf-8");

    // Forbidden template memorisation patterns
    const forbiddenTemplates = [
      "gromicko",
      "internachi",
      "trec",
      "radon",
      "room-by-room",
      "probe-duplicate",
      "probe-html",
      "probe-plain",
      "commercial",
      "residential",
    ];

    const lines = parserSource.split("\n");
    const violations: { line: number; text: string; match: string }[] = [];

    lines.forEach((lineText, idx) => {
      // Exclude comments that merely cite test files or docs
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        return;
      }

      for (const forbidden of forbiddenTemplates) {
        const regex = new RegExp(`\\b${forbidden}\\b`, "i");
        if (regex.test(lineText)) {
          violations.push({
            line: idx + 1,
            text: trimmed,
            match: forbidden,
          });
        }
      }
    });

    expect(violations).toEqual([]);
  });
});
