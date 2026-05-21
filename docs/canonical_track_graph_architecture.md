# Canonical track graph architecture

**Status:** Graph layer + app wiring (local PostgreSQL `retroverse`).

## Principle

| Layer | Represents |
|-------|------------|
| `canonical_tracks` | **The song** (`RVTR######`) |
| `canonical_track_versions` | Recordings, remasters, acoustic rows, VDJ files, graph `tracks` rows |
| `retroverse_tracks` (Supabase) | Public entity row (same `RVTR` when synced) |

A canonical track exists only when:

- it charted on **Billboard Hot 100**, or
- it exists in the **VDJ media** library.

## Artifacts

| File | Role |
|------|------|
| `integrity_console/sql/1201_canonical_track_graph_schema.sql` | Tables + `canonical_track_display` view |
| `scripts/export_canonical_track_graph_staging.py` | Build staging CSV (Hot 100 + VDJ + acoustic versions) |
| `integrity_console/sql/1203_populate_canonical_track_graph.sql` | Load graph; backfill `canonical_album_tracks.canonical_track_key` |
| `integrity_console/sql/1202_canonical_track_graph_report.sql` | Readiness report |
| `lib/load-canonical-track-graph.ts` | App loaders (entity, versions, album route index, search dedupe) |

## Run

```bash
npm run graph:canonical-track-graph:export
npm run graph:canonical-track-graph:load
psql -h localhost -U bobhopp -d retroverse -f integrity_console/sql/1202_canonical_track_graph_report.sql
```

## App wiring

| Surface | Behavior |
|---------|----------|
| `/tracks/[id]` | Resolves `RVTR` via graph first; hydrates `canonicalEntity` + `canonicalVersions` under Supabase payload |
| Album track rows | `loadAlbumTrackRouteIndex` — graph index first, Supabase fallback |
| Home search tracks | `searchCanonicalTracksByTitle` — one entity per artist+stem before Supabase |

## RVTR allocation

Same deterministic hash as Wave1 backfill: `track::{normalized_title}::{artist_id}` → `RVTR######`.

Versions never receive separate public routes by default.
