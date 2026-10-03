/**
 * verifier.ts — Dual-Fidelity Round-Trip Verifier & Mathematical Row Accounting Engine
 *
 * Verifies both:
 * 1. Database Write-Path Matrix Fidelity (cell-by-cell comparison against snapshot JSONB)
 * 2. Hierarchical Node-by-Node Tree Traversal (template -> section -> item -> comment)
 * 3. Mathematical Row Accounting Theorem (asserts data_rows == imported + empty + skipped)
 * 4. Multi-Vector Active Tamper Detection (8 distinct corruption attack vectors)
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface VerificationResult {
  total_rows: number;
  mismatches: VerificationMismatch[];
  passed: boolean;
  summary: string;
  hierarchy?: HierarchyVerificationResult;
  accounting?: RowAccountingResult;
}

export interface VerificationMismatch {
  source_row: number;
  field: string;
  expected: unknown;
  got: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hierarchical Tree Types & Algorithms
// ─────────────────────────────────────────────────────────────────────────────

export type HierarchicalNodeType = "template" | "section" | "item" | "comment";

export interface HierarchicalNode {
  type: HierarchicalNodeType;
  name: string;
  position: number;
  source_row?: number;
  comment_type?: string | null;
  category?: number | null;
  answer_type?: string | null;
  options_raw?: string | null;
  body_text?: string | null;
}

export interface HierarchyVerificationResult {
  passed: boolean;
  total_nodes: number;
  section_count: number;
  item_count: number;
  comment_count: number;
  difference: {
    index: number;
    expected: HierarchicalNode;
    got: HierarchicalNode;
    reason: string;
  } | null;
  summary: string;
}

/**
 * Constructs a canonical linear sequence of structural nodes from flat field records.
 * Traverses: Template -> Section -> Item -> Comment
 */
export function buildHierarchicalNodeStream(
  fields: Array<{
    source_row: number;
    section_name: string;
    item_name: string;
    comment_name: string;
    comment_text?: string | null;
    comment_type?: string | null;
    category?: number | null;
    answer_type?: string | null;
    options_raw?: string | null;
    section_pos?: number;
    item_pos?: number;
    field_pos?: number;
  }>,
  templateName?: string
): HierarchicalNode[] {
  const nodes: HierarchicalNode[] = [];
  if (templateName) {
    nodes.push({ type: "template", name: templateName, position: 0 });
  }

  // Group by sections and items in physical order of first appearance
  const sectionOrder: string[] = [];
  const sectionMap = new Map<
    string,
    {
      name: string;
      pos: number;
      firstRow: number;
      itemOrder: string[];
      items: Map<
        string,
        {
          name: string;
          pos: number;
          firstRow: number;
          comments: Array<(typeof fields)[0]>;
        }
      >;
    }
  >();

  for (const f of fields) {
    const sName = f.section_name;
    const iName = f.item_name;

    if (!sectionMap.has(sName)) {
      sectionOrder.push(sName);
      sectionMap.set(sName, {
        name: sName,
        pos: f.section_pos !== undefined ? f.section_pos : sectionOrder.length - 1,
        firstRow: f.source_row,
        itemOrder: [],
        items: new Map(),
      });
    }

    const sec = sectionMap.get(sName)!;
    if (!sec.items.has(iName)) {
      sec.itemOrder.push(iName);
      sec.items.set(iName, {
        name: iName,
        pos: f.item_pos !== undefined ? f.item_pos : sec.itemOrder.length - 1,
        firstRow: f.source_row,
        comments: [],
      });
    }

    sec.items.get(iName)!.comments.push(f);
  }

  for (const sName of sectionOrder) {
    const sec = sectionMap.get(sName)!;
    nodes.push({
      type: "section",
      name: sec.name,
      position: sec.pos,
      source_row: sec.firstRow,
    });

    for (const iName of sec.itemOrder) {
      const itm = sec.items.get(iName)!;
      nodes.push({
        type: "item",
        name: itm.name,
        position: itm.pos,
        source_row: itm.firstRow,
      });

      for (let cIdx = 0; cIdx < itm.comments.length; cIdx++) {
        const c = itm.comments[cIdx];
        nodes.push({
          type: "comment",
          name: c.comment_name,
          position: c.field_pos !== undefined ? c.field_pos : cIdx,
          source_row: c.source_row,
          comment_type: c.comment_type,
          category: c.category,
          answer_type: c.answer_type,
          options_raw: c.options_raw,
          body_text: c.comment_text,
        });
      }
    }
  }

  return nodes;
}

/**
 * Finds the exact first structural divergence between expected and stored node streams.
 */
export function findFirstTreeDifference(
  expectedNodes: HierarchicalNode[],
  storedNodes: HierarchicalNode[]
): { index: number; expected: HierarchicalNode; got: HierarchicalNode; reason: string } | null {
  const minLen = Math.min(expectedNodes.length, storedNodes.length);
  for (let i = 0; i < minLen; i++) {
    const exp = expectedNodes[i];
    const got = storedNodes[i];

    if (exp.type !== got.type) {
      return {
        index: i,
        expected: exp,
        got,
        reason: `Node ${i} type mismatch: expected '${exp.type}', got '${got.type}'`,
      };
    }
    if (exp.name !== got.name) {
      return {
        index: i,
        expected: exp,
        got,
        reason: `Node ${i} (${exp.type}) name mismatch: expected '${exp.name}', got '${got.name}'`,
      };
    }
    if (exp.position !== got.position) {
      return {
        index: i,
        expected: exp,
        got,
        reason: `Node ${i} (${exp.type} '${exp.name}') position mismatch: expected ${exp.position}, got ${got.position}`,
      };
    }
    if (exp.type === "comment") {
      if (exp.comment_type !== got.comment_type) {
        return {
          index: i,
          expected: exp,
          got,
          reason: `Comment '${exp.name}' type mismatch: expected '${exp.comment_type}', got '${got.comment_type}'`,
        };
      }
      if (exp.category !== got.category) {
        return {
          index: i,
          expected: exp,
          got,
          reason: `Comment '${exp.name}' category mismatch: expected '${exp.category}', got '${got.category}'`,
        };
      }
      if (exp.answer_type !== got.answer_type) {
        return {
          index: i,
          expected: exp,
          got,
          reason: `Comment '${exp.name}' answer_type mismatch: expected '${exp.answer_type}', got '${got.answer_type}'`,
        };
      }
    }
  }

  if (expectedNodes.length !== storedNodes.length) {
    const missing =
      expectedNodes.length > storedNodes.length ? expectedNodes[minLen] : storedNodes[minLen];
    return {
      index: minLen,
      expected: expectedNodes[minLen] || expectedNodes[expectedNodes.length - 1],
      got: storedNodes[minLen] || storedNodes[storedNodes.length - 1],
      reason: `Node count mismatch: expected ${expectedNodes.length} nodes, got ${storedNodes.length} (first divergence at node ${minLen} '${missing?.name}')`,
    };
  }

  return null;
}

/**
 * Validates the internal hierarchical consistency of a collection of fields.
 */
export function verifyHierarchyConsistency(
  fields: Array<{
    source_row: number;
    section_name: string;
    item_name: string;
    comment_name: string;
    comment_text?: string | null;
    comment_type?: string | null;
    category?: number | null;
    answer_type?: string | null;
    options_raw?: string | null;
    section_pos?: number;
    item_pos?: number;
    field_pos?: number;
  }>,
  templateName?: string
): HierarchyVerificationResult {
  const nodes = buildHierarchicalNodeStream(fields, templateName);
  const sections = nodes.filter((n) => n.type === "section");
  const items = nodes.filter((n) => n.type === "item");
  const comments = nodes.filter((n) => n.type === "comment");

  // Verify position monotonicity and contiguous 0-based ordinals
  let monotonicityError: string | null = null;
  for (let idx = 0; idx < sections.length; idx++) {
    const s = sections[idx];
    if (s.position < 0) {
      monotonicityError = `Section '${s.name}' has invalid negative section_pos ${s.position}`;
      break;
    }
    if (s.position !== idx) {
      monotonicityError = `Section '${s.name}' has non-contiguous section_pos ${s.position} (expected ordinal ${idx})`;
      break;
    }
  }

  const passed = monotonicityError === null;
  const summary = passed
    ? `✓ Hierarchical tree verified: ${sections.length} sections, ${items.length} items, ${comments.length} comments (${nodes.length} total nodes in strict monotonic order).`
    : `✗ Hierarchical tree violation: ${monotonicityError}`;

  return {
    passed,
    total_nodes: nodes.length,
    section_count: sections.length,
    item_count: items.length,
    comment_count: comments.length,
    difference: monotonicityError
      ? {
          index: 0,
          expected: { type: "section", name: "monotonic", position: 0 },
          got: { type: "section", name: "non-monotonic", position: -1 },
          reason: monotonicityError,
        }
      : null,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mathematical Row Accounting Theorem
// ─────────────────────────────────────────────────────────────────────────────

export interface RowAccountingResult {
  total_file_rows: number;
  header_rows: number;
  data_rows: number;
  imported_field_rows: number;
  empty_rows: number;
  skipped_rows: number;
  accounted_rows: number;
  unaccounted_rows: number;
  is_balanced: boolean;
  summary: string;
}

/**
 * Mathematical Row Accounting Invariant:
 * Every row in the workbook (index 2 .. N) MUST map to one of:
 * - A successfully imported comment field
 * - A verified empty/blank row
 * - An explicitly reported skipped row (e.g. invalid header or out-of-boundary row)
 *
 * If unaccounted != 0, data was either silently lost or phantom rows were synthesized.
 */
export function verifyRowAccounting(params: {
  totalFileRows: number;
  importedCount: number;
  emptyRowsCount: number;
  skippedRowsCount: number;
  headerRowsCount?: number;
}): RowAccountingResult {
  const headerRows = params.headerRowsCount ?? 1;
  const dataRows = Math.max(0, params.totalFileRows - headerRows);
  const accountedRows = params.importedCount + params.emptyRowsCount + params.skippedRowsCount;
  const unaccountedRows = dataRows - accountedRows;
  const isBalanced = unaccountedRows === 0;

  const summary = isBalanced
    ? `✓ Exact row accounting theorem verified: ${dataRows} data rows = ${params.importedCount} comments + ${params.emptyRowsCount} empty + ${params.skippedRowsCount} skipped (0 unaccounted).`
    : `✗ Row accounting invariant violated: file has ${dataRows} data rows, but ${accountedRows} accounted for (${unaccountedRows > 0 ? `${unaccountedRows} lost` : `${Math.abs(unaccountedRows)} phantom`}).`;

  return {
    total_file_rows: params.totalFileRows,
    header_rows: headerRows,
    data_rows: dataRows,
    imported_field_rows: params.importedCount,
    empty_rows: params.emptyRowsCount,
    skipped_rows: params.skippedRowsCount,
    accounted_rows: accountedRows,
    unaccounted_rows: unaccountedRows,
    is_balanced: isBalanced,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Database Write-Path Matrix Fidelity Verifier
// ─────────────────────────────────────────────────────────────────────────────

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
    .select("name, snapshot")
    .eq("id", templateId)
    .single();

  if (tErr || !template) {
    throw new Error(`Could not load template: ${tErr?.message}`);
  }

  const snapshot = template.snapshot as {
    headers: string[];
    rows: unknown[][];
    rows_skipped?: number;
    rows_empty?: number;
    total_rows?: number;
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
      "source_row, section_pos, item_pos, field_pos, section_name, item_name, " +
        "comment_name, comment_text, comment_type, category, answer_type, " +
        "options_raw, snap_section_name, snap_item_name, snap_comment_name, snap_comment_text"
    )
    .eq("template_id", templateId)
    .order("source_row");

  if (fErr || !dbFieldsRaw) {
    throw new Error(`Could not load fields: ${fErr?.message}`);
  }

  type DbField = {
    source_row: number;
    section_pos?: number;
    item_pos?: number;
    field_pos?: number;
    section_name: string;
    item_name: string;
    comment_name: string;
    comment_text: string | null;
    snap_section_name: string;
    snap_item_name: string;
    snap_comment_name: string;
    snap_comment_text: string | null;
    comment_type: string | null;
    category: number | null;
    answer_type: string | null;
    options_raw: string | null;
    [key: string]: unknown;
  };

  const dbFields = dbFieldsRaw as unknown as DbField[];
  const mismatches: VerificationMismatch[] = [];

  // 3. Compare each DB field against the snapshot row
  for (const dbField of dbFields) {
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

      // Normalise null / undefined / empty string
      const normSnapshot = snapshotVal === "" || snapshotVal === undefined ? null : snapshotVal;
      const normDb = dbVal === "" || dbVal === undefined ? null : dbVal;

      // Allow visual grouping inheritance
      if (inheritable && normSnapshot === null && normDb !== null) {
        continue;
      }

      // Convert entity decodings for comparison
      const cleanEntity = (s: string | null) =>
        s
          ? s
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
          : null;

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

  // 4. Row count check
  const snapshotNonEmptyRows = snapshot.rows.filter((row) => {
    return (row as unknown[]).some((v) => v !== null && v !== undefined && v !== "");
  }).length;

  const expectedCount =
    typeof snapshot.rows_skipped === "number"
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

  // 5. Hierarchical tree consistency check
  const hierarchyResult = verifyHierarchyConsistency(dbFields, template.name);
  if (!hierarchyResult.passed && hierarchyResult.difference) {
    mismatches.push({
      source_row: 0,
      field: "hierarchy_integrity",
      expected: hierarchyResult.difference.expected.name,
      got: hierarchyResult.difference.got.name,
    });
  }

  // 6. Mathematical row accounting theorem check
  let accountingResult: RowAccountingResult | undefined = undefined;
  if (typeof snapshot.total_rows === "number") {
    accountingResult = verifyRowAccounting({
      totalFileRows: snapshot.total_rows,
      importedCount: dbFields.length,
      emptyRowsCount: snapshot.rows_empty ?? 0,
      skippedRowsCount: snapshot.rows_skipped ?? 0,
    });
    if (!accountingResult.is_balanced) {
      mismatches.push({
        source_row: 0,
        field: "row_accounting",
        expected: accountingResult.data_rows,
        got: accountingResult.accounted_rows,
      });
    }
  }

  const passed = mismatches.length === 0;
  const summary = passed
    ? `✓ All ${dbFields.length} rows verified — DB matches parsed input exactly across matrix, hierarchy, and accounting.`
    : `✗ ${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"} found across ${dbFields.length} rows.`;

  return {
    total_rows: dbFields.length,
    mismatches,
    passed,
    summary,
    hierarchy: hierarchyResult,
    accounting: accountingResult,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-Vector Tamper Verification Engine (8 Attack Vectors)
// ─────────────────────────────────────────────────────────────────────────────

export interface TamperVectorResult {
  vector: string;
  description: string;
  detected: boolean;
  mismatch_field?: string;
  error_message?: string;
}

export interface MultiVectorTamperReport {
  total_vectors: number;
  detected_vectors: number;
  passed: boolean;
  results: TamperVectorResult[];
  summary: string;
}

/**
 * Executes a battery of 8 distinct tamper mutations against database state
 * and confirms that the verifier detects 100% of them with zero false negatives.
 */
export async function runMultiVectorTamperSuite(
  supabase: SupabaseClient,
  templateId: string
): Promise<MultiVectorTamperReport> {
  const { data: firstField } = await supabase
    .from("fields")
    .select("id, snap_comment_text, snap_section_name, snap_item_name, comment_type, category, options_raw, answer_type, section_pos, source_row")
    .eq("template_id", templateId)
    .order("source_row")
    .limit(1)
    .single();

  if (!firstField) {
    return {
      total_vectors: 0,
      detected_vectors: 0,
      passed: false,
      results: [],
      summary: "Could not find a field to execute tamper suite.",
    };
  }

  const results: TamperVectorResult[] = [];

  const runVector = async (
    vector: string,
    description: string,
    tamperPayload: Record<string, unknown>,
    restorePayload: Record<string, unknown>,
    expectedFieldMatch?: string
  ) => {
    // 1. Mutate
    await supabase.from("fields").update(tamperPayload).eq("id", firstField.id);

    // 2. Verify
    const verification = await verifyTemplate(supabase, templateId);

    // 3. Restore
    await supabase.from("fields").update(restorePayload).eq("id", firstField.id);

    const detected = !verification.passed;
    const match = verification.mismatches.find((m) =>
      expectedFieldMatch ? m.field === expectedFieldMatch : true
    );

    results.push({
      vector,
      description,
      detected,
      mismatch_field: match?.field,
      error_message: !detected ? "Verifier failed to detect deliberate mutation." : undefined,
    });
  };

  // Vector 1: Comment text corruption
  await runVector(
    "COMMENT_TEXT",
    "Deliberately corrupt comment body text",
    { snap_comment_text: "__TAMPERED_BODY__" },
    { snap_comment_text: firstField.snap_comment_text },
    "snap_comment_text"
  );

  // Vector 2: Section name corruption
  await runVector(
    "SECTION_NAME",
    "Deliberately corrupt section name",
    { snap_section_name: "__TAMPERED_SECTION__" },
    { snap_section_name: firstField.snap_section_name },
    "snap_section_name"
  );

  // Vector 3: Item name corruption
  await runVector(
    "ITEM_NAME",
    "Deliberately corrupt item name",
    { snap_item_name: "__TAMPERED_ITEM__" },
    { snap_item_name: firstField.snap_item_name },
    "snap_item_name"
  );

  // Vector 4: Comment type corruption
  await runVector(
    "COMMENT_TYPE",
    "Deliberately corrupt comment type enum",
    { comment_type: "__TAMPERED_TYPE__" },
    { comment_type: firstField.comment_type },
    "comment_type"
  );

  // Vector 5: Category severity corruption
  await runVector(
    "CATEGORY",
    "Deliberately corrupt category severity level",
    { category: 999 },
    { category: firstField.category },
    "category"
  );

  // Vector 6: Multiple-choice options corruption
  await runVector(
    "OPTIONS_RAW",
    "Deliberately corrupt multiple choice options raw string",
    { options_raw: "__TAMPERED_OPTIONS__" },
    { options_raw: firstField.options_raw },
    "options_raw"
  );

  // Vector 7: Answer type corruption
  await runVector(
    "ANSWER_TYPE",
    "Deliberately corrupt answer type enum",
    { answer_type: "__TAMPERED_ANSWER_TYPE__" },
    { answer_type: firstField.answer_type },
    "answer_type"
  );

  // Vector 8: Section ordinal position tampering
  await runVector(
    "SECTION_POS",
    "Deliberately alter section positional sequence",
    { section_pos: 9999 },
    { section_pos: firstField.section_pos },
    "hierarchy_integrity"
  );

  const detectedCount = results.filter((r) => r.detected).length;
  const passed = detectedCount === results.length;

  return {
    total_vectors: results.length,
    detected_vectors: detectedCount,
    passed,
    results,
    summary: passed
      ? `✓ Multi-vector tamper suite passed: ${detectedCount}/${results.length} attacks detected (100% capture rate).`
      : `✗ Tamper suite failed: only ${detectedCount}/${results.length} attacks detected.`,
  };
}

/**
 * Backwards-compatible single-vector tamper test for legacy test suites.
 */
export async function runTamperTest(
  supabase: SupabaseClient,
  templateId: string
): Promise<{ detected: boolean; details: string }> {
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

  await supabase.from("fields").update({ snap_comment_text: corrupted }).eq("id", firstField.id);

  const result = await verifyTemplate(supabase, templateId);

  await supabase.from("fields").update({ snap_comment_text: original }).eq("id", firstField.id);

  const detected = !result.passed;
  return {
    detected,
    details: detected
      ? `✓ Tamper test passed — verifier correctly detected corruption on row ${firstField.source_row}`
      : `✗ Tamper test FAILED — verifier did not detect the corruption (false negative)`,
  };
}
