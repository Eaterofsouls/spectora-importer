# NOTES.md — Design Decisions, Trade-offs & Engineering Rationale

*This document outlines the architectural decisions, constraints, intentional scope boundaries, and verification findings for the Spectora Template Importer. Derived systematically using the **Meridian Framework** (7-phase systems engineering methodology), fully detailed in [`ARCHITECTURE.md`](./ARCHITECTURE.md).*

---

## 1. What Was Engineered

A production-grade Spectora template migration engine built to solve the inspector trust dilemma:
- **Zero Silent Data Loss (Stratum 0 Invariant)**: Every single cell from all 42 columns of the Spectora spreadsheet is preserved in an immutable `raw_cells` JSONB column and snapshot matrix. Even unmodeled vendor columns remain 100% retrievable.
- **Physical Row Ordinals**: Maps hierarchical structure strictly via physical file appearance (`section_pos`, `item_pos`, `field_pos`), completely bypassing Spectora's non-deterministic `Order` column (which suffers from ties in 38/69 items in InterNACHI Residential).
- **Pre-Commit Write-Path Verification with Rollback**: Implements transactional read-back verification before finalizing imports. If database constraints, silent type casting, or network drops corrupt even a single character, the entire template transaction rolls back.
- **Round-Trip Re-Export to `.xlsx`**: Provides instant export via `GET /api/templates/[id]/export` that reconstructs the full 42-column spreadsheet with live inspector edits overlaid. Eliminates vendor lock-in.
- **Air-Gapped AI Column Confidence Seam**: Strict boundary separating deterministic parsing from optional LLM auditing. AI runs only on column headers + sample values with strict Zod-validated schemas and verified fallbacks (timeout, malformed JSON, schema hallucination, value clamping).
- **Visual Grouping & Disjoint Block Resilience**: Automatically inherits parent section/item names across blank Excel rows (preventing spurious `(unknown)` categories) and identifies non-contiguous section blocks.
- **Mathematical Row Accounting Proof**: Formal invariant check asserting that `processed + empty + skipped = totalDataRows`, mathematically proving zero row evaporation.
- **XSS Sanitisation Engine**: Restricts rendered comment markup to Froala rich text controls while stripping active script injection, event handlers, and untrusted iframes.
- **100 Comprehensive Unit & Integration Tests**: 13 test suites covering format detection, regression edge cases, write-path verification, multi-vector tamper attacks, and 9 real-world blind holdout templates.

---

## 2. Intentional Scope Boundaries (What Was Deliberately Cut & Why)

Per Meridian Phase 4 (Architecture Synthesis) and TRIZ constraint analysis, features were prioritized by impact on the inspector's switching decision:

| Cut Feature | Engineering Rationale | Future Evolution Path |
|---|---|---|
| **Drag-and-Drop Reordering** | Preserving the inspector's 4-year physical walking order is critical. Adding interactive UI reordering introduces complex client-state mutations that distract from faithful preservation. | Implement `@dnd-kit/sortable` on `field_pos` with atomic ordinal recalculation. |
| **Interactive Section/Item Renames in Header** | Backend cascading UPDATE API is fully implemented and tested. UI inline edit was kept focused on comment text (highest frequency task). | Add inline click-to-edit header controls in `TemplateViewer.tsx`. |
| **Multiple Choice Options Splitting/Editing** | `options_raw` often contains embedded commas within choices (e.g. `"Poured concrete, reinforced"`). Splitting at storage time risks data corruption. | Implement a dedicated options token editor while preserving `options_raw` as ground truth. |
| **Other Inspection Vendors (HIP / HomeGauge)** | Architected via pluggable parser seams. Spectora is the immediate focus where migration friction is highest. | Register vendor adapters conforming to the `TemplateParser` interface. |
| **Supabase Realtime WebSockets** | Template editing at a desktop is typically a single-inspector task. Realtime adds connection overhead without immediate value. | Subscribe to Supabase Postgres CDC changes for multi-tab collaboration. |
| **AI Comment Rewriting/Generation** | Core requirement is faithful preservation of the inspector's custom narrative, not generative AI replacements. | Integrate contextual LLM suggestions once template structure is established. |

---

## 3. Forensic Discoveries from Real Export Data

Analyzing the real Spectora export format from first principles revealed critical edge cases that naive importers fail on:

1. **83/392 Comment Texts Are NULL**: In the standard InterNACHI template, 83 rows represent input prompts/form fields, not narrative comments. Treating empty text as invalid rows drops 21% of the template's functional structure. They are preserved as explicit nulls.
2. **The Order Column Is Misleading**: The `Order (w/i item)` column contains tied values (`0`) across 38 of 69 items and restarts arbitrarily. Sorting by this column scrambles the inspector's custom workflow. Physical file row order is the only true source of truth.
3. **The "Download Page" User Trap**: Spectora's export button redirects to an intermediate landing page. Users frequently save the HTML page rather than the file, uploading a 53KB HTML document (`<!DOCTYPE html>`). Our magic-byte validator catches this instantly with clear guidance.
4. **Format Extension Masquerade**: Files exported with `.xls` extensions are actually OOXML ZIP containers (`PK\x03\x04`). Parsers that rely on file extensions fail immediately. Magic-byte inspection guarantees reliable ingestion.
5. **Visual Row Grouping**: In many custom templates, section and item names are entered once on a header row and left blank for subsequent comments. Without contextual inheritance, importers produce hundreds of orphaned items.

---

## 4. Architectural Principles vs Common Pitfalls

| Architectural Dimension | Common Migration Pitfalls | Our Meridian-Derived Approach | Why It Matters to the Customer |
|---|---|---|---|
| **Import Feedback** | Bare "Success" notification | Transparent audit report showing exact counts + verification badge | Inspector gets immediate visual proof that all 392 comments transferred. |
| **Hierarchy Preservation** | Re-sorting into arbitrary type buckets (Info / Limitations / Defects) | Preserving strict physical walking order | The inspector's room-by-room sequence is their hard-won operational speed. |
| **Data Completeness** | Dropping unmapped columns (e.g., photo slots, unit options) | Storing all 42 columns in `raw_cells` JSONB | Eliminates silent data loss and enables lossless re-export. |
| **Integrity Assurance** | Verifying only memory parse data | Pre-commit DB read-back verification with instant rollback | Guarantees that what is saved in Postgres matches the source file byte-for-byte. |
| **Domain Terminology** | Forcing proprietary new names on day one | Dual terminology bridge (Spectora ↔ Hive) | Reduces cognitive load and onboarding disorientation during software migration. |
| **Data Ownership** | Vendor lock-in with one-way import | Lossless `.xlsx` re-export with live edits | Eliminates switching fear by guaranteeing template portability. |

---

## 5. Domain Terminology Mapping

| Spectora Native | Hive Inspect Target | Database Representation | Role in Schema |
|---|---|---|---|
| **Section** | Section | `section_name` / `section_pos` | Primary inspection domain (e.g., "Roofing", "Electrical") |
| **Item** | Subsection | `item_name` / `item_pos` | Component group (e.g., "Shingles", "Service Panel") |
| **Comment** | Field / Narrative | `comment_name` / `comment_text` | Canned narrative text or field inspection prompt |
| **Comment Type** | Field Type | `comment_type` | Informational, Limitation, or Defect |
| **Category** | Severity Category | `category` | Low (-1), Medium (0), High (+1) |
| **Physical Order** | Walking Order | `field_pos` / `source_row` | Absolute sequential order through the inspection site |
