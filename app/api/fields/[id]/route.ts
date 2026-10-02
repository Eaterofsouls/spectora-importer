/**
 * PATCH /api/fields/[id]
 *
 * Updates one or more editable fields on a comment.
 * Supports: section_name, item_name, comment_name, comment_text
 *
 * Section name cascade: if section_name changes, ALL fields with the
 * same (template_id, section_pos) are updated atomically.
 *
 * Optimistic concurrency: request must include current updated_at.
 * Returns 409 if the row was modified by another session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

const EDITABLE_FIELDS = new Set([
  "section_name",
  "item_name",
  "comment_name",
  "comment_text",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fieldId } = await params;

  // Auth check
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Session not found." } },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body." } },
      { status: 400 }
    );
  }

  // Extract updates (only allow editable fields)
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "updated_at") continue; // will handle separately
    if (EDITABLE_FIELDS.has(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: { code: "NO_UPDATES", message: "No editable fields provided." } },
      { status: 422 }
    );
  }

  // Optimistic concurrency check
  const clientUpdatedAt = body.updated_at as string | undefined;

  const service = createSupabaseServiceClient();

  // Load the current field (verify ownership and get current state)
  const { data: currentField, error: fetchErr } = await service
    .from("fields")
    .select(
      "id, template_id, section_pos, item_pos, updated_at, section_name, item_name"
    )
    .eq("id", fieldId)
    .single();

  if (fetchErr || !currentField) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Field not found." } },
      { status: 404 }
    );
  }

  // Verify the template belongs to this user (not a seed)
  const { data: template, error: tErr } = await service
    .from("templates")
    .select("owner_id, is_seed")
    .eq("id", currentField.template_id)
    .single();

  if (tErr || !template) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Template not found." } },
      { status: 404 }
    );
  }

  if (template.is_seed || template.owner_id !== user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Cannot edit this template." } },
      { status: 403 }
    );
  }

  // Optimistic concurrency: reject if updated_at doesn't match
  if (
    clientUpdatedAt &&
    new Date(clientUpdatedAt).getTime() !==
      new Date(currentField.updated_at).getTime()
  ) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message:
            "This field was modified in another tab or session. " +
            "Please reload to see the latest version before editing.",
        },
        server_updated_at: currentField.updated_at,
      },
      { status: 409 }
    );
  }

  // ── Section name cascade ───────────────────────────────────────────────────
  if ("section_name" in updates && updates.section_name !== currentField.section_name) {
    // Update ALL fields in this section (same template_id + section_pos)
    const { error: cascadeErr } = await service
      .from("fields")
      .update({ section_name: updates.section_name })
      .eq("template_id", currentField.template_id)
      .eq("section_pos", currentField.section_pos);

    if (cascadeErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: "Could not update section name. Please try again.",
          },
        },
        { status: 500 }
      );
    }

    // Remove section_name from updates (already applied via cascade)
    delete updates.section_name;
  }

  // ── Item name cascade ─────────────────────────────────────────────────────
  if ("item_name" in updates && updates.item_name !== currentField.item_name) {
    const { error: cascadeErr } = await service
      .from("fields")
      .update({ item_name: updates.item_name })
      .eq("template_id", currentField.template_id)
      .eq("section_pos", currentField.section_pos)
      .eq("item_pos", currentField.item_pos);

    if (cascadeErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: "Could not update item name. Please try again.",
          },
        },
        { status: 500 }
      );
    }

    delete updates.item_name;
  }

  // ── Apply remaining field-level updates ────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await service
      .from("fields")
      .update(updates)
      .eq("id", fieldId);

    if (updateErr) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: "Could not save changes. Please try again.",
          },
        },
        { status: 500 }
      );
    }
  }

  // Return updated field
  const { data: updatedField } = await service
    .from("fields")
    .select("*")
    .eq("id", fieldId)
    .single();

  return NextResponse.json({ field: updatedField });
}

// ── PATCH /api/fields/[id]/revert — revert to as-imported snapshot ───────────
// Called separately: PATCH /api/fields/[id] with body { action: "revert" }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fieldId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  // Load snap values
  const { data: field } = await service
    .from("fields")
    .select(
      "id, template_id, section_pos, item_pos, snap_section_name, snap_item_name, snap_comment_name, snap_comment_text"
    )
    .eq("id", fieldId)
    .single();

  if (!field) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify ownership
  const { data: template } = await service
    .from("templates")
    .select("owner_id, is_seed")
    .eq("id", field.template_id)
    .single();

  if (!template || template.is_seed || template.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Revert: set working values back to snap values (cascade for section/item)
  await service
    .from("fields")
    .update({ section_name: field.snap_section_name })
    .eq("template_id", field.template_id)
    .eq("section_pos", field.section_pos);

  await service
    .from("fields")
    .update({ item_name: field.snap_item_name })
    .eq("template_id", field.template_id)
    .eq("section_pos", field.section_pos)
    .eq("item_pos", field.item_pos);

  await service.from("fields").update({
    comment_name: field.snap_comment_name,
    comment_text: field.snap_comment_text,
  }).eq("id", fieldId);

  return NextResponse.json({ reverted: true });
}
