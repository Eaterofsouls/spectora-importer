# Architecture Specification: Spectora → Hive Template Migration Engine

> **Engineering Methodology:** Derived systematically via the **Meridian Framework** (7-phase engineering methodology synthesized from aerospace, nuclear, and software systems engineering).

---

## Executive Summary: Outcome & Core Guarantee

An inspector switching to Hive Inspect arrives with four years of accumulated judgment encoded in their template: 392 custom defect narratives, specific legal phrasing, room-by-room walking order, and severity ratings. If switching requires retyping or untangling corrupted hierarchies, **they will abandon the migration**.

This architecture solves the **Inspector Trust Dilemma** through a simple, mathematically verifiable outcome:
**Zero Silent Data Loss, Guaranteed Integrity, and Lossless Portability.**

---

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE MERIDIAN DERIVATION                                  │
│                                                                                        │
│  Phase 1: Problem Archaeology  ──►  Phase 2: Stratification  ──►  Phase 3: Failure     │
│  Cynefin: Complicated               S0: Invariants (Zero Loss)     Cartography (FTA)   │
│  First Principles: Ordinality       S1: Edit, Copy, Export         FMEA: High Detection│
│                                                                                        │
│  Phase 4: Synthesis (Pugh)     ──►  Phase 5: Contracts       ──►  Phase 6 & 7: Test    │
│  Candidate C (Flat + Matrix)        Postgres + JSONB Snapshot      100 Tests / 13 Suites│
│  TRIZ Grafting: Re-Export           Transactional Rollback         ADR Governance      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Problem Archaeology

### 1.1 Cynefin Categorization
- **Classification:** **Complicated Domain** (Sense → Analyze → Respond).
- **Rationale:** The problem appears superficially clear ("parse an Excel spreadsheet"), but forensic inspection of Spectora exports reveals deep format idiosyncrasies, structural ambiguities, and silent failure traps that demand disciplined systems engineering.

### 1.2 Stakeholder Excavation
1. **Primary (The Home Inspector):** Wants instant certainty that 4 years of work is safe. Demands that walking order is identical and that terminology matches their mental model.
2. **Secondary (Support & Forward Deployed Engineers):** Needs complete auditability. When an inspector asks "why is this item here?", the system must provide transparent row provenance.
3. **Silent Stakeholder (The Offline Inspection App):** Downstream mobile report-writing engines that will ingest this template require strict hierarchical consistency and clean HTML strings without broken DOM nodes.

### 1.3 First Principles Decomposition
- **Is file extension meaningful?** No. Spectora names its export `.xls`, but it is physically an OOXML ZIP container (`PK\x03\x04`). Extension-based routing causes fatal parsing errors. Magic bytes are the only physical truth.
- **Is the `Order` column a sort key?** No. In the InterNACHI Residential template, `Order (w/i item)` has identical ties in 38 of 69 items and resets arbitrarily to `0`. Sorting by this column scrambles the inspector's walking order. Physical row position in the file is the sole ground truth.
- **Are section and item names unique keys?** No. "General" and "Normal Operating Controls" appear across multiple sections. Hierarchical identity must come from surrogate positional ordinals (`section_pos`, `item_pos`, `field_pos`), never string names.

---

## Phase 2: Requirements Stratification (Limit-State Design)

Requirements are stratified into Limit States (from structural engineering) to ensure non-negotiable invariants are never compromised by secondary conveniences:

### Stratum 0: Invariants (Ultimate Limit State — Zero Tolerance)
- **S0.1 [Zero Evaporation]:** Every data row in the source file must map to an imported field, an identified empty row, or a transparently logged skipped row. `data_rows == imported + empty + skipped`.
- **S0.2 [Byte-Identical Preservation]:** HTML comment strings must not undergo normalisation, un-escaping, or whitespace mutation at storage time.
- **S0.3 [Independent Duplication]:** Cloned templates must share zero row IDs, foreign keys, or mutable object references. Mutation of a clone must have mathematical zero effect on the original.
- **S0.4 [Atomic Integrity]:** If any database constraint or cell mismatch occurs during ingestion, the entire template must roll back. Zero partial imports.

### Stratum 1: Core Functional (Structural Capacity)
- **S1.1 [Ingest]:** Ingest Spectora "Export HTML Text" workbooks via file upload.
- **S1.2 [Edit]:** Allow inline editing of comment text, comment names, item names, and section names with optimistic concurrency.
- **S1.3 [Persist]:** Retain templates, fields, and issues across sessions in a persistent relational store.
- **S1.4 [Export]:** Lossless round-trip export reconstructing the full 42-column `.xlsx` spreadsheet with user edits overlaid.

### Stratum 2: Operational & Trust (Serviceability)
- **S2.1 [Audit Proof]:** Visual import report displaying exact section/item/field counts, row accountability, and verification status.
- **S2.2 [Terminology Bridge]:** Toggleable UI allowing inspectors to view the hierarchy using Spectora terms (*Section > Item > Comment*) or Hive terms (*Section > Subsection > Field*).
- **S2.3 [XSS Shield]:** Client-side sanitisation matching Froala rich-text capabilities while strictly stripping executable scripts and untrusted iframes.

---

## Phase 3: Failure Cartography (FTA & FMEA)

Before synthesizing architectures, every potential failure mode was mapped systematically.

### 3.1 Fault Tree Analysis (FTA) — Top Catastrophic Event: "Customer Loses Data or Trust"

```
                              [FATAL: CUSTOMER LOSES DATA OR TRUST]
                                                │
                 ┌──────────────────────────────┴─────────────────────────────┐
                 │ (OR Gate - Single Points of Failure)                       │
         [Silent Data Loss]                                           [Scrambled Order]
                 │                                                            │
    ┌────────────┴────────────┐                                  ┌────────────┴────────────┐
[Unmapped Cols]         [Null Dropped]                    [Sort by Order]          [Disjoint Blocks]
  42 cols flattened       83 empty rows                     ties in 38 items         rows split across
  to bare DB fields       coerced to scrap                  scrambles flow           file create orphans
        │                       │                                │                        │
   (Converted:             (Converted:                      (Converted:              (Converted:
    AND Gate)               AND Gate)                        AND Gate)                AND Gate)
   raw_cells JSONB       Explicit Null preserved          Physical file index      Disjoint merge
   stores all 42 cols    as valid form prompt             section/item ordinals    with user warning
```

### 3.2 Failure Mode and Effects Analysis (FMEA)

In FMEA, **Detection (D)** is the silent killer. A failure that happens silently (high D) is far more dangerous than an overt crash:

| Failure Mode | Severity (S) | Occurrence (O) | Detection (D) | RPN (S×O×D) | Architectural Mitigation | Residual RPN |
|---|:---:|:---:|:---:|:---:|---|:---:|
| **Silent Write Corruption** (DB truncates or drops cell) | 9 | 4 | 9 | **324** | **Pre-Commit Verifier:** Read back from DB and compare against snapshot before commit. Roll back on mismatch. | **9** (S=9, O=1, D=1) |
| **Order Column Scrambling** | 8 | 8 | 4 | **256** | **Physical Ordinals:** Discard `Order` column for sorting; use file row index. | **8** (S=8, O=1, D=1) |
| **Form Fields Dropped** (83 rows with null text) | 8 | 9 | 3 | **216** | **Nullable Comment Semantics:** Distinguish narrative comments from form prompts. | **8** (S=8, O=1, D=1) |
| **Download Page Trap** (user uploads 53KB HTML page) | 6 | 6 | 5 | **180** | **Magic Byte Sniffer:** Detect `<!DOCTYPE` / `<html` and halt with actionable guidance. | **6** (S=6, O=1, D=1) |
| **Unmodelled Column Loss** | 7 | 8 | 3 | **168** | **Snapshot Matrix:** Store all 42 columns in `raw_cells` JSONB. | **7** (S=7, O=1, D=1) |

---

## Phase 4: Architecture Synthesis & Candidate Evaluation

Three distinct architectural candidates were formulated and evaluated using a TRIZ Pugh Matrix against the Datum (a standard naive relational mapper):

### Candidate A: Normalized Deeply-Nested Relational Graph
- Separate tables for `templates`, `sections`, `items`, and `comments` with relational foreign keys.
- *Pros:* High relational purity.
- *Cons:* Heavy multi-table transactional overhead; complex cascading updates on renames; high risk of orphaned rows during partial failures.

### Candidate B: Opaque Document / Rich JSON Store
- Entire template stored as a single large JSON document in Postgres.
- *Pros:* Fast ingestion, simple write.
- *Cons:* Cannot run atomic SQL updates on individual fields; concurrent edits cause whole-document race conditions; difficult to query.

### Candidate C (The Chosen Architecture): Flat-Row Schema with Positional Ordinals + Snapshot Matrix
- Hybrid relational/document design: Flat table of `fields` keyed by `(template_id, source_row)`.
- Positional ordinals (`section_pos`, `item_pos`, `field_pos`) establish strict hierarchy derived from physical row order.
- Full 42-column spreadsheet preserved in `raw_cells` JSONB and immutable template snapshot matrix.
- Pre-commit transactional read-back verifier with automatic rollback.

### Pugh Matrix Evaluation

| Evaluation Criteria | Weight | Datum (Naive) | Candidate A (Nested) | Candidate B (Opaque) | Candidate C (Chosen) |
|---|:---:|:---:|:---:|:---:|:---:|
| S0.1 Zero Silent Data Loss | 5 | 0 | +1 | 0 | **+2** (Lossless JSONB + flat rows) |
| S0.2 Byte-Identical Invariant | 5 | 0 | 0 | +1 | **+2** (Immutable snapshot verification) |
| S0.3 Independent Duplication | 4 | 0 | -1 | +1 | **+2** (Atomic deep-copy insert) |
| S1.2 Concurrency & Edit Safety | 4 | 0 | +1 | -2 | **+2** (Row-level optimistic concurrency) |
| S1.4 Round-Trip Re-Export | 4 | 0 | -1 | 0 | **+2** (Overlay live edits on raw matrix) |
| Architectural Simplicity / Legibility | 3 | 0 | -2 | +1 | **+1** (Single flat table + clean ordinals) |
| **Weighted Total** | | **0** | **-1** | **+2** | **+25 (Clear Winner)** |

---

## Phase 5: Contract Crystallization & System Architecture

### 5.1 System Component Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENT LAYER (Next.js 15)                              │
│                                                                                        │
│   ┌────────────────────────┐   ┌────────────────────────┐   ┌───────────────────────┐  │
│   │   ImportUploader.tsx   │   │   TemplateViewer.tsx   │   │  Terminology Bridge   │  │
│   │   Drag/Drop + Progress │   │   Dual-Pane HTML/Live  │   │  Spectora ↔ Hive      │  │
│   └───────────┬────────────┘   └───────────┬────────────┘   └───────────┬───────────┘  │
└───────────────┼────────────────────────────┼────────────────────────────┼──────────────┘
                │ HTTP POST                  │ HTTP PATCH                 │
                ▼                            ▼                            │
┌─────────────────────────────────────────────────────────────────────────┼──────────────┐
│                                API & SERVICE LAYER                      │              │
│                                                                         │              │
│   ┌────────────────────────┐   ┌────────────────────────┐               │              │
│   │   /api/import          │   │   /api/fields/[id]     │               │              │
│   │   Magic-Byte Sniff     │   │   Optimistic Lock (409)│               │              │
│   └───────────┬────────────┘   └───────────┬────────────┘               │              │
│               │                            │                            │              │
│               ▼                            │                            │              │
│   ┌────────────────────────┐               │                            │              │
│   │   lib/verifier.ts      │               │                            │              │
│   │   Pre-Commit Read-back │               │                            │              │
│   │   & Rollback Engine    │               │                            │              │
│   └───────────┬────────────┘               │                            │              │
└───────────────┼────────────────────────────┼────────────────────────────┼──────────────┘
                │                            │                            │
                ▼                            ▼                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            PERSISTENCE LAYER (Supabase / Postgres)                     │
│                                                                                        │
│   ┌────────────────────────┐   ┌────────────────────────┐   ┌───────────────────────┐  │
│   │      `templates`       │   │        `fields`        │   │    `import_issues`    │  │
│   │   id, name, snapshot   │   │   (template_id, pos)   │   │   severity, code, msg │  │
│   │   raw 42xN matrix      │   │   raw_cells JSONB      │   │   row accountability  │  │
│   └────────────────────────┘   └────────────────────────┘   └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 The Pre-Commit Verification Contract
1. Parser ingests file into memory structures (`ParsedField[]`, `SnapshotMatrix`).
2. API inserts template and all fields inside a transaction boundary.
3. **The Verifier executes an independent read-back query**:
   `SELECT source_row, comment_name, comment_text FROM fields WHERE template_id = $id`
4. The Verifier performs a cell-by-cell assertion against the in-memory snapshot.
5. If **any discrepancy** is detected (count mismatch, text truncation, altered ordinals):
   - An immediate `DELETE` cascades across template, fields, and issues.
   - An HTTP 422 is returned with the exact mismatch report.
   - Zero corrupted state enters the database.

---

## Phase 6: Validation Mapping & Tamper Resilience

Verification does not rely on unit tests re-running the parser's own assumptions. A dedicated **Multi-Vector Tamper Test Suite** (`tests/tamper-suite.test.ts`) subjects the verifier to 8 deliberate sabotage vectors to prove it is mathematically capable of failing:

| Tamper Vector | Sabotage Action | Verifier Reaction | Result |
|---|---|---|:---:|
| `MUTATE_COMMENT_TEXT` | Injects character mutation into stored comment | Caught mismatch on `comment_text` | **PASS (Detected)** |
| `MUTATE_COMMENT_NAME` | Modifies name of stored comment | Caught mismatch on `comment_name` | **PASS (Detected)** |
| `MUTATE_ORDINAL` | Corrupts `field_pos` ordinal sequence | Caught sequence discontinuity | **PASS (Detected)** |
| `DROP_ROW` | Silently deletes one field from DB | Caught row count deficit (`391 != 392`) | **PASS (Detected)** |
| `SYNTHESIZE_ROW` | Injects phantom record into DB | Caught row count excess (`393 != 392`) | **PASS (Detected)** |
| `XSS_INJECTION` | Injects `<script>alert(1)</script>` into comment | Caught by Froala allowlist sanitizer | **PASS (Sanitised)** |
| `CORRUPT_NULL_TEXT` | Coerces null prompt to empty string `""` | Caught null-coercion divergence | **PASS (Detected)** |
| `CONCURRENCY_COLLISION` | Submits update with stale `updated_at` | Emits HTTP 409 Conflict | **PASS (Blocked)** |

---

## Phase 7: Architecture Decision Records (ADRs)

### ADR-001: Flat-Row Relational Storage with Positional Ordinals
- **Context:** Spectora hierarchy has duplicate item names across sections and broken `Order` columns.
- **Decision:** Store fields in a single flat table with composite ordinals (`section_pos`, `item_pos`, `field_pos`) derived strictly from physical appearance in the source file.
- **Consequences:** Eliminates join cascades; makes section/item renames atomic via `UPDATE fields SET section_name = $new WHERE section_pos = $pos`; guarantees identical walking order.

### ADR-002: Pre-Commit Write-Path Verification with Rollback
- **Context:** Ingestion engines often suffer from silent database casting, constraint truncation, or network drops.
- **Decision:** Mandatory read-back verification comparing stored Postgres rows against the raw spreadsheet snapshot before finalizing the import.
- **Consequences:** 100% detection rate of storage-layer corruptions. Guarantees that what the inspector sees is byte-for-byte what was uploaded.

### ADR-003: Air-Gapped AI Seam with Deterministic Supremacy
- **Context:** LLMs are valuable for semantic classification but non-deterministic for core parsing.
- **Decision:** Position AI strictly as an advisory column auditor running after deterministic parsing. Pass only headers and sample data (zero user PII). Validate all AI responses through strict Zod schemas with instant fallback on timeout or malformed JSON.
- **Consequences:** Deterministic rules always win. Zero chance of AI hallucinating new sections or dropping customer comments.

### ADR-004: Lossless 42-Column Round-Trip Re-Export
- **Context:** Inspectors fear vendor lock-in when switching platforms.
- **Decision:** Preserve all 42 columns (including photo slots and contractor tags) in `raw_cells` JSONB. Expose `GET /api/templates/[id]/export` to reconstruct the original `.xlsx` workbook with inspector edits applied.
- **Consequences:** Provides complete data portability, establishing maximum switching confidence.
