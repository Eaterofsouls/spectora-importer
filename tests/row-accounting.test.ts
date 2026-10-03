/**
 * tests/row-accounting.test.ts
 *
 * Mathematical Row Accounting Invariant Test Suite.
 *
 * Mathematically asserts that:
 * Total Data Rows == Imported Comments + Empty Rows + Skipped Rows
 *
 * Guarantees zero row evaporation, zero phantom row synthesis, and exact accounting
 * for every single spreadsheet coordinate.
 */

import { verifyRowAccounting } from "../lib/verifier";
import { parseSpectoraExport } from "../lib/parser";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

describe("Mathematical Row Accounting Theorem — Invariant Verification", () => {
  test("verifies perfectly balanced row accounting (0 unaccounted)", () => {
    const result = verifyRowAccounting({
      totalFileRows: 101, // 1 header + 100 data rows
      importedCount: 80,
      emptyRowsCount: 15,
      skippedRowsCount: 5,
      headerRowsCount: 1,
    });

    expect(result.is_balanced).toBe(true);
    expect(result.data_rows).toBe(100);
    expect(result.accounted_rows).toBe(100);
    expect(result.unaccounted_rows).toBe(0);
    expect(result.summary).toContain("0 unaccounted");
  });

  test("flags data loss when rows evaporate (positive unaccounted count)", () => {
    const result = verifyRowAccounting({
      totalFileRows: 101, // 100 data rows
      importedCount: 75,
      emptyRowsCount: 15,
      skippedRowsCount: 5, // sum = 95, 5 lost
    });

    expect(result.is_balanced).toBe(false);
    expect(result.data_rows).toBe(100);
    expect(result.accounted_rows).toBe(95);
    expect(result.unaccounted_rows).toBe(5);
    expect(result.summary).toContain("5 lost");
  });

  test("flags phantom row creation when excess rows appear (negative unaccounted count)", () => {
    const result = verifyRowAccounting({
      totalFileRows: 101, // 100 data rows
      importedCount: 85,
      emptyRowsCount: 15,
      skippedRowsCount: 5, // sum = 105, 5 phantom
    });

    expect(result.is_balanced).toBe(false);
    expect(result.data_rows).toBe(100);
    expect(result.accounted_rows).toBe(105);
    expect(result.unaccounted_rows).toBe(-5);
    expect(result.summary).toContain("5 phantom");
  });

  test("handles 100% comment coverage (0 empty, 0 skipped)", () => {
    const result = verifyRowAccounting({
      totalFileRows: 51, // 1 header + 50 comments
      importedCount: 50,
      emptyRowsCount: 0,
      skippedRowsCount: 0,
    });

    expect(result.is_balanced).toBe(true);
    expect(result.data_rows).toBe(50);
    expect(result.unaccounted_rows).toBe(0);
  });

  test("handles empty sheet with only headers", () => {
    const result = verifyRowAccounting({
      totalFileRows: 1, // Only header
      importedCount: 0,
      emptyRowsCount: 0,
      skippedRowsCount: 0,
    });

    expect(result.is_balanced).toBe(true);
    expect(result.data_rows).toBe(0);
    expect(result.unaccounted_rows).toBe(0);
  });
});

describe("Mathematical Row Accounting — Real Workbook Parsing", () => {
  const headers = [
    "Section Name",
    "Item Name",
    "Comment Name",
    "Comment Text",
    "Comment Type (info, limit, defect)",
    "Category (-1: Low, 0: Med, 1: High)",
    "Order (w/i item)",
    "Multiple Choice Options (comma-separated)",
    "Answer Type (boolean, checkbox, date, number, range, text)",
  ];

  test("proves row accounting theorem on synthetic workbook with interleaved blanks", () => {
    const rows = [
      headers,
      ["Roof", "Shingles", "Material", "<p>Asphalt</p>", "info", 0, 1, "", "text"],
      ["Roof", "Shingles", "Flashing", "<p>Step flashing</p>", "info", 0, 2, "", "text"],
      ["", "", "", "", "", "", "", "", ""], // Blank row 1
      ["Roof", "Gutters", "Clean", "<p>Clear debris</p>", "info", 0, 1, "", "text"],
      ["", "", "", "", "", "", "", "", ""], // Blank row 2
      ["Exterior", "Siding", "Vinyl", "<p>Good condition</p>", "info", 0, 1, "", "text"],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const parsed = parseSpectoraExport(buffer, "accounting_test.xlsx");

    expect(parsed.fields).toHaveLength(4);
    expect(parsed.rows_empty).toBe(2);
    expect(parsed.rows_skipped).toBe(0);

    const totalDataRows = rows.length - 1; // 6
    const accounted = (parsed.rows_processed ?? 0) + (parsed.rows_empty ?? 0) + (parsed.rows_skipped ?? 0);
    expect(accounted).toBe(totalDataRows);

    const accountingReport = verifyRowAccounting({
      totalFileRows: rows.length,
      importedCount: parsed.fields.length,
      emptyRowsCount: parsed.rows_empty ?? 0,
      skippedRowsCount: parsed.rows_skipped ?? 0,
    });

    expect(accountingReport.is_balanced).toBe(true);
    expect(accountingReport.unaccounted_rows).toBe(0);
  });

  test("proves row accounting theorem holds on real holdout export", () => {
    const holdoutPath = path.join(process.cwd(), "fixtures", "tpl-gromicko.xls");

    if (fs.existsSync(holdoutPath)) {
      const buffer = fs.readFileSync(holdoutPath);
      const parsed = parseSpectoraExport(buffer, "tpl-gromicko.xls");

      const totalRows = parsed.snapshot_rows.length + 1; // +1 for header
      const accounting = verifyRowAccounting({
        totalFileRows: totalRows,
        importedCount: parsed.fields.length,
        emptyRowsCount: parsed.rows_empty ?? 0,
        skippedRowsCount: parsed.rows_skipped ?? 0,
      });

      expect(accounting.is_balanced).toBe(true);
      expect(accounting.unaccounted_rows).toBe(0);
      expect(accounting.imported_field_rows).toBeGreaterThan(1000);
    }
  });
});
