# Spectora → Hive Template Importer

A take-home assignment implementation for the Hive Inspect Forward Deployed Engineer role.

**Live demo:** [spectora-importer.vercel.app](https://spectora-importer.vercel.app) *(deploy to update this link)*

---

## What it does

Imports Spectora "Export HTML Text" `.xls` files into a persistent Supabase database and presents an editable template viewer. Designed around the specific failures of Spectora's export format, it:

- **Detects format by magic bytes**, not file extension — catches the Spectora "download page" trap, OLE2 legacy XLS, and plain-text exports before they silently corrupt
- **Preserves physical row order** — never sorts by the `Order` column (which has tied values in 38/69 items in the InterNACHI template)
- **Stores HTML comment text byte-identical** — no sanitisation, no re-encoding, no reformatting
- **Runs a round-trip fidelity verifier** on every import and shows the result inline
- **Cascades section/item renames** correctly across all rows at the same position
- Provides a **dual-pane editor** (raw HTML + live rendered preview) for comment text

## Requirements

- Node 20+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Vercel](https://vercel.com) account for deployment

## Setup

```bash
# 1. Clone and install
git clone <your-repo>
cd spectora-importer
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# 3. Apply schema
# Paste contents of schema/schema.sql into Supabase Dashboard → SQL Editor → Run

# 4. Seed the InterNACHI Residential template (required for demo)
npm run seed

# 5. Run locally
npm run dev
# → http://localhost:3000

# 6. Run parser tests
npm test
```

## Deployment (Vercel)

```bash
npx vercel --prod
```

Set these environment variables in Vercel Dashboard → Project → Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Also add these as GitHub Secrets (for the keepalive workflow):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Project structure

```
spectora-importer/
├── app/
│   ├── page.tsx                      # Landing page — import uploader
│   ├── templates/[id]/page.tsx       # Template viewer/editor
│   └── api/
│       ├── import/route.ts           # POST — parse + insert + verify
│       ├── fields/[id]/route.ts      # PATCH (edit) + PUT (revert)
│       └── templates/
│           ├── route.ts              # GET — list templates
│           └── [id]/duplicate/route.ts  # POST — deep copy
├── components/
│   ├── ImportUploader.tsx            # Drag-drop + import report UI
│   └── TemplateViewer.tsx            # Sectioned editor with inline edit & XLSX export
├── lib/
│   ├── parser.ts                     # OOXML parser with visual grouping & disjoint handling
│   ├── verifier.ts                   # Pre-commit write-path fidelity verifier with rollback
│   ├── sanitise.ts                   # XSS sanitizer for rich comment rendering (Froala allowlist)
│   ├── ai-auditor.ts                 # Air-gapped column confidence auditor seam
│   └── supabase.ts                   # Server + service Supabase clients
├── schema/
│   └── schema.sql                    # Postgres schema + RLS (apply once in Supabase)
├── scripts/
│   └── seed.ts                       # Seeds the InterNACHI Residential template
├── tests/
│   ├── parser.test.ts                # Parser unit tests (format detection, trap defenses)
│   ├── parser-new.test.ts            # Visual grouping, disjoint blocks, XSS tests
│   ├── verifier.test.ts              # Write-path verification & tamper tests
│   ├── ai-auditor.test.ts            # AI auditor validation seam & failure mode tests
│   ├── api.test.ts                   # Concurrency 409, cascade rename, revert & export tests
│   └── holdout.test.ts               # Blind tests across 8 real Spectora holdout exports
├── middleware.ts                     # Authenticated reviewer session handling
├── InterNACHI Residential -2026-10-01.xls  # Source inspection template
└── .github/workflows/keepalive.yml  # Pings Supabase every 48h (prevents free-tier pause)
```

## Architecture decisions

See [`NOTES.md`](./NOTES.md) for detailed design rationale, trade-offs, and failure mode analysis.

Key decisions:
- **Flat-row schema** with `section_pos / item_pos / field_pos` ordinals — section/item names are denormalized, renamed via cascading UPDATE
- **SheetJS `{ raw: true, cellDates: false }`** — prevents date and number type coercion, preserving exact string representations
- **Supabase Authentication** — session cookies with RLS policies scoped to `auth.uid() = owner_id`
- **Pre-commit rollback verification** — compares database fields against snapshot JSONB before finalizing import; rolls back entire transaction if discrepancies occur
- **Round-trip re-export (XLSX)** — reconstructs complete 42-column spreadsheet from snapshot matrix with user edits overlaid
- **Air-gapped AI auditor seam** — advisory column classification behind strict schema validation; deterministic parser always takes precedence
- **TypeScript deep-copy** — template duplication creates completely independent copies with new UUIDs and ownership

## Testing

```bash
npm test
```

67 tests across 6 test suites covering:
- Format detection (OOXML, OLE2, Spectora download page rejection)
- Real-world export nuances (visual grouping inheritance, disjoint section merging, Order column ties)
- Security & sanitisation (XSS payload stripping across Froala rich text controls)
- Pre-commit verifier & tamper detection (deliberate corruption detection & rollback)
- AI auditor failure modes (timeout, malformed JSON, schema hallucinations, value clamping)
- Optimistic concurrency conflict (409 on stale timestamp), section cascade rename, and revert to snapshot
- Blind testing across 8 real-world Spectora templates (Nick Gromicko master >1000 comments, Radon, TREC, Room-by-room)
