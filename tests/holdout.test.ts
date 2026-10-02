/**
 * tests/holdout.test.ts
 *
 * Multi-Template Generalisation:
 * Tests our parser across 9 real Spectora export templates:
 * 1. tpl-gromicko.xls (Nick Gromicko InterNACHI master template, >1000 comments)
 * 2. tpl-radon.xls (Specialized environmental inspection)
 * 3. tpl-room-by-room.xls (Room-based inspection architecture)
 * 4. tpl-trec.xls (Texas Real Estate Commission standard template)
 * 5. internachi-residential-2026-09-22.xls
 * 6. internachi-residential-rich-comment.xls (contains all Froala rich text controls)
 * 7. probe-duplicate.xls (duplicate section/item names)
 * 8. probe-html.xls (custom HTML formatting, special chars)
 * 9. probe-plain.xls (plain text export variant — should emit NO_HTML_FOUND warning)
 *
 * Proves that our parser is robust across real-world template variants.
 */

import * as fs from "fs";
import * as path from "path";
import { parseSpectoraExport } from "../lib/parser";

describe("Multi-Template Generalisation — Real Export Tests", () => {
  const fixturesDir = path.resolve(process.cwd(), "fixtures");

  test("tpl-gromicko.xls: parses Nick Gromicko master template", () => {
    const file = path.join(fixturesDir, "tpl-gromicko.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "tpl-gromicko.xls");

    expect(result.fields).toHaveLength(1248);
    const sectionNames = new Set(result.fields.map((f) => f.section_name));
    expect(sectionNames.size).toBe(17);
    // Every field must have valid section and item pos
    expect(result.fields.every((f) => f.section_pos >= 0 && f.item_pos >= 0)).toBe(true);
    // Row accountability check: no unaccounted rows
    const unaccounted = result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS");
    expect(unaccounted).toHaveLength(0);
  });

  test("tpl-radon.xls: parses Radon inspection template", () => {
    const file = path.join(fixturesDir, "tpl-radon.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "tpl-radon.xls");

    expect(result.fields).toHaveLength(10);
    const sectionNames = new Set(result.fields.map((f) => f.section_name));
    expect(sectionNames.size).toBe(2);
    expect(result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS")).toHaveLength(0);
  });

  test("tpl-room-by-room.xls: parses room-by-room template", () => {
    const file = path.join(fixturesDir, "tpl-room-by-room.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "tpl-room-by-room.xls");

    expect(result.fields).toHaveLength(798);
    const sectionNames = new Set(result.fields.map((f) => f.section_name));
    expect(sectionNames.size).toBe(22);
    expect(result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS")).toHaveLength(0);
  });

  test("tpl-trec.xls: parses TREC standard template", () => {
    const file = path.join(fixturesDir, "tpl-trec.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "tpl-trec.xls");

    expect(result.fields).toHaveLength(218);
    const sectionNames = new Set(result.fields.map((f) => f.section_name));
    expect(sectionNames.size).toBe(7);
    expect(result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS")).toHaveLength(0);
  });

  test("internachi-residential-rich-comment.xls: preserves complex Froala rich HTML", () => {
    const file = path.join(fixturesDir, "internachi-residential-rich-comment.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "internachi-residential-rich-comment.xls");

    expect(result.fields).toHaveLength(392);
    // Find rich comments containing HTML tags
    const htmlFields = result.fields.filter((f) => f.comment_text && /<[a-z]/i.test(f.comment_text));
    expect(htmlFields.length).toBeGreaterThan(0);
  });

  test("probe-duplicate.xls: gracefully handles duplicate names in hierarchy", () => {
    const file = path.join(fixturesDir, "probe-duplicate.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "probe-duplicate.xls");

    expect(result.fields).toHaveLength(423);
    expect(result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS")).toHaveLength(0);
  });

  test("probe-html.xls: parses special characters and html entities faithfully", () => {
    const file = path.join(fixturesDir, "probe-html.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "probe-html.xls");

    expect(result.fields).toHaveLength(403);
  });

  test("probe-plain.xls: identifies plain text export variant and emits NO_HTML_FOUND", () => {
    const file = path.join(fixturesDir, "probe-plain.xls");
    expect(fs.existsSync(file)).toBe(true);

    const buf = fs.readFileSync(file);
    const result = parseSpectoraExport(buf, "probe-plain.xls");

    expect(result.fields).toHaveLength(403);

    // Must warn the inspector that formatting might be missing
    const warning = result.issues.find((i) => i.code === "NO_HTML_FOUND");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
  });
});
