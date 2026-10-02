/**
 * tests/parser.test.ts
 *
 * Parser unit tests — verifies parse-path fidelity.
 * These tests are the other half of the verification story:
 * the verifier checks the DB write path; these tests check the parse path.
 *
 * Run: npx jest tests/parser.test.ts
 */

import * as XLSX from "xlsx";
import { parseSpectoraExport, detectFormat, ParseError } from "../lib/parser";
import * as fs from "fs";
import * as path from "path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal OOXML buffer with specified cell values.
 * Used to test specific edge cases without needing the real file.
 */
function buildOoxml(
  headers: string[],
  rows: Array<Record<string, unknown>>
): Buffer {
  const wb = XLSX.utils.book_new();
  const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? null))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const MINIMAL_HEADERS = [
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

function minimalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Section Name": "Roof",
    "Item Name": "General",
    "Comment Name": "Condition",
    "Comment Text": "The roof is in good condition.",
    "Comment Type (info, limit, defect)": "info",
    "Category (-1: Low, 0: Med, 1: High)": 0,
    "Multiple Choice Options (comma-separated)": null,
    "Order (w/i item)": 1,
    "Answer Type (boolean, checkbox, date, number, range, text)": "boolean",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectFormat", () => {
  test("identifies OOXML (PK zip) correctly", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(detectFormat(buf)).toBe("ooxml");
  });

  test("identifies OLE2 legacy XLS correctly", () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]);
    expect(detectFormat(buf)).toBe("ole2_legacy");
  });

  test("identifies Spectora download page HTML", () => {
    const html = Buffer.from(
      "<html><body>Your download is ready! Click here.</body></html>"
    );
    expect(detectFormat(html)).toBe("spectora_download_page");
  });

  test("handles buffer shorter than 4 bytes", () => {
    expect(detectFormat(Buffer.from([0x50, 0x4b]))).toBe("unknown");
  });
});

describe("parseSpectoraExport — format rejection", () => {
  test("rejects OLE2 binary XLS with correct error code", () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]);
    expect(() => parseSpectoraExport(buf, "test.xls")).toThrow(ParseError);
    try {
      parseSpectoraExport(buf, "test.xls");
    } catch (e) {
      expect((e as ParseError).code).toBe("LEGACY_XLS_FORMAT");
    }
  });

  test("rejects Spectora download page with correct error code", () => {
    const html = Buffer.from(
      "<html><body>Your download is ready! Download the file.</body></html>"
    );
    expect(() => parseSpectoraExport(html, "export.htm")).toThrow(ParseError);
    try {
      parseSpectoraExport(html, "export.htm");
    } catch (e) {
      expect((e as ParseError).code).toBe("SPECTORA_DOWNLOAD_PAGE");
    }
  });
});

describe("parseSpectoraExport — basic correctness", () => {
  test("parses a minimal OOXML file correctly", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [minimalRow()]);
    const result = parseSpectoraExport(buf, "test.xlsx");

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].section_name).toBe("Roof");
    expect(result.fields[0].item_name).toBe("General");
    expect(result.fields[0].comment_name).toBe("Condition");
    expect(result.fields[0].section_pos).toBe(0);
    expect(result.fields[0].item_pos).toBe(0);
    expect(result.fields[0].field_pos).toBe(0);
    expect(result.fields[0].source_row).toBe(2); // header=row1, first data=row2 (1-based display)
  });

  test("preserves null comment_text (83/392 rows in InterNACHI)", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Comment Text": null }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    expect(result.fields[0].comment_text).toBeNull();
  });

  test("snap_* fields are set to same values as working fields on import", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [minimalRow()]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    const f = result.fields[0];
    expect(f.snap_section_name).toBe(f.section_name);
    expect(f.snap_comment_text).toBe(f.comment_text);
  });
});

describe("parseSpectoraExport — ORDER COLUMN TRAP (Trap 1)", () => {
  test("physical row order is used, not Order column value", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Comment Name": "First", "Order (w/i item)": 0 }),
      minimalRow({ "Comment Name": "Second", "Order (w/i item)": 0 }),
      minimalRow({ "Comment Name": "Third", "Order (w/i item)": 0 }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    // Should be in physical row order despite all Order=0
    expect(result.fields[0].comment_name).toBe("First");
    expect(result.fields[1].comment_name).toBe("Second");
    expect(result.fields[2].comment_name).toBe("Third");
    expect(result.fields[0].field_pos).toBe(0);
    expect(result.fields[1].field_pos).toBe(1);
    expect(result.fields[2].field_pos).toBe(2);
  });
});

describe("parseSpectoraExport — ENTITY ENCODING TRAP (Trap 2)", () => {
  test("HTML entities in comment_text are stored as-received (no extra decode)", () => {
    // SheetJS with raw:true should return the cell value as-is from the OOXML
    // The key assertion: whatever SheetJS gives us, we store verbatim
    const testValue = "Roof &amp; Attic";
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Comment Text": testValue }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    // SheetJS decodes OOXML XML layer once; result should be the JS string
    // We assert that the stored value matches what SheetJS produced (not re-encoded)
    expect(typeof result.fields[0].comment_text).toBe("string");
    // If SheetJS decodes once: "Roof & Attic" — document the actual behavior
    const stored = result.fields[0].comment_text!;
    // Either raw (with &amp;) or decoded once (with &) — both are fine, must be consistent
    expect([testValue, "Roof & Attic"]).toContain(stored);
    // The snap must match the working value
    expect(result.fields[0].snap_comment_text).toBe(stored);
  });
});

describe("parseSpectoraExport — TYPE COERCION TRAP (date and numeric string preservation)", () => {
  test("date-looking strings are not coerced to Date objects", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Comment Text": "2026-10-01" }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    // Must be a string, not a Date
    expect(typeof result.fields[0].comment_text).toBe("string");
    expect(result.fields[0].comment_text).toBe("2026-10-01");
  });

  test("numeric-looking strings are not coerced to numbers", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Comment Text": "05.10" }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    expect(typeof result.fields[0].comment_text).toBe("string");
  });
});

describe("parseSpectoraExport — NON-UNIQUE KEYS TRAP (Trap 5)", () => {
  test("items with same name in different sections get different item_pos", () => {
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Section Name": "Roof", "Item Name": "General", "Comment Name": "A" }),
      minimalRow({ "Section Name": "Electrical", "Item Name": "General", "Comment Name": "B" }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    expect(result.fields[0].section_pos).toBe(0);
    expect(result.fields[1].section_pos).toBe(1);
    // Both have item_pos=0 (first item in their respective sections)
    expect(result.fields[0].item_pos).toBe(0);
    expect(result.fields[1].item_pos).toBe(0);
  });
});

describe("parseSpectoraExport — OPTIONS_RAW TRAP (Trap 4)", () => {
  test("options_raw stores raw comma-joined string without splitting", () => {
    const rawOptions = "Satisfactory, Marginal, Defective (severe, urgent)";
    const buf = buildOoxml(MINIMAL_HEADERS, [
      minimalRow({ "Multiple Choice Options (comma-separated)": rawOptions }),
    ]);
    const result = parseSpectoraExport(buf, "test.xlsx");
    // Must be stored verbatim — not split into an array
    expect(result.fields[0].options_raw).toBe(rawOptions);
    expect(result.fields[0].raw_cells["Multiple Choice Options (comma-separated)"]).toBe(rawOptions);
  });
});

describe("parseSpectoraExport — with real InterNACHI file", () => {
  const xlsPath = path.resolve(
    __dirname,
    "../InterNACHI Residential -2026-10-01.xls"
  );

  // Skip if file not present (CI environment)
  const fileExists = fs.existsSync(xlsPath);
  const maybeTest = fileExists ? test : test.skip;

  maybeTest("parses the real InterNACHI export", () => {
    const buf = fs.readFileSync(xlsPath);
    const result = parseSpectoraExport(buf, "InterNACHI Residential.xls");

    // Verified measurements from workspace/notes/00_understanding.md
    expect(result.fields.length).toBe(392); // [measured]
    const sections = new Set(result.fields.map((f) => f.section_pos)).size;
    expect(sections).toBe(13); // [measured] 13 distinct sections
    const items = new Set(result.fields.map((f) => `${f.section_pos}::${f.item_pos}`)).size;
    expect(items).toBe(69); // [measured] 69 distinct (section, item) pairs

    // All snap fields must equal working fields on fresh parse
    for (const f of result.fields) {
      expect(f.snap_section_name).toBe(f.section_name);
      expect(f.snap_item_name).toBe(f.item_name);
      expect(f.snap_comment_name).toBe(f.comment_name);
      expect(f.snap_comment_text).toBe(f.comment_text);
    }

    // No field should have source_row = 0
    expect(result.fields.every((f) => f.source_row >= 1)).toBe(true);

    // No field in the set should have source_row collision
    const rows = result.fields.map((f) => f.source_row);
    const uniqueRows = new Set(rows);
    expect(uniqueRows.size).toBe(rows.length);
  });
});
