/**
 * tests/tamper-suite.test.ts
 *
 * Active Multi-Vector Tamper Verification Engine Test Suite.
 *
 * Systematically attacks the database write path across 8 distinct corruption vectors:
 * 1. COMMENT_TEXT: Corrupts comment body markup
 * 2. SECTION_NAME: Corrupts section name
 * 3. ITEM_NAME: Corrupts item name
 * 4. COMMENT_TYPE: Corrupts comment type enum
 * 5. CATEGORY: Corrupts category severity value
 * 6. OPTIONS_RAW: Corrupts multiple choice options raw string
 * 7. ANSWER_TYPE: Corrupts answer type enum
 * 8. SECTION_POS: Alters hierarchical section ordering sequence
 *
 * Proves 100% attack detection rate with zero false negatives.
 */

import { runMultiVectorTamperSuite, verifyTemplate } from "../lib/verifier";
import { SupabaseClient } from "@supabase/supabase-js";

describe("Active Multi-Vector Tamper Suite (8 Attack Vectors)", () => {
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

  const snapshotRows = [
    [
      "Roofing",
      "Coverings",
      "Asphalt Shingles",
      "<p>Architectural asphalt shingles observed.</p>",
      "info",
      0,
      "text",
      "",
    ],
  ];

  function createTamperableMock(initialFieldOverrides = {}) {
    const fieldState = {
      id: "field-1",
      template_id: "template-1",
      source_row: 2,
      section_pos: 0,
      item_pos: 0,
      field_pos: 0,
      section_name: "Roofing",
      item_name: "Coverings",
      comment_name: "Asphalt Shingles",
      comment_text: "<p>Architectural asphalt shingles observed.</p>",
      snap_section_name: "Roofing",
      snap_item_name: "Coverings",
      snap_comment_name: "Asphalt Shingles",
      snap_comment_text: "<p>Architectural asphalt shingles observed.</p>",
      comment_type: "info",
      category: 0,
      answer_type: "text",
      options_raw: "",
      ...initialFieldOverrides,
    };

    const templateState = {
      id: "template-1",
      name: "Residential Template",
      snapshot: {
        headers,
        rows: snapshotRows,
        rows_skipped: 0,
        rows_empty: 0,
        total_rows: 2,
      },
    };

    const mockSupabase = {
      from: (table: string) => {
        if (table === "templates") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: templateState,
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
                      data: { ...fieldState },
                      error: null,
                    }),
                  }),
                  data: [{ ...fieldState }],
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: async () => {
                Object.assign(fieldState, payload);
                return { error: null };
              },
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    return { mockSupabase, fieldState };
  }

  test("runs all 8 tamper attack vectors and detects 100% of mutations", async () => {
    const { mockSupabase } = createTamperableMock();

    const report = await runMultiVectorTamperSuite(mockSupabase, "template-1");

    expect(report.total_vectors).toBe(8);
    expect(report.detected_vectors).toBe(8);
    expect(report.passed).toBe(true);
    expect(report.summary).toContain("8/8 attacks detected (100% capture rate)");

    // Verify all 8 individual vectors are marked detected
    const vectors = report.results.map((r) => r.vector);
    expect(vectors).toEqual([
      "COMMENT_TEXT",
      "SECTION_NAME",
      "ITEM_NAME",
      "COMMENT_TYPE",
      "CATEGORY",
      "OPTIONS_RAW",
      "ANSWER_TYPE",
      "SECTION_POS",
    ]);

    for (const r of report.results) {
      expect(r.detected).toBe(true);
      expect(r.error_message).toBeUndefined();
    }
  });

  test("verifies baseline state is clean before and after tamper suite", async () => {
    const { mockSupabase } = createTamperableMock();

    // Baseline check before
    const before = await verifyTemplate(mockSupabase, "template-1");
    expect(before.passed).toBe(true);
    expect(before.mismatches).toHaveLength(0);

    // Run suite
    const report = await runMultiVectorTamperSuite(mockSupabase, "template-1");
    expect(report.passed).toBe(true);

    // Baseline check after (proves complete state restoration)
    const after = await verifyTemplate(mockSupabase, "template-1");
    expect(after.passed).toBe(true);
    expect(after.mismatches).toHaveLength(0);
  });
});
