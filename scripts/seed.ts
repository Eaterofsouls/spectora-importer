/**
 * scripts/seed.ts
 *
 * Seeds the database with the InterNACHI Residential template as the
 * read-only seed template (is_seed = true).
 *
 * Run ONCE after deploying:
 *   npx tsx scripts/seed.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY set.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

// Load .env.local (tsx doesn't auto-load it)
config({ path: path.resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { parseSpectoraExport } from "../lib/parser";

const XLS_PATH = path.resolve(
  process.cwd(),
  "InterNACHI Residential -2026-10-01.xls"
);

async function seed() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Check if seed already exists
  const { data: existing } = await supabase
    .from("templates")
    .select("id, name")
    .eq("is_seed", true)
    .limit(1)
    .single();

  if (existing) {
    console.log(`✓ Seed template already exists: "${existing.name}" (${existing.id})`);
    console.log("  Delete it first if you want to re-seed.");
    process.exit(0);
  }

  // Load the XLS file
  if (!fs.existsSync(XLS_PATH)) {
    console.error(`❌ XLS file not found at: ${XLS_PATH}`);
    console.error(
      "   Place the Spectora export at the expected path or update XLS_PATH in this script."
    );
    process.exit(1);
  }

  const buffer = fs.readFileSync(XLS_PATH);
  const filename = path.basename(XLS_PATH);

  console.log(`📂 Parsing: ${filename} (${buffer.length} bytes)`);

  const parsed = parseSpectoraExport(buffer, filename);

  console.log(`   Found: ${parsed.fields.length} fields across templates`);
  console.log(`   Issues: ${parsed.issues.length}`);

  const sectionCount = new Set(parsed.fields.map((f) => f.section_pos)).size;
  const itemCount = new Set(
    parsed.fields.map((f) => `${f.section_pos}::${f.item_pos}`)
  ).size;

  console.log(`   Sections: ${sectionCount}, Items: ${itemCount}`);

  // Insert seed template
  const { data: template, error: tErr } = await supabase
    .from("templates")
    .insert({
      name: "InterNACHI Residential (seed)",
      source_file: filename,
      owner_id: null, // seed has no owner — readable by all via RLS
      is_seed: true,
      snapshot: {
        headers: parsed.headers,
        rows: parsed.snapshot_rows,
      },
    })
    .select("id")
    .single();

  if (tErr || !template) {
    console.error("❌ Failed to insert seed template:", tErr?.message);
    process.exit(1);
  }

  console.log(`✓ Seed template created: ${template.id}`);

  // Bulk insert fields in chunks
  const CHUNK_SIZE = 100;
  let inserted = 0;
  for (let i = 0; i < parsed.fields.length; i += CHUNK_SIZE) {
    const chunk = parsed.fields.slice(i, i + CHUNK_SIZE).map((f) => ({
      template_id: template.id,
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

    const { error: fErr } = await supabase.from("fields").insert(chunk);
    if (fErr) {
      console.error(`❌ Field insert error at chunk ${i}:`, fErr.message);
      // Rollback
      await supabase.from("templates").delete().eq("id", template.id);
      process.exit(1);
    }
    inserted += chunk.length;
    process.stdout.write(`\r   Fields: ${inserted}/${parsed.fields.length}`);
  }

  console.log(`\n✓ ${inserted} fields seeded`);

  // Insert issues
  if (parsed.issues.length > 0) {
    const issueRows = parsed.issues.map((i) => ({
      template_id: template.id,
      source_row: i.source_row,
      severity: i.severity,
      code: i.code,
      message: i.message,
    }));
    await supabase.from("import_issues").insert(issueRows);
    console.log(`✓ ${parsed.issues.length} import issues recorded`);
  }

  console.log("\n🌱 Seed complete.");
  console.log(`   Template ID: ${template.id}`);
  console.log(`   Sections: ${sectionCount} | Items: ${itemCount} | Fields: ${inserted}`);
}

seed().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
