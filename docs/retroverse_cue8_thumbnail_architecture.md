# Retroverse Cue 8 Thumbnail Architecture

**Status:** LOCKED operational standard (data layer only).

## Core rule

VirtualDJ `database.xml` **Cue 8** (`<Poi Type="cue" Num="8" …>`) is the canonical **thumbnail / visual identity** cue for a media instance.

- Deterministic at ingest: `cue_number === 8` → `is_thumbnail = true`
- Secondary: cue `Name` contains `thumbnail` or `thumb` (does not replace Cue 8 as canonical)
- No AI frame detection; trust the VDJ workflow

## Layering

| Layer | Role |
|-------|------|
| `retroverse_tracks` | Canonical song identity (RVTR) — historical graph truth |
| `retroverse_track_instances` | One row per `database.xml` `<Song>` (RVIN) — operational media object |
| `retroverse_track_cues` | One row per VDJ cue point (RVCU) — human-authored interaction intelligence |

**Do not** merge raw VDJ XML into `retroverse_tracks`. Instances link to RVTR via `retroverse_track_id` after fuzzy match.

## Tables (Supabase `public`)

- `retroverse_track_instances` — path, play stats, BPM/key, tags JSON, linkage, match metadata
- `retroverse_track_cues` — cue number, position, color, loop JSON, `is_thumbnail`
- `retroverse_vdj_ingest_runs` — weekly refresh audit log

Migration: `supabase/migrations/20260520120000_retroverse_track_instances_cues.sql`

## Ingestion pipeline

1. Parse `database.xml` → CSV (`scripts/parse_virtualdj_database.py`)
2. Match instances → RVTR (`lib/vdj-database-ingest/match-track.ts`)
3. Upsert instances + cues (`scripts/ingest_vdj_track_instances.ts`)
4. Flag Cue 8 (+ optional name match) (`lib/vdj-database-ingest/cue-thumbnail.ts`)
5. Prune stale cues on refresh (delete cues not touched in run)

## Commands

```bash
# Parse only
python3 scripts/parse_virtualdj_database.py

# Full ingest (parse + Supabase upsert)
npm run vdj:ingest

# Weekly refresh (same as ingest; cron-friendly)
npm run vdj:refresh
```

Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `VDJ_DATABASE_XML`.

## Weekly refresh

Minimum **once per week**. No real-time sync.

`npm run vdj:refresh` reparses XML, updates play counts, cue changes, and thumbnail flags.

## App read API (no UI in this pass)

- `loadThumbnailCuesForTrack(supabase, rvtrId)`
- `loadPrimaryThumbnailCueForTrack` — prefers Cue 8

## Future consumers

Chart card previews, hover stills, retroscope anchors, curator previews, timeline visual continuity — all read from `retroverse_track_cues` where `is_thumbnail = true`.

## Local Postgres mirror

`integrity_console/sql/910_retroverse_vdj_instances_cues_schema.sql`
