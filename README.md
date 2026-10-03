# Spectora → Hive Template Migration Suite

> **Zero-loss migration engine that imports, verifies, and preserves 4-year-tuned Spectora inspection templates into Hive Inspect without losing a single defect, walking sequence, or formatting rule.**

[![Build & Test Status](https://img.shields.io/badge/tests-100%20passing-emerald)](https://github.com)
[![Methodology](https://img.shields.io/badge/architecture-Meridian%20Framework-blue)](./ARCHITECTURE.md)
[![Integrity](https://img.shields.io/badge/verification-pre--commit%20rollback-amber)](./ARCHITECTURE.md#phase-3-failure-cartography)

**Live Demo:** [spectora-importer.vercel.app](https://spectora-importer.vercel.app) *(Pre-seeded with InterNACHI Residential Master Template)*

---

## 🎯 The Inspector's Problem — Solved

A home inspector switching to Hive Inspect carries 4 years of field wisdom in their template:
- 392 curated narratives with specific legal wording
- The exact sequence they walk a house room-by-room
- Critical input fields and defect severity ratings

If switching requires retyping or untangling scrambled sections, **they will not switch**.

This engine guarantees **Zero Silent Data Loss** by deriving every architectural layer from first principles using the **Meridian Framework** (detailed in [`ARCHITECTURE.md`](./ARCHITECTURE.md)):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE MIGRATION WORKFLOW                                    │
│                                                                                        │
│  1. Ingest (Magic Bytes)   ──►  2. Pre-Commit Verifier  ──►  3. Inspector Workspace    │
│     Catches download page       Reads back from DB           Dual-pane HTML/Preview    │
│     & legacy XLS variants       Rolls back on mismatch       Physical order preserved  │
│                                                                                        │
│  4. Independent Copy       ──►  5. Lossless Re-Export   ──►  6. Air-Gapped AI Seam     │
│     Deep-cloned templates       Full 42-col .xlsx output     Advisory confidence check │
│     zero cross-contamination    No vendor lock-in            Strict fallback on error  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 What Sets This Apart

1. **Pre-Commit Write-Path Verification with Rollback**: Other importers show a generic "Success" message when memory parsing completes, blind to database constraints or network truncation. This engine reads back every persisted row from Postgres and verifies it against the raw snapshot before finalizing the transaction. If a single character differs, the entire import rolls back.
2. **Physical Walking Order Preservation**: Spectora's `Order` column contains duplicate zeroes in 38 of 69 items in InterNACHI Residential. Sorting by it scrambles the template. This engine indexes strictly by physical row appearance (`section_pos`, `item_pos`, `field_pos`).
3. **Lossless Round-Trip Re-Export (`.xlsx`)**: Unmodelled vendor columns (photo slots, contractor tags, unit settings) are preserved in an immutable `raw_cells` JSONB store. Inspectors can export their modified template back into a complete 42-column spreadsheet anytime. Zero lock-in.
4. **Resilient Handling of Data Traps**:
   - Preserves 83 form-input fields with null comments (which naive parsers discard as empty rows)
   - Handles visual grouping (automatically inherits section names across blank rows)
   - Merges disjoint section blocks with transparent warnings
   - Defends against XSS injection across Froala rich-text comment controls
5. **Air-Gapped AI Column Auditor**: AI is used strictly as an advisory column confidence scorer, air-gapped from core parsing. Validated with strict Zod schemas and tested against timeout, non-JSON output, and hallucinations. Deterministic rules always take precedence.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Vercel](https://vercel.com) deployment account (optional for local dev)

### Local Setup

```bash
# 1. Clone & install dependencies
git clone <your-repo>
cd spectora-importer
npm install

# 2. Configure environment
cp .env.example .env.local
# Add your NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY

# 3. Apply the Postgres schema
# Run schema/schema.sql in your Supabase SQL Editor

# 4. Seed the InterNACHI Master Template
npm run seed

# 5. Launch development server
npm run dev
# Open http://localhost:3000
```

---

## 🧪 Testing & Verification

Run the comprehensive test suite:

```bash
npm test
```

**100 tests passing across 13 test suites**, covering:
- **Format Forensics**: Magic-byte sniffing, OLE2 rejection, download-page traps
- **Data Invariants**: Mathematical row accounting (`accounted = processed + empty + skipped`)
- **Write-Path Verification**: Transactional rollbacks on database mismatch
- **Multi-Vector Tamper Attacks**: Deliberate field mutations caught at 100% capture rate
- **AI Failure Modes**: Schema hallucinations, API timeouts, invalid confidence clamping
- **Concurrency & Duplication**: 409 conflict detection and deep-cloning isolation
- **Holdout Validation**: Blind parsing across 9 real Spectora export templates (including Nick Gromicko's >1,000-comment master template, Texas TREC, and Radon)

---

## 📐 Architecture & Engineering Rigour

The complete architecture was derived through the **7-phase Meridian Framework**:
1. **Problem Archaeology**: Cynefin categorization & first-principles data decomposition
2. **Requirements Stratification**: Limit-state invariant separation (S0: Zero Data Loss)
3. **Failure Cartography**: Top-down Fault Tree Analysis (FTA) & bottom-up FMEA degradation mapping
4. **Architecture Synthesis**: TRIZ candidate evaluation & Pugh matrix scoring against alternatives
5. **Contract Crystallization**: Schema guarantees, boundary invariants, and sanitisation policies
6. **Validation Mapping**: Traceable automated test matrix and chaos scenarios
7. **Decision Governance**: Architecture Decision Records (ADRs) for schema, verifier, and AI seams

For the full architectural derivation, read [**`ARCHITECTURE.md`**](./ARCHITECTURE.md).
For trade-offs, constraints, and intentional cuts, see [**`NOTES.md`**](./NOTES.md).

---

## 📂 Project Directory Structure

```
spectora-importer/
├── app/
│   ├── page.tsx                      # Landing page with drag-and-drop uploader
│   ├── templates/page.tsx            # Template library
│   ├── templates/[id]/page.tsx       # Inspector workspace & template viewer
│   └── api/
│       ├── import/route.ts           # Ingest + pre-commit verifier + rollback
│       ├── fields/[id]/route.ts      # Optimistic concurrency edit & revert
│       └── templates/
│           ├── route.ts              # Template listing
│           ├── [id]/duplicate/route.ts  # Deep-copy cloning
│           └── [id]/export/route.ts  # Lossless 42-col XLSX re-export
├── components/
│   ├── ImportUploader.tsx            # Upload UI with inline fidelity audit report
│   └── TemplateViewer.tsx            # Dual-pane editor, terminology bridge & export
├── lib/
│   ├── parser.ts                     # OOXML parser with visual grouping & disjoint handling
│   ├── verifier.ts                   # Pre-commit write-path verifier & tamper engine
│   ├── sanitise.ts                   # Froala-compatible XSS sanitisation allowlist
│   ├── ai-auditor.ts                 # Air-gapped column confidence seam
│   └── supabase.ts                   # Scoped Supabase client helpers
├── schema/
│   └── schema.sql                    # Postgres schema, surrogate ordinals & RLS policies
├── fixtures/                         # Real-world Spectora template fixtures & holdouts
├── tests/                            # 13 test suites (100 unit, integration & tamper tests)
├── ARCHITECTURE.md                   # Formal Meridian Framework engineering derivation
├── NOTES.md                          # Engineering decisions, trade-offs & cuts
└── vercel.json                       # Production serverless runtime configuration
```
