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
│   └── TemplateViewer.tsx            # Sectioned editor with inline edit
├── lib/
│   ├── parser.ts                     # OOXML parser (all 7 Spectora traps)
│   ├── verifier.ts                   # Round-trip fidelity verifier + tamper test
│   └── supabase.ts                   # Server + service Supabase clients
├── schema/
│   └── schema.sql                    # Postgres schema + RLS (apply once in Supabase)
├── scripts/
│   └── seed.ts                       # Seeds the InterNACHI Residential template
├── tests/
│   └── parser.test.ts                # 16 parser tests covering all 7 Spectora traps
├── middleware.ts                     # Anonymous auth on first visit
├── InterNACHI Residential -2026-10-01.xls  # Source template (H14)
└── .github/workflows/keepalive.yml  # Pings Supabase every 48h (prevents free-tier pause)
```

## Architecture decisions

See [`workspace/ARCHITECTURE.md`](../hive-handoff/hive-handoff/workspace/ARCHITECTURE.md) for full design rationale, rejected alternatives, and H1–H15 requirement traceability.

Key decisions:
- **Flat-row schema** with `section_pos / item_pos / field_pos` ordinals — section/item names are denormalized, renamed via cascading UPDATE
- **SheetJS `{ raw: true, cellDates: false }`** — prevents type coercion (Attacks 2 & 6)
- **Supabase Anonymous Auth** over `set_config` — correct with PgBouncer transaction pooling
- **TypeScript deep-copy** (not PL/pgSQL) — modifiable in seconds during live review
- **Snapshot JSONB** stored at import — verifier compares DB against it independently

## Testing

```bash
npm test
```

16 tests covering:
- Format detection (OOXML, OLE2, Spectora download page)
- Format rejection with correct error codes and human messages
- All 7 Spectora export traps (Order column, entity encoding, type coercion, non-unique keys, options_raw, blank rows, plain-text detection)
- Integration test against the real InterNACHI Residential XLS (392 fields, 13 sections, 69 items)
