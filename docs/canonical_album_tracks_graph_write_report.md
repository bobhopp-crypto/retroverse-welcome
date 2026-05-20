# Canonical album tracks graph write report

**Generated:** 2026-05-20 (local PostgreSQL `retroverse`)

## What was written

| Artifact | Purpose |
|----------|---------|
| `integrity_console/sql/1101_canonical_album_tracks_schema.sql` | `canonical_album_tracks` + `canonical_album_track_display` view |
| `scripts/export_canonical_album_tracks_staging.py` | CSV export (manual seq + MB sidecar + acoustic match) |
| `integrity_console/sql/1102_populate_canonical_album_tracks.sql` | Load graph from staging; clean acoustic fallback |
| `integrity_console/sql/1103_canonical_album_tracks_report.sql` | Readiness report |

## Population counts (live)

| Metric | Count |
|--------|------:|
| `canonical_album_tracks` rows | **56,150** |
| Albums with canonical tracks | **5,736** |
| Albums with ≥6 tracks | **5,703** |
| Rows with acoustic enrichment | **39,363** |
| Rows missing acoustic | **16,787** |
| `review_required` (fallback only) | **291** |

Source priority in export: **manual canonical (5)** → **MusicBrainz sidecar (6,667 RVAL)** → acoustic attach from `staging_acoustic_tracks` by artist+album.

## Thriller (`RVAL586982` / `album_id` 39831)

| Pos | Title | `acoustic_source_id` |
|-----|-------|---------------------|
| 1 | Wanna Be Startin' Somethin' | 121070 |
| 2 | Baby Be Mine | 157881 |
| 3 | The Girl Is Mine | 71994 |
| 4 | Thriller | 151270 |
| 5 | **Beat It** | **61275** |
| 6 | Billie Jean | 227483 |
| 7 | Human Nature | 135693 |
| 8 | P.Y.T. (Pretty Young Thing) | 251552 |
| 9 | The Lady in My Life | 192499 |

**Beat It diagnosis:** Initially **no match** because export only used `acoustic_track_album_candidates` (0 rows for this album). Fixed by matching full `staging_acoustic_tracks` pool on artist+album. Winner: `Beat It - Single Version` (id **61275**, score **157**); remix row scored **-35** (rejected).

## Application wiring

`/albums/[slug]` track priority:

1. `canonical_album_track_display` (Postgres via `album_external_keys`)
2. MusicBrainz sidecar JSON
3. Manual `canonical-album-sequences.json`
4. Clean acoustic fallback (runtime only)

## Run commands

```bash
npm run graph:canonical-tracks:export
npm run graph:canonical-tracks:load
psql -h localhost -U bobhopp -d retroverse -f integrity_console/sql/1103_canonical_album_tracks_report.sql
```

## Chart run

`/albums/RVAL586982/chart-run` uses Supabase `canonical_album_chart_runs` when available; falls back to Billboard SQLite (`348` weeks for Thriller).
