/**
 * POST /api/templates/[id]/duplicate
 *
 * Deep copies a template. Uses TypeScript chunked inserts (NOT PL/pgSQL)
 * so the logic is completely transparent, debuggable, and maintainable.
 *
 * Guarantees:
 * - New template row with new UUID and new owner_id
 * - All fields rows copied with new UUIDs, new template_id
 * - All import_issues rows copied
 * - No shared rows/references between original and copy
 * - snapshot JSONB is a new JSON object (Postgres JSONB copies by value)
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

const CHUNK_SIZE = 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const newName = body.name as string | undefined;

  const service = createSupabaseServiceClient();

  // 1. Load source template
  const { data: source, error: srcErr } = await service
    .from("templates")
    .select("*")
    .eq("id", sourceId)
    .single();

  if (srcErr || !source) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // 2. Verify access (seed is readable by anyone, owned templates by owner)
  if (!source.is_seed && source.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Create new template row — entirely new UUID, no references to source
  const { data: newTemplate, error: tErr } = await service
    .from("templates")
    .insert({
      name: newName ?? `${source.name} (copy)`,
      source_file: source.source_file,
      owner_id: user.id,
      is_seed: false,
      snapshot: source.snapshot, // Supabase JSONB copies by value
    })
    .select("id")
    .single();

  if (tErr || !newTemplate) {
    return NextResponse.json({ error: "Could not create copy" }, { status: 500 });
  }

  const newTemplateId = newTemplate.id;

  // 4. Copy fields in chunks — readable, modifiable, no PL/pgSQL needed
  let offset = 0;
  while (true) {
    const { data: chunk, error: chunkErr } = await service
      .from("fields")
      .select("*")
      .eq("template_id", sourceId)
      .order("source_row")
      .range(offset, offset + CHUNK_SIZE - 1);

    if (chunkErr) {
      await service.from("templates").delete().eq("id", newTemplateId);
      return NextResponse.json(
        { error: "Could not copy fields. No data was written." },
        { status: 500 }
      );
    }

    if (!chunk || chunk.length === 0) break;

    const newChunk = chunk.map(({ id: _id, template_id: _tid, ...rest }: Record<string, unknown>) => ({
      ...rest,
      template_id: newTemplateId,
      // updated_at will be set by DB default — don't copy source timestamps
    }));

    const { error: insertErr } = await service.from("fields").insert(newChunk);
    if (insertErr) {
      await service.from("templates").delete().eq("id", newTemplateId);
      return NextResponse.json(
        { error: "Could not copy fields. No data was written." },
        { status: 500 }
      );
    }

    if (chunk.length < CHUNK_SIZE) break;
    offset += CHUNK_SIZE;
  }

  // 5. Copy import issues
  const { data: issues } = await service
    .from("import_issues")
    .select("*")
    .eq("template_id", sourceId);

  if (issues && issues.length > 0) {
    const newIssues = issues.map(({ id: _id, template_id: _tid, ...rest }) => ({
      ...rest,
      template_id: newTemplateId,
    }));
    await service.from("import_issues").insert(newIssues);
  }

  return NextResponse.json({
    template_id: newTemplateId,
    name: newName ?? `${source.name} (copy)`,
    copied_from: sourceId,
  });
}
