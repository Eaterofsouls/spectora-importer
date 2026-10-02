/**
 * GET  /api/templates         — list user's templates
 * POST /api/templates/[id]/duplicate — deep copy a template
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase";

// ── GET /api/templates ────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Return seed templates + user's own templates
  const service = createSupabaseServiceClient();
  const conditions = user
    ? `is_seed.eq.true,owner_id.eq.${user.id}`
    : "is_seed.eq.true";

  const { data, error } = await service
    .from("templates")
    .select("id, name, source_file, imported_at, is_seed, owner_id, updated_at")
    .or(conditions)
    .order("imported_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data });
}

