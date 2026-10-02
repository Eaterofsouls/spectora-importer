/**
 * parser.ts — Spectora "Export HTML Text" OOXML parser
 *
 * Parser Design Decisions:
 * - Magic-byte format detection, not extension-based
 * - SheetJS with { raw: true } to prevent silent type coercion (dates, numbers, strings preserved)
 * - Iterates over full !ref range to catch blank rows and maintain physical row alignment
 * - Physical row order → section_pos/item_pos/field_pos (never relies on tied Order column)
 * - Stores options_raw as raw string — never prematurely split on commas
 * - Visual grouping inheritance: carries forward parent section/item for blank rows
 * - Disjoint section detection: merges non-contiguous blocks with user warnings
 */

import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedField {
  source_row: number; // 1-based physical row index (including blank rows)
  section_pos: number; // 0-based ordinal of section (order of first appearance)
  item_pos: number; // 0-based ordinal of item within section
  field_pos: number; // 0-based ordinal of field within (section, item)

  // Editable columns
  section_name: string;
  item_name: string;
  comment_name: string;
  comment_text: string | null; // null = 83 "empty text" rows — preserve, never drop

  // Behaviour columns (stored, read-only in UI)
  comment_type: string | null; // info | limit | defect
  category: number | null; // -1 | 0 | 1 | null
  answer_type: string | null; // boolean | checkbox | date | number | range | text
  options_raw: string | null; // raw comma-joined string; NEVER parsed and discarded

  // Snapshot of as-imported editable fields (immutable after insert)
  snap_section_name: string;
  snap_item_name: string;
  snap_comment_name: string;
  snap_comment_text: string | null;

  // All 42 columns keyed by header — nothing dropped
  raw_cells: Record<string, unknown>;
}

export interface ParsedTemplate {
  source_filename: string;
  headers: string[];
  snapshot_rows: unknown[][]; // full 42×N matrix for verifier
  fields: ParsedField[];
  issues: ImportIssue[];
  rows_skipped?: number;
  rows_processed?: number;
  rows_empty?: number;
}

export interface ImportIssue {
  source_row: number | null; // null = file-level issue
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Required headers (order-insensitive). A superset is OK; missing = error.
const REQUIRED_HEADERS = new Set([
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
]);

// Spectora HTML download page detection: contains this string near the top
const SPECTORA_DOWNLOAD_PAGE_MARKER =
  "your download is ready";

// Magic byte signatures
const OOXML_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK zip
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy binary .xls

// ─── Format detection ────────────────────────────────────────────────────────

export type FileFormat =
  | "ooxml"
  | "ole2_legacy"
  | "spectora_download_page"
  | "plain_text"
  | "unknown";

export function detectFormat(buffer: Buffer): FileFormat {
  if (buffer.length < 4) return "unknown";

  // Check OOXML (PK zip)
  if (
    buffer[0] === OOXML_MAGIC[0] &&
    buffer[1] === OOXML_MAGIC[1] &&
    buffer[2] === OOXML_MAGIC[2] &&
    buffer[3] === OOXML_MAGIC[3]
  ) {
    return "ooxml";
  }

  // Check OLE2 legacy binary .xls
  if (
    buffer[0] === OLE2_MAGIC[0] &&
    buffer[1] === OLE2_MAGIC[1] &&
    buffer[2] === OLE2_MAGIC[2] &&
    buffer[3] === OLE2_MAGIC[3]
  ) {
    return "ole2_legacy";
  }

  // Text-based: check for Spectora download page HTML
  const head = buffer.subarray(0, 2048).toString("utf8").toLowerCase();
  if (head.includes(SPECTORA_DOWNLOAD_PAGE_MARKER)) {
    return "spectora_download_page";
  }

  // Could be plain-text export or other text
  if (head.startsWith("section") || head.includes("\t") || head.includes(",")) {
    return "plain_text";
  }

  return "unknown";
}

// Human-readable error messages by format
export const FORMAT_ERRORS: Record<string, { code: string; message: string }> =
  {
    ole2_legacy: {
      code: "LEGACY_XLS_FORMAT",
      message:
        "This appears to be an older Excel binary file (.xls OLE2 format). " +
        "Spectora exports use a newer format (OOXML). " +
        "Please re-export using Templates → Export to Spreadsheet → Export HTML Text.",
    },
    spectora_download_page: {
      code: "SPECTORA_DOWNLOAD_PAGE",
      message:
        "This looks like the Spectora 'Your download is ready' page, not the spreadsheet itself. " +
        "Click the 'Download File' button on that page, then upload the downloaded file here.",
    },
    plain_text: {
      code: "PLAIN_TEXT_EXPORT",
      message:
        "This appears to be a plain-text export. Spectora's plain-text export loses HTML " +
        "formatting (bold, links, paragraph breaks). " +
        "Please re-export using Templates → Export to Spreadsheet → Export HTML Text.",
    },
    unknown: {
      code: "NOT_A_SPREADSHEET",
      message:
        "This file does not appear to be a Spectora spreadsheet export. " +
        "Expected an OOXML file from Templates → Export to Spreadsheet → Export HTML Text.",
    },
  };

export function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function normalizeHeaderName(h: string): string {
  return h.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseSpectoraExport(
  buffer: Buffer,
  filename: string
): ParsedTemplate {
  const issues: ImportIssue[] = [];

  // 1. Format detection
  const fmt = detectFormat(buffer);
  if (fmt !== "ooxml") {
    const err = FORMAT_ERRORS[fmt] ?? FORMAT_ERRORS["unknown"];
    throw new ParseError(err.code, err.message);
  }

  // 2. Parse with SheetJS — raw:true prevents type coercion
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, {
      type: "buffer",
      raw: true,        // no type coercion — strings stay strings
      cellDates: false, // dates stay as strings
      cellNF: false,    // no number formatting
      cellText: false,
    });
  } catch (e) {
    throw new ParseError(
      "PARSE_FAILED",
      `Could not parse this file as a spreadsheet: ${(e as Error).message}`
    );
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new ParseError("EMPTY_WORKBOOK", "The file contains no sheets.");
  }
  const ws = wb.Sheets[sheetName];

  // 3. Extract headers from row 1
  const ref = ws["!ref"];
  if (!ref) {
    throw new ParseError("EMPTY_SHEET", "The sheet appears to be empty.");
  }

  const range = XLSX.utils.decode_range(ref);
  const numCols = range.e.c + 1;

  // Read headers from row 0
  const headers: string[] = [];
  for (let c = 0; c < numCols; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v ?? "") : "");
  }

  if (headers.every((h) => h === "")) {
    throw new ParseError("EMPTY_SHEET", "The first row has no headers.");
  }

  // 4. Validate headers
  const headerSet = new Set(headers.filter(Boolean));
  const normHeaderMap = new Map<string, string>();
  for (const h of headers.filter(Boolean)) {
    normHeaderMap.set(normalizeHeaderName(h), h);
  }

  const missing: string[] = [];
  for (const req of REQUIRED_HEADERS) {
    const normReq = normalizeHeaderName(req);
    if (!headerSet.has(req) && !normHeaderMap.has(normReq)) {
      missing.push(req);
    }
  }
  if (missing.length > 0) {
    throw new ParseError(
      "MISSING_HEADERS",
      `Missing required columns: ${missing.join(", ")}. ` +
        `This may not be a Spectora 'Export HTML Text' file, ` +
        `or it may be a different export type.`
    );
  }

  // Column index lookup by header name (both exact and normalized)
  const colIdx: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) {
      colIdx[h] = i;
      colIdx[normalizeHeaderName(h)] = i;
    }
  });

  // Helper to read a cell as string
  function cellStr(row: number, header: string): string | null {
    let c = colIdx[header];
    if (c === undefined) {
      c = colIdx[normalizeHeaderName(header)];
    }
    if (c === undefined) return null;
    const cell = ws[XLSX.utils.encode_cell({ r: row, c })];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") {
      return null;
    }
    return String(cell.v);
  }

  function cellNum(row: number, header: string): number | null {
    const s = cellStr(row, header);
    if (s === null) return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  // 5. Iterate ALL rows (including blank) — never use sheet_to_json
  //    This preserves source_row accuracy even if there are blank rows
  const fields: ParsedField[] = [];
  const snapshotRows: unknown[][] = [];

  // Track hierarchy state
  let sectionPos = -1;
  let maxSectionPos = -1;
  let currentSection = "";
  let lastSeenSectionName: string | null = null; // for blank-cell inheritance
  let lastSeenItemName: string | null = null;     // for blank-cell inheritance
  const sectionItemPos: Record<number, number> = {};
  const sectionItemFieldPos: Record<string, number> = {};
  const itemSeenOrders: Record<string, Set<number>> = {};

  // Disjoint block detection: tracks whether we've seen a section/item before
  // and whether it appeared AFTER something else (non-contiguous)
  const seenSectionNames = new Set<string>();
  const closedSections = new Set<string>(); // sections we left and may not come back to
  const sectionNameToPos: Record<string, number> = {}; // section name → first sectionPos
  let prevSection = "";

  // Row accountability counters (proves processed + empty + skipped = total)
  let rowsProcessed = 0;
  let rowsEmpty = 0;
  let rowsSkipped = 0;

  // Detect if file looks like plain-text (no HTML in any comment text)
  let anyHtmlFound = false;

  const numDataRows = range.e.r; // last row index (0-based); row 0 = headers

  for (let r = 1; r <= numDataRows; r++) {
    // Build raw cell array for this row (snapshot)
    const rawRow: unknown[] = headers.map((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      return cell ? cell.v ?? null : null;
    });
    snapshotRows.push(rawRow);

    const rawSectionName = cellStr(r, "Section Name");
    const rawItemName    = cellStr(r, "Item Name");
    const commentName    = cellStr(r, "Comment Name");

    // Blank row — skip but keep source_row counter accurate
    if (!rawSectionName && !rawItemName && !commentName) {
      rowsEmpty++;
      continue;
    }

    // ── BLANK CELL INHERITANCE & ITEM ISOLATION ────────────────────────────
    // Spectora uses Excel visual grouping: rows in the same section/item leave
    // the Section Name / Item Name cell blank. Carry forward the last non-blank
    // value. When a new section starts, clear lastSeenItemName so items from the
    // previous section never contaminate the new section.
    if (rawSectionName && rawSectionName !== lastSeenSectionName) {
      lastSeenItemName = null;
      lastSeenSectionName = rawSectionName;
    }
    if (rawItemName) {
      lastSeenItemName = rawItemName;
    }

    const effectiveRawSection = rawSectionName ?? lastSeenSectionName;
    const effectiveRawItem = rawItemName ?? lastSeenItemName;

    let sectionName = effectiveRawSection ? decodeEntities(effectiveRawSection) : "";
    let itemName = effectiveRawItem ? decodeEntities(effectiveRawItem) : "";

    // If still no section name even after inheritance, it is a true orphan
    if (!sectionName) {
      issues.push({
        source_row: r + 1,
        severity: "warning",
        code: "ORPHAN_ROW",
        message: `Row ${r + 1} has no Section Name (and no previous section to inherit). Skipped.`,
      });
      rowsSkipped++;
      continue;
    }

    // ── DISJOINT SECTION DETECTION ───────────────────────────────────────────
    if (sectionName !== prevSection) {
      if (seenSectionNames.has(sectionName) && closedSections.has(sectionName)) {
        // We LEFT this section, went somewhere else, and came back — non-contiguous
        issues.push({
          source_row: r + 1,
          severity: "warning",
          code: "DISJOINT_SECTION",
          message: `Section "${sectionName}" appears again at row ${r + 1} after other sections. ` +
            `Spectora may have split it — rows are merged into the original section block.`,
        });
        // Reuse original sectionPos for this section name (so disjoint rows merge)
        const originalPos = (sectionNameToPos as Record<string, number>)[sectionName];
        sectionPos = originalPos;
        currentSection = sectionName;
        prevSection = sectionName;
      } else {
        // Genuinely new section (or first time seeing it)
        if (prevSection) closedSections.add(prevSection);
        seenSectionNames.add(sectionName);
        prevSection = sectionName;
        if (sectionName !== currentSection) {
          maxSectionPos++;
          sectionPos = maxSectionPos;
          currentSection = sectionName;
          sectionItemPos[sectionPos] = -1;
          // Record this section's position for potential disjoint merge later
          (sectionNameToPos as Record<string, number>)[sectionName] = sectionPos;
        }
      }
    }

    const effectiveSection = sectionName;

    // Track item position within section
    const itemKey = `${sectionPos}::${itemName ?? ""}`;
    if (!Object.prototype.hasOwnProperty.call(sectionItemPos, itemKey + "_seen")) {
      // First time we see this (section_pos, item_name) combination
      sectionItemPos[sectionPos] = (sectionItemPos[sectionPos] ?? -1) + 1;
      (sectionItemPos as Record<string, number>)[itemKey + "_seen"] = 1;
      (sectionItemPos as Record<string, number>)[itemKey + "_pos"] =
        sectionItemPos[sectionPos];
      sectionItemFieldPos[itemKey] = -1;
    }

    const currentItemPos = (sectionItemPos as Record<string, number>)[
      itemKey + "_pos"
    ];
    sectionItemFieldPos[itemKey] = (sectionItemFieldPos[itemKey] ?? -1) + 1;
    const currentFieldPos = sectionItemFieldPos[itemKey];

    // Comment text
    const commentText = cellStr(r, "Comment Text");
    if (commentText === null) {
      issues.push({
        source_row: r + 1,
        severity: "info",
        code: "EMPTY_COMMENT_TEXT",
        message: `Row ${r + 1}: "${commentName ?? ""}" has no comment text (normal for input fields).`,
      });
    } else if (/<[a-z]/.test(commentText)) {
      anyHtmlFound = true;
    }

    // Order column — check for ties within item
    const orderVal = cellStr(r, "Order (w/i item)");
    if (orderVal !== null) {
      const orderNum = Number(orderVal);
      if (!isNaN(orderNum)) {
        if (!itemSeenOrders[itemKey]) {
          itemSeenOrders[itemKey] = new Set<number>();
        }
        if (itemSeenOrders[itemKey].has(orderNum)) {
          issues.push({
            source_row: r + 1,
            severity: "info",
            code: "ORDER_TIE",
            message: `Row ${r + 1}: Order value ${orderVal} is tied within item. Physical sequence is preserved.`,
          });
        } else {
          itemSeenOrders[itemKey].add(orderNum);
        }
      }
    }

    // Build raw_cells — ALL columns by header name, nothing dropped
    const rawCells: Record<string, unknown> = {};
    headers.forEach((h, c) => {
      if (!h) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      rawCells[h] = cell ? (cell.v ?? null) : null;
    });

    const cleanCommentName = commentName ? decodeEntities(commentName) : "";

    fields.push({
      source_row: r + 1, // 1-based for display consistency
      section_pos: sectionPos,
      item_pos: currentItemPos,
      field_pos: currentFieldPos,

      section_name: effectiveSection,
      item_name: itemName || "(unknown)",
      comment_name: cleanCommentName,
      comment_text: commentText,

      comment_type: cellStr(r, "Comment Type (info, limit, defect)"),
      category: cellNum(r, "Category (-1: Low, 0: Med, 1: High)"),
      answer_type: cellStr(
        r,
        "Answer Type (boolean, checkbox, date, number, range, text)"
      ),
      options_raw: cellStr(
        r,
        "Multiple Choice Options (comma-separated)"
      ),

      // As-imported snapshots — set at parse time, never mutated
      snap_section_name: effectiveSection,
      snap_item_name: itemName || "(unknown)",
      snap_comment_name: cleanCommentName,
      snap_comment_text: commentText,

      raw_cells: rawCells,
    });
    rowsProcessed++;
  }

  // ── ROW ACCOUNTABILITY ───────────────────────────────────────────────────
  // Prove: processed + empty + skipped = numDataRows (all rows accounted for)
  const totalDataRows = numDataRows;
  const accountedRows = rowsProcessed + rowsEmpty + rowsSkipped;
  if (accountedRows !== totalDataRows) {
    issues.push({
      source_row: null,
      severity: "warning",
      code: "UNACCOUNTED_ROWS",
      message: `Row accounting: ${rowsProcessed} data + ${rowsEmpty} blank + ${rowsSkipped} skipped = ${accountedRows}, ` +
        `but sheet has ${totalDataRows} data rows. ${totalDataRows - accountedRows} rows unaccounted.`,
    });
  }

  // Only throw if there are genuinely NO rows of any kind
  if (fields.length === 0 && accountedRows === 0) {
    throw new ParseError(
      "EMPTY_SHEET",
      "The file has headers but no data rows."
    );
  }

  // Plain-text detection (no HTML tags found in any comment text)
  if (!anyHtmlFound) {
    issues.push({
      source_row: null,
      severity: "warning",
      code: "NO_HTML_FOUND",
      message:
        "No HTML markup was found in any comment text. " +
        "This may be a plain-text export (missing formatting). " +
        "If so, please re-export using 'Export HTML Text'.",
    });
  }

  return {
    source_filename: filename,
    headers,
    snapshot_rows: snapshotRows,
    fields,
    issues,
    rows_skipped: rowsSkipped,
    rows_processed: rowsProcessed,
    rows_empty: rowsEmpty,
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ParseError";
  }
}
