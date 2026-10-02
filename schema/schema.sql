-- ============================================================
-- Spectora Importer — Supabase Postgres Schema + RLS
-- Apply via: Supabase Dashboard → SQL Editor, or supabase db push
-- ============================================================

-- Enable Row Level Security on all tables
-- (RLS policies below scope data to auth.uid() — uses Supabase Anonymous Auth)

-- ─── templates ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  source_file  text NOT NULL,            -- original filename (e.g. "InterNACHI Residential -2026-10-01.xls")
  imported_at  timestamptz NOT NULL DEFAULT now(),
  is_seed      boolean NOT NULL DEFAULT false,  -- seed = read-only for all clients
  snapshot     jsonb NOT NULL,           -- { headers: [...], rows: [[...], ...] } — full 42×N matrix
  owner_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Seed is readable by everyone
CREATE POLICY "templates: read seed" ON templates
  FOR SELECT USING (is_seed = true);

-- Users read their own templates
CREATE POLICY "templates: read own" ON templates
  FOR SELECT USING (auth.uid() = owner_id);

-- Users insert their own templates (import creates new template)
CREATE POLICY "templates: insert own" ON templates
  FOR INSERT WITH CHECK (auth.uid() = owner_id AND is_seed = false);

-- Users update only their own non-seed templates
CREATE POLICY "templates: update own" ON templates
  FOR UPDATE USING (auth.uid() = owner_id AND is_seed = false);

-- Users delete only their own non-seed templates
CREATE POLICY "templates: delete own" ON templates
  FOR DELETE USING (auth.uid() = owner_id AND is_seed = false);

-- ─── fields ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  source_row     int NOT NULL,           -- 1-based physical row in source file (surrogate key)

  -- Hierarchy positions (from physical row order, NOT the Order column)
  section_pos    int NOT NULL,           -- 0-based ordinal of section (order of first appearance)
  item_pos       int NOT NULL,           -- 0-based ordinal of item within section
  field_pos      int NOT NULL,           -- 0-based ordinal within (section, item)

  -- Editable columns
  section_name   text NOT NULL,
  item_name      text NOT NULL,
  comment_name   text NOT NULL,
  comment_text   text,                   -- NULL = field/question with no canned text (83/392 in InterNACHI)

  -- Behaviour columns (stored; read-only in UI v1)
  comment_type   text,                   -- 'info' | 'limit' | 'defect'
  category       int,                    -- -1 low | 0 med | 1 high | NULL = not set
  answer_type    text,                   -- 'boolean' | 'checkbox' | 'date' | 'number' | 'range' | 'text'
  options_raw    text,                   -- raw comma-joined string — NEVER parsed and discarded

  -- As-imported snapshots (set at INSERT, never updated — for revert + verifier)
  snap_section_name  text NOT NULL,
  snap_item_name     text NOT NULL,
  snap_comment_name  text NOT NULL,
  snap_comment_text  text,

  -- All remaining columns stored losslessly, keyed by header name
  raw_cells      jsonb NOT NULL DEFAULT '{}',

  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (template_id, source_row)
);

ALTER TABLE fields ENABLE ROW LEVEL SECURITY;

-- Fields inherit template visibility
CREATE POLICY "fields: read seed" ON fields
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM templates t
      WHERE t.id = template_id AND t.is_seed = true
    )
  );

CREATE POLICY "fields: read own" ON fields
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM templates t
      WHERE t.id = template_id AND t.owner_id = auth.uid()
    )
  );

CREATE POLICY "fields: insert own" ON fields
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM templates t
      WHERE t.id = template_id AND t.owner_id = auth.uid() AND t.is_seed = false
    )
  );

-- Section rename fix (Attack #3): cascading UPDATE uses section_pos scope, not name match
-- Application handles cascade: UPDATE fields SET section_name=$new WHERE template_id=$tid AND section_pos=$pos
CREATE POLICY "fields: update own" ON fields
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM templates t
      WHERE t.id = template_id AND t.owner_id = auth.uid() AND t.is_seed = false
    )
  );

CREATE POLICY "fields: delete own" ON fields
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM templates t
      WHERE t.id = template_id AND t.owner_id = auth.uid() AND t.is_seed = false
    )
  );

-- ─── import_issues ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_issues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  source_row   int,                      -- NULL = file-level issue
  severity     text NOT NULL CHECK (severity IN ('error', 'warning', 'info', 'verify')),
  code         text NOT NULL,            -- machine tag e.g. 'ORDER_TIE', 'EMPTY_COMMENT_TEXT'
  message      text NOT NULL             -- plain English for display
);

ALTER TABLE import_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "issues: read seed" ON import_issues
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM templates t WHERE t.id = template_id AND t.is_seed = true)
  );

CREATE POLICY "issues: read own" ON import_issues
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM templates t WHERE t.id = template_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "issues: insert own" ON import_issues
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM templates t WHERE t.id = template_id AND t.owner_id = auth.uid())
  );

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fields_template_order
  ON fields (template_id, section_pos, item_pos, field_pos);

CREATE INDEX IF NOT EXISTS idx_fields_template_source_row
  ON fields (template_id, source_row);

CREATE INDEX IF NOT EXISTS idx_issues_template
  ON import_issues (template_id, severity);

CREATE INDEX IF NOT EXISTS idx_templates_owner
  ON templates (owner_id, imported_at DESC);

-- ─── Helper: updated_at trigger ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fields_updated_at
  BEFORE UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
