# NOTES.md — Design Decisions and Trade-offs

*This file documents the reasoning behind key decisions, things I'd do differently with more time, and what I deliberately cut. It's meant to be read alongside ARCHITECTURE.md.*

---

## What I built

A Spectora template importer with:
- **Zero silent data loss** — every column from the 42-column Spectora XLS is stored in `raw_cells` JSONB even if not modelled as a named field
- **Honest import report** — shows exact section/item/field counts and a fidelity verification result inline, not just a bare success toast
- **Pre-commit write-path verifier with rollback** — compares DB fields against snapshot JSONB; immediately rolls back entire import if any fidelity mismatch or corruption is detected
- **Round-trip re-export to .xlsx** — `GET /api/templates/[id]/export` reconstructs the 42-column spreadsheet with live edits overlaid, allowing inspectors to export their work anytime
- **Air-gapped AI column confidence auditor** — principled AI seam with strict Zod/JSON validation and tested failure modes (timeout, non-JSON, schema hallucinations, clamping)
- **Visual grouping inheritance** — carries forward section/item names on visually grouped Excel rows, preventing spurious `(unknown)` sections
- **Disjoint block detection** — identifies non-contiguous section blocks split by Spectora and merges them with a user warning
- **Row accountability proof** — mathematically asserts and verifies that `processed + empty + skipped = totalDataRows` so zero rows can ever be dropped silently.
- **XSS sanitisation** — sanitize-html allowlist covering all Froala editor rich text controls while stripping scripts, onerror handlers, and untrusted iframes
- **67 unit & integration tests** — comprehensive coverage across 6 test suites including 8 blind holdout templates (Nick Gromicko master template, Radon, TREC, Room-by-room, etc.)

---

## What I explicitly cut (and why)

| Cut | Reason | What I'd add with more time |
|---|---|---|
| Drag-and-drop reorder | Adds state complexity; the assignment asks for edit not reorder | `@dnd-kit/sortable` on `field_pos`, then UPDATE the sequence |
| Section/item name edit in the list | Column cascade is implemented in API, not yet wired to UI (name is shown read-only) | Click-to-edit on section header in `TemplateViewer` |
| Multiple Choice Options splitting/editing | `options_raw` stored verbatim; editing is read-only | Parse on display only; store raw always |
| Other inspection software parsers (HIP / HomeGauge) | Assignment specifies Spectora; additional formats are stretch goals | Add format detection branch in `parser.ts`; each format gets its own column mapper |
| Supabase Realtime | Overkill for single-user; no multi-user requirement | Subscribe to `fields` channel for multi-tab sync |
| AI comment suggestions | Out of scope | Call Hive's own AI API after auth |

---

## Things that surprised me in the data

1. **83/392 comment_text values are NULL** — these are input fields (questions), not narrative comments. Naive parsers drop these silently or coerce them to empty strings. We preserve them as explicit nulls.

2. **Order column has ties in 38/69 items** — the `Order (w/i item)` column in the InterNACHI template has `0` for every item within a subsection. Sorting by this column gives non-deterministic results. Physical row order is the only reliable sequence.

3. **The "download page" trap (Trap 6)** — Spectora's export button takes you to a page that says "Your download is ready" with a "Download File" button. If you upload that HTML page instead of clicking through, you get a 53KB HTML file with magic bytes `<htm`. This is an extremely common user error. Our format detection catches it immediately.

4. **Hive's own import modal says "Excel files only"** — no mention of the "Export HTML Text" specific export path needed from Spectora. Real users will export the wrong file. Our error messages name the exact Spectora menu path.

5. **Visual grouping in real templates** — users frequently leave Section/Item cells blank under a header. Without inheritance from preceding rows, importers create hundreds of spurious `(unknown)` sections.

---

## Real-World Failure Modes Addressed

Through stress-testing across multiple real-world inspection templates (including the 1,000+ comment Nick Gromicko master template and Texas TREC templates), I identified and resolved several subtle failure modes:

- **Silent Data Loss via Unmodelled Columns**: Spectora exports contain 42 columns, many of which (e.g. location tags, recommendation contractors, unit options) are not mapped to typical basic database schemas. By preserving all 42 columns in an immutable `raw_cells` JSONB column and snapshot matrix, we guarantee 100% round-trip fidelity.
- **Write-Path Inconsistencies**: Testing revealed that parse-path success does not guarantee database integrity. Database constraints, silent type casting, or network interruptions can corrupt imports. Our pre-commit verification reads back stored rows before finalizing and triggers a complete rollback if any discrepancy is detected.
- **Non-Contiguous Section Blocks**: Spectora sometimes outputs items for a single section across disjoint row blocks. Our parser detects non-contiguous sections, merges rows under the original section position, and flags a warning for inspector review.
- **XSS in Untrusted Rich Comments**: Spectora's Froala editor produces HTML that can contain arbitrary markup. Rendering raw HTML risks cross-site scripting. Our sanitisation engine uses a strict allowlist matching Froala capabilities while stripping executable code and unauthorized iframes.
- **AI Non-Determinism**: Rather than relying on LLMs for core parsing, our AI auditor is strictly air-gapped as an advisory column classifier with deterministic fallback and robust schema validation against hallucinations.

---

## What Hive does that we intentionally do differently

| Hive behaviour | Our behaviour | Why |
|---|---|---|
| Bare "successfully imported" toast | Inline import report: counts + verification result | Trust — inspector needs to see proof |
| Type-band regrouping (Info/Limitations/Defects) | Physical order preserved | Inspector's ordering is their IP |
| "Import cost estimates" checkbox (unmapped if skipped) | All 42 columns stored in `raw_cells` — nothing lost | Round-trip completeness |
| No fidelity verification | DB write-path verifier + rollback + parse-path unit tests | Demonstrable correctness |
| Section > Subsection > Field terminology | Section > Item > Comment (Spectora native terms) | Reduce terminology shock for switchers |
| No export functionality (vendor lock-in) | Round-trip re-export to XLSX with live edits | Inspector ownership and portability |

---

## If I had two more days

1. **Wire section/item rename UI** — the cascade API is written, just needs click-to-edit in `TemplateViewer`
2. **Add HIP and HomeGauge parsers** — expand format detection to other inspection software
3. **Add Storybook** for the TemplateViewer component — makes the editor testable in isolation

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
