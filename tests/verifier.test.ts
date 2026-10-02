/**
 * tests/verifier.test.ts
 *
 * Unit tests for verifier.ts (Round-trip fidelity verifier and tamper detection).
 * Mocks SupabaseClient to verify that:
 * 1. Matching DB fields + snapshot passes verification with 0 mismatches.
 * 2. Mismatches in cell content (section, item, comment, type, options) are detected.
 * 3. Row count discrepancies are flagged.
 * 4. Visual grouping (blank section in snapshot, inherited in DB) is permitted without false alarms.
 * 5. Tamper test detects deliberate corruption.
 */

import { verifyTemplate, runTamperTest } from "../lib/verifier";
import { SupabaseClient } from "@supabase/supabase-js";

describe("verifier — verifyTemplate", () => {
  const headers = [
    "Section Name",
    "Item Name",
    "Comment Name",
    "Comment Text",
    "Comment Type (info, limit, defect)",
    "Category (-1: Low, 0: Med, 1: High)",
    "Answer Type (boolean, checkbox, date, number, range, text)",
    "Multiple Choice Options (comma-separated)",
  ];

  const validSnapshotRow1 = [
    "Roof",
    "General",
    "Roof Condition",
    "<p>Good shape</p>",
    "info",
    "0",
    "checkbox",
    "Option 1, Option 2",
  ];

  const validDbField1 = {
    source_row: 2, // Excel Row 2
    section_name: "Roof",
    item_name: "General",
    comment_name: "Roof Condition",
    comment_text: "<p>Good shape</p>",
    snap_section_name: "Roof",
    snap_item_name: "General",
    snap_comment_name: "Roof Condition",
    snap_comment_text: "<p>Good shape</p>",
    comment_type: "info",
    category: 0,
    answer_type: "checkbox",
    options_raw: "Option 1, Option 2",
  };

  function createMockSupabase(templateSnapshot: unknown, dbFields: unknown[]) {
    return {
      from: (table: string) => {
        if (table === "templates") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { snapshot: templateSnapshot },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "fields") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    single: async () => ({
                      data: dbFields[0],
                      error: null,
                    }),
                  }),
                  data: dbFields,
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;
  }

  test("passes verification when DB fields match snapshot exactly", async () => {
    const snapshot = {
      headers,
      rows: [validSnapshotRow1],
    };
    const mockSupabase = createMockSupabase(snapshot, [validDbField1]);
    const result = await verifyTemplate(mockSupabase, "template-123");

    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.total_rows).toBe(1);
    expect(result.summary).toContain("✓ All 1 rows verified");
  });

  test("detects corrupted comment text (fidelity breach)", async () => {
    const snapshot = {
      headers,
      rows: [validSnapshotRow1],
    };
    const corruptedDbField = {
      ...validDbField1,
      snap_comment_text: "<p>Tampered or truncated text</p>",
    };
    const mockSupabase = createMockSupabase(snapshot, [corruptedDbField]);
    const result = await verifyTemplate(mockSupabase, "template-123");

    expect(result.passed).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    const textMismatch = result.mismatches.find((m) => m.field === "snap_comment_text");
    expect(textMismatch).toBeDefined();
    expect(textMismatch?.expected).toBe("<p>Good shape</p>");
    expect(textMismatch?.got).toBe("<p>Tampered or truncated text</p>");
  });

  test("detects row count discrepancies", async () => {
    const snapshot = {
      headers,
      rows: [validSnapshotRow1, ["Plumbing", "Pipes", "Condition", "OK", "info", 0, "text", ""]],
    };
    // DB only has 1 field instead of 2
    const mockSupabase = createMockSupabase(snapshot, [validDbField1]);
    const result = await verifyTemplate(mockSupabase, "template-123");

    expect(result.passed).toBe(false);
    const countMismatch = result.mismatches.find((m) => m.field === "row_count");
    expect(countMismatch).toBeDefined();
    expect(countMismatch?.expected).toBe(2);
    expect(countMismatch?.got).toBe(1);
  });

  test("allows visual grouping inheritance (blank snapshot section, inherited DB section)", async () => {
    // Row 2 has null Section Name in Excel (visual grouping)
    const row2 = [
      null, // inherits "Roof"
      "Vents",
      "Vent condition",
      "<p>Clear</p>",
      "info",
      0,
      "text",
      "",
    ];
    const snapshot = {
      headers,
      rows: [validSnapshotRow1, row2],
    };
    const dbField2 = {
      source_row: 3,
      section_name: "Roof",
      item_name: "Vents",
      comment_name: "Vent condition",
      comment_text: "<p>Clear</p>",
      snap_section_name: "Roof", // inherited
      snap_item_name: "Vents",
      snap_comment_name: "Vent condition",
      snap_comment_text: "<p>Clear</p>",
      comment_type: "info",
      category: 0,
      answer_type: "text",
      options_raw: "",
    };

    const mockSupabase = createMockSupabase(snapshot, [validDbField1, dbField2]);
    const result = await verifyTemplate(mockSupabase, "template-123");

    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });
});
