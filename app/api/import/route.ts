/**
 * POST /api/import
 *
 * Accepts a multipart form upload (field: "file"), parses the Spectora
 * OOXML export, and writes atomically to Supabase.
 *
 * Returns:
 *   200 { template_id, field_count, section_count, item_count,
 *          issues, verification }
 *   422 { error: { code, message } }       — invalid file
 *   413                                    — file too large
 *   500 { error: { code, message } }       — DB error (no partial write)
 */

import { NextRequest, NextResponse } from "next/server";
import { parseSpectoraExport, ParseError } from "@/lib/parser";
import { verifyTemplate } from "@/lib/verifier";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";
import { runColumnAudit } from "@/lib/ai-auditor";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  // ── 1. Size guard ─────────────────────────────────────────────────────────
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "File must be under 10 MB." } },
      { status: 413 }
    );
  }

  // ── 2. Extract file from form data ────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Expected multipart/form-data." } },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { error: { code: "NO_FILE", message: "No file was uploaded." } },
      { status: 422 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "File must be under 10 MB." } },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // ── 3. Parse ──────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseSpectoraExport(buffer, file.name);
  } catch (e) {
    if (e instanceof ParseError) {
      return NextResponse.json(
        { error: { code: e.code, message: e.message } },
        { status: 422 }
      );
    }
    console.error("Unexpected parse error:", e);
    return NextResponse.json(
      { error: { code: "PARSE_FAILED", message: "Could not parse the file." } },
      { status: 500 }
    );
  }

  // ── 3b. AI column confidence audit (air-gapped — headers + samples only) ──
  // Runs AFTER deterministic parse. AI cannot affect the parse result.
  // Results are informational only — stored in import_issues for the report.
  const aiAudit = await runColumnAudit(
    parsed.headers,
    parsed.snapshot_rows.slice(0, 3),
    process.env.GEMINI_API_KEY
  );

  // ── 4. Ensure user is authenticated (anonymous sign-in done client-side) ──
  const supabaseServer = await await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabaseServer.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Session not found. Please reload." } },
      { status: 401 }
    );
  }

  // ── 5. Atomic DB write (service role — bypasses RLS for the insert) ───────
  const supabaseService = createSupabaseServiceClient();

  // Insert template row
  const { data: templateRow, error: tErr } = await supabaseService
    .from("templates")
    .insert({
      name: file.name.replace(/\.xls[x]?$/i, ""),
      source_file: file.name,
      owner_id: user.id,
      is_seed: false,
      snapshot: {
        headers: parsed.headers,
        rows: parsed.snapshot_rows,
        rows_skipped: parsed.rows_skipped,
      },
    })
    .select("id")
    .single();

  if (tErr || !templateRow) {
    console.error("Template insert error:", tErr);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Could not save the template. Please try again." } },
      { status: 500 }
    );
  }

  const templateId = templateRow.id;

  // Bulk insert fields in chunks of 100 (prevents Vercel timeout on large templates)
  const CHUNK_SIZE = 100;
  for (let i = 0; i < parsed.fields.length; i += CHUNK_SIZE) {
    const chunk = parsed.fields.slice(i, i + CHUNK_SIZE).map((f) => ({
      template_id: templateId,
      source_row: f.source_row,
      section_pos: f.section_pos,
      item_pos: f.item_pos,
      field_pos: f.field_pos,
      section_name: f.section_name,
      item_name: f.item_name,
      comment_name: f.comment_name,
      comment_text: f.comment_text,
      comment_type: f.comment_type,
      category: f.category,
      answer_type: f.answer_type,
      options_raw: f.options_raw,
      snap_section_name: f.snap_section_name,
      snap_item_name: f.snap_item_name,
      snap_comment_name: f.snap_comment_name,
      snap_comment_text: f.snap_comment_text,
      raw_cells: f.raw_cells,
    }));

    const { error: fErr } = await supabaseService.from("fields").insert(chunk);
    if (fErr) {
      // Rollback: delete the template (cascades to fields via ON DELETE CASCADE)
      await supabaseService.from("templates").delete().eq("id", templateId);
      console.error("Fields insert error:", fErr);
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: "Could not save template fields. No data was written.",
          },
        },
        { status: 500 }
      );
    }
  }

  // Include low confidence columns from AI auditor in issues
  if (aiAudit.low_confidence_columns.length > 0) {
    for (const col of aiAudit.low_confidence_columns) {
      parsed.issues.push({
        source_row: null,
        severity: "warning",
        code: "LOW_CONFIDENCE_COLUMN",
        message: `Column "${col.header}" flagged by AI auditor (confidence: ${(col.confidence * 100).toFixed(0)}%). Verify values after import.`,
      });
    }
  }

  // Insert import issues
  if (parsed.issues.length > 0) {
    const issuesToInsert = parsed.issues.map((issue) => ({
      template_id: templateId,
      source_row: issue.source_row,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
    }));

    await supabaseService.from("import_issues").insert(issuesToInsert);
  }

  // ── 6. Run verifier (DB write path check with automatic rollback) ─────────
  let verification = null;
  try {
    // Use service client — verifier needs to read the template regardless of RLS
    verification = await verifyTemplate(supabaseService, templateId);

    if (!verification.passed) {
      // ROLLBACK: Delete template (cascades to fields and import_issues)
      await supabaseService.from("templates").delete().eq("id", templateId);
      console.warn("Import rolled back due to verification failure:", verification.mismatches);
      return NextResponse.json(
        {
          error: {
            code: "VERIFICATION_FAILED",
            message: `Fidelity verification failed: ${verification.summary}. Entire import rolled back to guarantee database integrity.`,
            mismatches: verification.mismatches,
          },
        },
        { status: 422 }
      );
    }
  } catch (e) {
    console.error("Verifier error:", e);
    await supabaseService.from("templates").delete().eq("id", templateId);
    return NextResponse.json(
      {
        error: {
          code: "VERIFICATION_ERROR",
          message: "Internal error during write-path verification. Import rolled back.",
        },
      },
      { status: 500 }
    );
  }

  // ── 7. Compute summary stats ───────────────────────────────────────────────
  const sectionCount = new Set(parsed.fields.map((f) => f.section_pos)).size;
  const itemCount = new Set(
    parsed.fields.map((f) => `${f.section_pos}::${f.item_pos}`)
  ).size;
  const issuesByType = {
    errors: parsed.issues.filter((i) => i.severity === "error").length,
    warnings: parsed.issues.filter((i) => i.severity === "warning").length,
    info: parsed.issues.filter((i) => i.severity === "info").length,
  };

  return NextResponse.json({
    template_id: templateId,
    name: file.name.replace(/\.xls[x]?$/i, ""),
    field_count: parsed.fields.length,
    section_count: sectionCount,
    item_count: itemCount,
    issues: {
      ...issuesByType,
      items: parsed.issues,
    },
    ai_audit: {
      ran: aiAudit.ran,
      failure_mode: aiAudit.failure_mode,
      low_confidence_columns: aiAudit.low_confidence_columns,
    },
    verification: verification
      ? {
          passed: verification.passed,
          summary: verification.summary,
          mismatch_count: verification.mismatches.length,
        }
      : null,
  });
}

