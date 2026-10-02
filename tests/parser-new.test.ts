/**
 * tests/parser-new.test.ts
 *
 * Targeted tests for real-world inspection template edge cases:
 * 1. Blank cell visual grouping inheritance
 * 2. Disjoint section block detection and merging
 * 3. Total row accountability proof
 * 4. HTML sanitisation (XSS prevention)
 */

import * as path from "path";
import * as XLSX from "xlsx";
import { parseSpectoraExport } from "../lib/parser";
import { sanitiseHtml, hasStrippedMarkup } from "../lib/sanitise";

// ─── Fixture builders ────────────────────────────────────────────────────────

const BASE_HEADERS = [
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
];

function buildOoxml(
  headers: string[],
  rows: (string | null)[][]
): Buffer {
  const ws: XLSX.WorkSheet = {};
  const numCols = headers.length;

  headers.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { v: h, t: "s" };
  });
  rows.forEach((row, ri) => {
    row.forEach((val, c) => {
      if (val !== null) {
        ws[XLSX.utils.encode_cell({ r: ri + 1, c })] = { v: val, t: "s" };
      }
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length, c: numCols - 1 },
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// Build a row with optional overrides — null means leave cell empty (visual grouping)
function row(overrides: Record<string, string | null> = {}): (string | null)[] {
  const defaults: Record<string, string> = {
    "Section Name": "Roof",
    "Item Name": "General",
    "Comment Name": "Condition",
    "Comment Text": "<p>Good condition</p>",
    "Comment Type (info, limit, defect)": "info",
    "Category (-1: Low, 0: Med, 1: High)": "0",
    "Multiple Choice Options (comma-separated)": "",
    "Order (w/i item)": "0",
    "Answer Type (boolean, checkbox, date, number, range, text)": "checkbox",
  };
  return BASE_HEADERS.map((h) =>
    h in overrides ? overrides[h] : defaults[h] ?? null
  );
}

// ─── BLANK CELL INHERITANCE TESTS ────────────────────────────────────────────

describe("parseSpectoraExport — BLANK CELL INHERITANCE", () => {
  test("carries section name forward when cell is blank (Excel visual grouping)", () => {
    // Row 1: Section=Roof, Item=General, Comment=Condition
    // Row 2: Section=null (blank, inherits Roof), Item=General, Comment=Wear
    const rows = [
      row(),
      row({ "Section Name": null, "Comment Name": "Wear" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    expect(result.fields).toHaveLength(2);
    // Both fields must be in section "Roof"
    expect(result.fields[0].section_name).toBe("Roof");
    expect(result.fields[1].section_name).toBe("Roof");
    // Both in same section position
    expect(result.fields[0].section_pos).toBe(result.fields[1].section_pos);
    // No ORPHAN_ROW error — blank cell is normal, not an error
    const orphans = result.issues.filter((i) => i.code === "ORPHAN_ROW");
    expect(orphans).toHaveLength(0);
  });

  test("carries item name forward when cell is blank", () => {
    const rows = [
      row(),
      row({ "Item Name": null, "Comment Name": "Wear" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].item_name).toBe("General");
    expect(result.fields[1].item_name).toBe("General"); // inherited
    expect(result.fields[0].item_pos).toBe(result.fields[1].item_pos);
  });

  test("new section name resets item inheritance", () => {
    const rows = [
      row({ "Section Name": "Roof",  "Item Name": "General", "Comment Name": "C1" }),
      row({ "Section Name": "HVAC",  "Item Name": "Furnace",  "Comment Name": "C2" }),
      row({ "Section Name": null,    "Item Name": null,       "Comment Name": "C3" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    expect(result.fields).toHaveLength(3);
    expect(result.fields[2].section_name).toBe("HVAC");  // inherited from row above
    expect(result.fields[2].item_name).toBe("Furnace");  // inherited from row above
  });

  test("true orphan row (no section, no inheritance) emits warning and skips", () => {
    // First row has no section — nothing to inherit from
    const rows = [
      row({ "Section Name": null, "Comment Name": "Orphan" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    expect(result.fields).toHaveLength(0); // orphan is skipped
    const orphan = result.issues.find((i) => i.code === "ORPHAN_ROW");
    expect(orphan).toBeDefined();
    expect(orphan?.severity).toBe("warning"); // downgraded from error to warning
  });
});

// ─── DISJOINT SECTION DETECTION TESTS ────────────────────────────────────────

describe("parseSpectoraExport — DISJOINT SECTION DETECTION", () => {
  test("contiguous sections do not emit DISJOINT_SECTION", () => {
    const rows = [
      row({ "Section Name": "Roof", "Comment Name": "C1" }),
      row({ "Section Name": "Roof", "Comment Name": "C2" }),
      row({ "Section Name": "HVAC", "Comment Name": "C3" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    const disjoint = result.issues.filter((i) => i.code === "DISJOINT_SECTION");
    expect(disjoint).toHaveLength(0);
    expect(result.fields).toHaveLength(3);
  });

  test("non-contiguous section emits DISJOINT_SECTION warning", () => {
    // Roof → HVAC → Roof again (Spectora sometimes splits sections)
    const rows = [
      row({ "Section Name": "Roof", "Comment Name": "C1" }),
      row({ "Section Name": "HVAC", "Comment Name": "C2" }),
      row({ "Section Name": "Roof", "Comment Name": "C3" }), // disjoint!
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    const disjoint = result.issues.filter((i) => i.code === "DISJOINT_SECTION");
    expect(disjoint.length).toBeGreaterThan(0);
    expect(disjoint[0].message).toContain("Roof");
  });

  test("disjoint rows are merged into original section (sectionPos unchanged)", () => {
    const rows = [
      row({ "Section Name": "Roof", "Comment Name": "C1" }),
      row({ "Section Name": "HVAC", "Comment Name": "C2" }),
      row({ "Section Name": "Roof", "Comment Name": "C3" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    const roofFields = result.fields.filter((f) => f.section_name === "Roof");
    expect(roofFields).toHaveLength(2);
    // Both Roof fields should have same section_pos
    expect(roofFields[0].section_pos).toBe(roofFields[1].section_pos);
  });
});

// ─── ROW ACCOUNTABILITY TESTS ─────────────────────────────────────────────────

describe("parseSpectoraExport — ROW ACCOUNTABILITY", () => {
  test("all rows accounted: processed + empty = total sheet rows", () => {
    const rows = [
      row({ "Comment Name": "C1" }),
      // blank row (no section, item, or comment)
      ["", "", "", "", "", "", "", "", ""],
      row({ "Comment Name": "C2" }),
    ];
    const buf = buildOoxml(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test.xlsx");

    // 2 data fields + 1 blank — no UNACCOUNTED_ROWS warning
    expect(result.fields).toHaveLength(2);
    const unaccounted = result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS");
    expect(unaccounted).toHaveLength(0);
  });

  test("real InterNACHI file: no UNACCOUNTED_ROWS warning", () => {
    const xlsPath = path.resolve(
      process.cwd(),
      "InterNACHI Residential -2026-10-01.xls"
    );
    if (!require("fs").existsSync(xlsPath)) return; // skip in CI
    const buf = require("fs").readFileSync(xlsPath);
    const result = parseSpectoraExport(buf, "internachi.xls");
    const unaccounted = result.issues.filter((i) => i.code === "UNACCOUNTED_ROWS");
    expect(unaccounted).toHaveLength(0);
  });
});

// ─── HTML SANITISER TESTS ─────────────────────────────────────────────────────

describe("sanitiseHtml — XSS prevention and safe Froala rendering", () => {
  test("passes through safe Froala HTML unchanged", () => {
    const safe = "<p><strong>Bold</strong> and <em>italic</em> text.</p>";
    expect(sanitiseHtml(safe)).toBe(safe);
  });

  test("strips <script> tags — XSS prevention", () => {
    const xss = '<p>Safe</p><script>alert("xss")</script>';
    const result = sanitiseHtml(xss);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  test("strips javascript: href", () => {
    const xss = '<a href="javascript:alert(1)">click</a>';
    const result = sanitiseHtml(xss);
    expect(result).not.toContain("javascript:");
  });

  test("strips onerror/onclick event handlers", () => {
    const xss = '<img src="x" onerror="alert(1)">';
    const result = sanitiseHtml(xss);
    expect(result).not.toContain("onerror");
  });

  test("preserves links with href", () => {
    const html = '<a href="https://example.com">Link</a>';
    const result = sanitiseHtml(html);
    expect(result).toContain('href="https://example.com"');
  });

  test("forces rel=noopener noreferrer on links", () => {
    const html = '<a href="https://example.com">Link</a>';
    const result = sanitiseHtml(html);
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
  });

  test("allows table markup (Froala tables)", () => {
    const html = "<table><tr><td>Cell</td></tr></table>";
    expect(sanitiseHtml(html)).toContain("<table>");
    expect(sanitiseHtml(html)).toContain("<td>");
  });

  test("blocks non-YouTube/Vimeo iframes", () => {
    const html = '<iframe src="https://evil.com/steal"></iframe>';
    const result = sanitiseHtml(html);
    expect(result).not.toContain("evil.com");
  });

  test("allows YouTube iframe", () => {
    const html = '<iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>';
    const result = sanitiseHtml(html);
    expect(result).toContain("youtube.com");
  });

  test("returns empty string for null/undefined", () => {
    expect(sanitiseHtml(null)).toBe("");
    expect(sanitiseHtml(undefined)).toBe("");
    expect(sanitiseHtml("")).toBe("");
  });

  test("hasStrippedMarkup detects XSS payload", () => {
    const xss = '<p>Text</p><script>alert(1)</script>';
    expect(hasStrippedMarkup(xss)).toBe(true);
  });

  test("hasStrippedMarkup returns false for clean HTML", () => {
    const clean = "<p><strong>Bold</strong></p>";
    expect(hasStrippedMarkup(clean)).toBe(false);
  });
});
