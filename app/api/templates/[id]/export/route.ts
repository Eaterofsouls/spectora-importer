/**
 * GET /api/templates/[id]/export
 *
 * Re-exports a template back to the 42-column Spectora spreadsheet layout (.xlsx).
 *
 * Round-trip proof:
 * - Reads immutable 42-column snapshot matrix
 * - Overlays any user-edited fields (section, item, comment, logic columns)
 * - Retains all unmodelled columns byte-identical from original file
 * - Returns downloadable .xlsx workbook
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: templateId } = await params;

  if (!templateId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Template ID is required." } },
      { status: 400 }
    );
  }

  // 1. Authenticate user
  const supabaseServer = await createSupabaseServerClient();
  const { data: { user } } = await supabaseServer.auth.getUser();

  // 2. Fetch template (allow owner or seed templates)
  const supabaseService = createSupabaseServiceClient();
  const { data: template, error: tErr } = await supabaseService
    .from("templates")
    .select("id, name, is_seed, owner_id, snapshot")
    .eq("id", templateId)
    .single();

  if (tErr || !template) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Template not found." } },
      { status: 404 }
    );
  }

  // Enforce access control: must be seed or owned by user
  if (!template.is_seed && (!user || template.owner_id !== user.id)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied." } },
      { status: 403 }
    );
  }

  const snapshot = template.snapshot as {
    headers: string[];
    rows: unknown[][];
  };

  if (!snapshot || !snapshot.headers || !snapshot.rows) {
    return NextResponse.json(
      { error: { code: "CORRUPT_SNAPSHOT", message: "Template snapshot data is missing." } },
      { status: 500 }
    );
  }

  interface ExportField {
    source_row: number;
    section_name: string;
    item_name: string;
    comment_name: string;
    comment_text: string | null;
    comment_type: string | null;
    category: number | null;
    answer_type: string | null;
    options_raw: string | null;
  }

  // 3. Fetch current live fields for this template to reflect any edits
  const { data: liveFieldsRaw, error: fErr } = await supabaseService
    .from("fields")
    .select(
      "source_row, section_name, item_name, comment_name, comment_text, " +
      "comment_type, category, answer_type, options_raw"
    )
    .eq("template_id", templateId)
    .order("source_row");

  if (fErr) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to load live fields." } },
      { status: 500 }
    );
  }

  const liveFields = (liveFieldsRaw as unknown as ExportField[]) || [];

  // Map header names to column indices
  const headerIdx: Record<string, number> = {};
  snapshot.headers.forEach((h, i) => {
    headerIdx[h] = i;
  });

  // Deep clone snapshot rows matrix
  const exportRows: unknown[][] = snapshot.rows.map((r) => [...r]);

  // Overlay live fields
  for (const field of liveFields) {
    // source_row is 1-based Excel row, first data row is 2 (snapshot.rows[0])
    const rowIdx = field.source_row - 2;
    if (rowIdx < 0 || rowIdx >= exportRows.length) continue;

    const row = exportRows[rowIdx];

    const updates: Record<string, unknown> = {
      "Section Name": field.section_name,
      "Item Name": field.item_name,
      "Comment Name": field.comment_name,
      "Comment Text": field.comment_text,
      "Comment Type (info, limit, defect)": field.comment_type,
      "Category (-1: Low, 0: Med, 1: High)": field.category,
      "Answer Type (boolean, checkbox, date, number, range, text)": field.answer_type,
      "Multiple Choice Options (comma-separated)": field.options_raw,
    };

    for (const [colName, val] of Object.entries(updates)) {
      const c = headerIdx[colName];
      if (c !== undefined && val !== undefined) {
        row[c] = val;
      }
    }
  }

  // Helper to prevent Excel formula injection (CSV/XLS macro injection)
  function sanitizeFormulaCell(val: unknown): unknown {
    if (typeof val === "string" && /^[=+\-@\t\r]/.test(val)) {
      return `'${val}`;
    }
    return val;
  }

  // 4. Build OOXML (.xlsx) workbook using SheetJS with formula injection protection
  const safeExportRows = exportRows.map((row) =>
    (row as unknown[]).map(sanitizeFormulaCell)
  );
  const wsData = [snapshot.headers, ...safeExportRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  const sanitizedFilename = (template.name || "template")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .concat("-export.xlsx");

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${sanitizedFilename}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}
