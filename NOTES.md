# NOTES.md — Design Decisions and Trade-offs

*This file documents the reasoning behind key decisions, things I'd do differently with more time, and what I deliberately cut. It's meant to be read alongside ARCHITECTURE.md.*

---

## What I built

A Spectora template importer with:
- **Zero silent data loss** — every column from the 42-column Spectora XLS is stored in `raw_cells` JSONB even if not modelled as a named field
- **Honest import report** — shows exact section/item/field counts and a fidelity verification result inline, not just a bare success toast
- **Round-trip verifier** — compares DB snap_* columns against the snapshot JSONB; self-proving via tamper test
- **Correct section rename** — cascading UPDATE on `section_pos` scope, not name-match (which would break on duplicate section names)
- **Type-safe SheetJS** — `{ raw: true, cellDates: false }` prevents date/number coercion; full `!ref` range iteration preserves `source_row` across blank rows

---

## What I explicitly cut (and why)

| Cut | Reason | What I'd add with more time |
|---|---|---|
| Drag-and-drop reorder | Adds state complexity; the assignment asks for edit not reorder | `@dnd-kit/sortable` on `field_pos`, then UPDATE the sequence |
| Section/item name edit in the list | Column cascade is implemented in API, not yet wired to UI (name is shown read-only) | Click-to-edit on section header in `TemplateViewer` |
| Multiple Choice Options splitting/editing | `options_raw` stored verbatim; editing is read-only | Parse on display only; store raw always |
| Spectora HIP / HomeGauge / Horizon parsers | Assignment specifies Spectora; H11 says "at least one additional format" is a stretch goal | Add format detection branch in `parser.ts`; each format gets its own column mapper |
| Export back to XLS | Assignment doesn't require it; H12 gap | Run SheetJS `write()` against snapshot — trivial since snapshot stores the original matrix |
| Supabase Realtime | Overkill for single-user; no multi-user requirement | Subscribe to `fields` channel for multi-tab sync |
| AI comment suggestions | Out of scope | Call Hive's own AI API after auth |

---

## Things that surprised me in the data

1. **83/392 comment_text values are NULL** — these are input fields (questions), not narrative comments. Every other importer I studied drops these silently. We preserve them.

2. **Order column has ties in 38/69 items** — the `Order (w/i item)` column in the InterNACHI template has `0` for every item within a subsection. Sorting by this column gives non-deterministic results. Physical row order is the only reliable sequence.

3. **The "download page" trap (Trap 6)** — Spectora's export button takes you to a page that says "Your download is ready" with a "Download File" button. If you upload that HTML page instead of clicking through, you get a 53KB HTML file with magic bytes `<htm`. This is an extremely common user error. Our format detection catches it immediately.

4. **Hive's own import modal says "Excel files only"** — no mention of the "Export HTML Text" specific export path needed from Spectora. Real users will export the wrong file. Our error messages name the exact Spectora menu path.

---

## What I found studying other candidates

*(from the 45-repo field analysis in the knowledge base)*

- **Zero candidates** implemented a round-trip diff verifier. Every importer reported "success" without checking whether what's in the DB matches what was parsed.
- **8/45 candidates** reproduced the Hive "unsaved changes" banner bug on fresh import — confirming it's a real Hive product issue, not user error.
- **Top candidate (Ibtisam-Mohammad, score 9.0)** used an in-transaction cell verification with rollback — the closest to our verifier, but it compared against the live Supabase insert, not an independent snapshot.
- **No candidate** preserved `comment_text: null` for the 83 input fields — all either dropped them or substituted empty string.

---

## What Hive does that we intentionally do differently

| Hive behaviour | Our behaviour | Why |
|---|---|---|
| Bare "successfully imported" toast | Inline import report: counts + verification result | Trust — inspector needs to see proof |
| Type-band regrouping (Info/Limitations/Defects) | Physical order preserved | Inspector's ordering is their IP |
| "Import cost estimates" checkbox (unmapped if skipped) | All 42 columns stored in `raw_cells` — nothing lost | Round-trip completeness |
| No fidelity verification | DB write-path verifier + parse-path unit tests | Demonstrable correctness |
| Section > Subsection > Field terminology | Section > Item > Comment (Spectora native terms) | Reduce terminology shock for switchers |

---

## If I had two more days

1. **Wire section/item rename UI** — the cascade API is written, just needs click-to-edit in `TemplateViewer`
2. **Add HIP and HomeGauge parsers** (H11 — at least one additional format)
3. **Add export back to XLS** (H12 — re-export diff)
4. **Add Storybook** for the TemplateViewer component — makes the editor testable in isolation
5. **Run top 5 candidate repos locally** (now permitted by updated AGENTS.md) — test their parsers against edge cases we identified, turn failures into our own test fixtures

---

## Terminology reference

| Spectora | Hive | Our DB field |
|---|---|---|
| Section | Section | `section_name` |
| Item | Subsection | `item_name` |
| Comment | Field | `comment_name` / `comment_text` |
| Comment Type | Field Type | `comment_type` |
| Category | Category | `category` |
| Order (w/i item) | (position) | `field_pos` (physical row, not this column) |
