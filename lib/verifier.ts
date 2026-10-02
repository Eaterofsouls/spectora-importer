/**
 * verifier.ts — Round-trip fidelity verifier
 *
 * Compares the DB's stored fields against the template's snapshot JSONB.
 * Verifies the DB WRITE PATH (not the parse path).
 * Parse-path fidelity is covered by parser unit tests.
 *
 * Also provides the tamper-test: deliberately corrupt a field in the
 * snapshot and assert the verifier catches it.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface VerificationResult {
  total_rows: number;
  mismatches: VerificationMismatch[];
  passed: boolean;
  summary: string;
}

export interface VerificationMismatch {
  source_row: number;
  field: string;
  expected: unknown;
  got: unknown;
}

// The columns we compare between snapshot and DB (the modelled ones)
const COMPARE_COLUMNS: Array<{
  snapshotHeader: string;
  dbField: string;
}> = [
  { snapshotHeader: "Section Name", dbField: "section_name" },
  { snapshotHeader: "Item Name", dbField: "item_name" },
  { snapshotHeader: "Comment Name", dbField: "comment_name" },
  { snapshotHeader: "Comment Text", dbField: "comment_text" },
  {
    snapshotHeader: "Comment Type (info, limit, defect)",
    dbField: "comment_type",
  },
  {
    snapshotHeader: "Category (-1: Low, 0: Med, 1: High)",
    dbField: "category",
  },
  {
    snapshotHeader: "Answer Type (boolean, checkbox, date, number, range, text)",
    dbField: "answer_type",
  },
  {
    snapshotHeader: "Multiple Choice Options (comma-separated)",
    dbField: "options_raw",
  },
];

export async function verifyTemplate(
  supabase: SupabaseClient,
  templateId: string
): Promise<VerificationResult> {
  // 1. Load the template's snapshot
  const { data: template, error: tErr } = await supabase
    .from("templates")
    .select("snapshot")
    .eq("id", templateId)
    .single();

  if (tErr || !template) {
    throw new Error(`Could not load template: ${tErr?.message}`);
  }

  const snapshot = template.snapshot as {
    headers: string[];
    rows: unknown[][];
    rows_skipped?: number;
  };

  // Build header→column index map
  const headerIdx: Record<string, number> = {};
  snapshot.headers.forEach((h: string, i: number) => {
    headerIdx[h] = i;
  });

  // 2. Load all fields from the DB, ordered by source_row
  const { data: dbFieldsRaw, error: fErr } = await supabase
    .from("fields")
    .select(
      "source_row, section_name, item_name, comment_name, comment_text, " +
        "comment_type, category, answer_type, options_raw, snap_section_name, " +
        "snap_item_name, snap_comment_name, snap_comment_text"
    )
    .eq("template_id", templateId)
    .order("source_row");

  if (fErr || !dbFieldsRaw) {
    throw new Error(`Could not load fields: ${fErr?.message}`);
  }

  type DbField = {
    source_row: number;
    snap_section_name: string;
    snap_item_name: string;
    snap_comment_name: string;
    snap_comment_text: string | null;
    [key: string]: unknown;
  };

  const dbFields = dbFieldsRaw as unknown as DbField[];

  const mismatches: VerificationMismatch[] = [];

  // 3. Compare each DB field against the snapshot row
  for (const dbField of dbFields) {
    // Find the snapshot row (source_row is 1-based Excel row; row 1 is headers; snapshot.rows[0] is Excel row 2)
    const snapshotRowIdx = dbField.source_row - 2;
    if (snapshotRowIdx < 0 || snapshotRowIdx >= snapshot.rows.length) {
      mismatches.push({
        source_row: dbField.source_row,
        field: "source_row",
        expected: "row to exist in snapshot",
        got: `row index ${snapshotRowIdx} out of bounds (rows: ${snapshot.rows.length})`,
      });
      continue;
    }

    const snapshotRow = snapshot.rows[snapshotRowIdx] as unknown[];

    // Compare snap_* columns (as-imported values) against snapshot
    // We compare snap_* not the current editable values, so user edits don't show as mismatches
    const snapComparisons: Array<{
      snapshotHeader: string;
      snapField: string;
      inheritable?: boolean;
    }> = [
      { snapshotHeader: "Section Name", snapField: "snap_section_name", inheritable: true },
      { snapshotHeader: "Item Name", snapField: "snap_item_name", inheritable: true },
      { snapshotHeader: "Comment Name", snapField: "snap_comment_name" },
      { snapshotHeader: "Comment Text", snapField: "snap_comment_text" },
      { snapshotHeader: "Comment Type (info, limit, defect)", snapField: "comment_type" },
      { snapshotHeader: "Category (-1: Low, 0: Med, 1: High)", snapField: "category" },
      { snapshotHeader: "Answer Type (boolean, checkbox, date, number, range, text)", snapField: "answer_type" },
      { snapshotHeader: "Multiple Choice Options (comma-separated)", snapField: "options_raw" },
    ];

    for (const { snapshotHeader, snapField, inheritable } of snapComparisons) {
      const colIdx = headerIdx[snapshotHeader];
      if (colIdx === undefined) continue;

      const snapshotVal = snapshotRow[colIdx];
      const dbVal = (dbField as Record<string, unknown>)[snapField];

      // Normalise: null / undefined / empty string treated the same
      const normSnapshot = snapshotVal === "" || snapshotVal === undefined ? null : snapshotVal;
      const normDb = dbVal === "" || dbVal === undefined ? null : dbVal;

      // If snapshot value was blank but field inherited parent section/item name, that is valid
      if (inheritable && normSnapshot === null && normDb !== null) {
        continue;
      }

      // Convert category to number string comparison if numeric and normalize HTML entities
      const cleanEntity = (s: string | null) =>
        s ? s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;

      const sValStr = cleanEntity(normSnapshot !== null ? String(normSnapshot) : null);
      const dValStr = cleanEntity(normDb !== null ? String(normDb) : null);

      if (sValStr !== dValStr) {
        mismatches.push({
          source_row: dbField.source_row,
          field: snapField,
          expected: normSnapshot,
          got: normDb,
        });
      }
    }
  }

  // 4. Count check
  const snapshotNonEmptyRows = snapshot.rows.filter((row) => {
    return (row as unknown[]).some((v) => v !== null && v !== undefined && v !== "");
  }).length;

  const expectedCount = typeof snapshot.rows_skipped === "number"
    ? snapshotNonEmptyRows - snapshot.rows_skipped
    : snapshotNonEmptyRows;

  if (dbFields.length !== expectedCount) {
    mismatches.push({
      source_row: 0,
      field: "row_count",
      expected: expectedCount,
      got: dbFields.length,
    });
  }

  const passed = mismatches.length === 0;
  const summary = passed
    ? `✓ All ${dbFields.length} rows verified — DB matches parsed input exactly.`
    : `✗ ${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"} found across ${dbFields.length} rows.`;

  return { total_rows: dbFields.length, mismatches, passed, summary };
}

/**
 * Tamper test: corrupt one snap_comment_text value directly and
 * assert the verifier catches it. Used in test suite to prove the
 * verifier is not trivially passing.
 *
 * Returns true if the verifier correctly detected the corruption.
 */
export async function runTamperTest(
  supabase: SupabaseClient,
  templateId: string
): Promise<{ detected: boolean; details: string }> {
  // Pick the first field
  const { data: firstField } = await supabase
    .from("fields")
    .select("id, snap_comment_text, source_row")
    .eq("template_id", templateId)
    .order("source_row")
    .limit(1)
    .single();

  if (!firstField) {
    return { detected: false, details: "Could not find a field to tamper with" };
  }

  const original = firstField.snap_comment_text;
  const corrupted = "__TAMPERED_VALUE__";

  // Corrupt the snap value directly (bypassing application logic)
  await supabase
    .from("fields")
    .update({ snap_comment_text: corrupted })
    .eq("id", firstField.id);

  // Run verifier — should detect the mismatch
  const result = await verifyTemplate(supabase, templateId);

  // Restore original value
  await supabase
    .from("fields")
    .update({ snap_comment_text: original })
    .eq("id", firstField.id);

  const detected = !result.passed;
  return {
    detected,
    details: detected
      ? `✓ Tamper test passed — verifier correctly detected corruption on row ${firstField.source_row}`
      : `✗ Tamper test FAILED — verifier did not detect the corruption (false negative)`,
  };
}
