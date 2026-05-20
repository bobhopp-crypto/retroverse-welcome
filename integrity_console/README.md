# Retroverse Integrity Console

SQL-first integrity operations for the local `retroverse` PostgreSQL database.

This is **not** a disposable importer script. It is the controlled merge layer for canonical graph hygiene: find duplicates, preview impact, execute with transactions, and audit results in DBeaver or `psql`.

## Prerequisites

- Database: `retroverse` on `localhost`
- User: `bobhopp`
- Populated tables: `artists`, `artist_aliases`, `albums`, `tracks`, `chart_appearances`

## File guide

### Phase 1 — Artist integrity

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/001_artist_case_duplicate_candidates.sql` | List case/whitespace duplicate artist groups | No |
| `sql/002_artist_merge_dry_run.sql` | Preview one merge (single pair) | No |
| `sql/003_artist_merge_execute.sql` | Merge one duplicate into one canonical | **Yes** |
| `sql/004_artist_lowercase_bulk_merge_dry_run.sql` | Preview all safe bulk case merges | No |
| `sql/005_artist_lowercase_bulk_merge_execute.sql` | Execute safe bulk case merges | **Yes** |

### Phase 2 — Track canonical identity (analysis only)

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/201_track_normalization_candidates.sql` | Per-track normalization fields and version flags | No |
| `sql/202_track_duplicate_candidate_groups.sql` | Duplicate groups with confidence scoring | No |
| `sql/203_track_version_analysis.sql` | Version classification and preservation guidance | No |
| `sql/204_track_merge_readiness_report.sql` | Merge readiness metrics + top 100 groups | No |

### Phase 3 — Track family modeling

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/301_track_family_schema.sql` | Create `track_families`, `track_family_members`, `track_variant_types` | **Yes** (additive DDL) |
| `sql/302_track_family_candidate_generation.sql` | Proposed families from normalized titles | No |
| `sql/303_track_family_population_preview.sql` | Preview families, members, variants, chart counts | No |
| `sql/304_track_variant_relationship_analysis.sql` | Pairwise variant relationships inside families | No |
| `sql/305_track_family_population_execute.sql` | Populate families + members (idempotent) | **Yes** (additive DML) |

### Phase 4 — Album identity & lineage (analysis only)

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/401_album_identity_analysis.sql` | Album graph integrity report | No |
| `sql/402_album_family_candidates.sql` | Canonical album family candidates | No |
| `sql/403_album_track_lineage_analysis.sql` | Album ↔ track family lineage | No |
| `sql/404_billboard_200_import_readiness.sql` | Billboard 200 import readiness | No |
| `sql/405_album_graph_preview.sql` | Artist → album → edition → track family graph | No |

### Phase 5 — Billboard 200 + MusicBrainz ingestion

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/501_billboard_200_staging_schema.sql` | Staging + linkage tables | **Yes** (additive DDL) |
| `sql/502_billboard_200_import_pipeline.sql` | Staging → linkage → `chart_appearances` | **Yes** (additive DML) |
| `sql/503_musicbrainz_tracklist_linkage.sql` | MB tracklist linkage analysis | No |
| `sql/504_album_track_graph_population.sql` | Populate `album_track_lineage` | **Yes** (additive DML) |
| `sql/505_billboard_200_readiness_report.sql` | Post-ingestion coverage report | No |
| `sql/506_album_timeline_preview.sql` | Album timeline / B200 preview | No |

### Phase 6 — Canonical album population

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/601_canonical_album_population_candidates.sql` | B200 → proposed album keys | No |
| `sql/602_album_edition_detection.sql` | Edition type detection from staging titles | No |
| `sql/603_album_population_preview.sql` | Population preview (candidates + editions) | No |
| `sql/604_canonical_album_population_execute.sql` | Populate `albums`, `album_editions`, registry | **Yes** (additive DML) |
| `sql/605_album_chart_linkage_population.sql` | B200 `chart_appearances` via registry | **Yes** (additive DML) |
| `sql/606_album_population_readiness_report.sql` | Post-population coverage report | No |

## Run order

### Artists

1. **Discover** — `001_artist_case_duplicate_candidates.sql`
2. **Preview one** — `002` with IDs from step 1
3. **Execute one** (optional) — `003` with same IDs
4. **Preview bulk** — `004_artist_lowercase_bulk_merge_dry_run.sql`
5. **Execute bulk** (optional) — `005` only after reviewing step 4

**Always run dry-run (`002` or `004`) immediately before execute (`003` or `005`).**

### Tracks (Phase 2 — no mutations yet)

1. `201_track_normalization_candidates.sql` — inspect normalization output
2. `202_track_duplicate_candidate_groups.sql` — review duplicate pairs and confidence
3. `203_track_version_analysis.sql` — classify live/remix/remaster variants
4. `204_track_merge_readiness_report.sql` — summary metrics and top groups

Future Phase 2b will add track merge dry-run/execute scripts. **Do not merge tracks until those exist and are reviewed.**

### Track families (Phase 3)

1. `301_track_family_schema.sql` — run once (safe to re-run)
2. `302_track_family_candidate_generation.sql` — review proposed families
3. `303_track_family_population_preview.sql` — inspect members before population
4. `304_track_variant_relationship_analysis.sql` — review pairwise relationships
5. `305_track_family_population_execute.sql` — populate identity tables only

**305 does not modify `tracks` or `chart_appearances`.** Re-running 305 skips existing members (`ON CONFLICT DO NOTHING`).

### Albums (Phase 4 — read-only)

1. `401_album_identity_analysis.sql` — orphans, duplicates, chart gaps
2. `402_album_family_candidates.sql` — proposed album families (remaster/deluxe/live preserved)
3. `403_album_track_lineage_analysis.sql` — album ↔ track family wiring
4. `404_billboard_200_import_readiness.sql` — structural B200 readiness
5. `405_album_graph_preview.sql` — full graph preview (limited rows)

**Phase 4 does not merge albums, delete editions, or rewrite chart history.**

### Billboard 200 + MusicBrainz (Phase 5)

1. `501_billboard_200_staging_schema.sql` — create staging + linkage tables
2. Load `staging_billboard_200_weekly` (CSV `\copy` from SQLite export)
3. `502_billboard_200_import_pipeline.sql` — linkage candidates + chart rows (idempotent)
4. Load `staging_album_tracklist_imports` / `staging_musicbrainz_release_mappings`
5. `503_musicbrainz_tracklist_linkage.sql` — review MB linkage
6. `504_album_track_graph_population.sql` — populate `album_track_lineage`
7. `505_billboard_200_readiness_report.sql` — coverage metrics
8. `506_album_timeline_preview.sql` — timeline inspection

**Integrity viewer** (`/integrity`): Albums, Billboard 200, Album Tracklists sections (read-only).

### Canonical albums (Phase 6)

1. `601_canonical_album_population_candidates.sql` — review proposed keys + confidence
2. `602_album_edition_detection.sql` — edition variants per base title
3. `603_album_population_preview.sql` — read-only population preview
4. `604_canonical_album_population_execute.sql` — create albums + editions + registry
5. `605_album_chart_linkage_population.sql` — linkage candidates + B200 chart rows (`review_flag = ok` only)
6. `606_album_population_readiness_report.sql` — coverage + unresolved queue

**Phase 6 does not merge albums, delete staging, or rewrite Hot 100 chart history.**

**Integrity viewer** (`/integrity`): Album Families, Editions, Billboard 200 timelines, album lineage (read-only).

### Canonical linkage (Phase 7)

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/701_linkage_schema.sql` | Linkage + media tables | **Yes** (additive DDL) |
| `sql/702_album_tracklist_linkage_candidates.sql` | Track family ↔ album candidates | No |
| `sql/703_populate_canonical_track_album_links.sql` | Populate `canonical_track_album_links` | **Yes** (additive DML) |
| `sql/704_hot100_to_album_linkage_candidates.sql` | Hot 100 → album candidates | No |
| `sql/705_populate_chart_track_album_links.sql` | Populate `chart_track_album_links` | **Yes** (additive DML) |
| `sql/706_virtualdj_media_staging_schema.sql` | `staging_virtualdj_tracks` | **Yes** (additive DDL) |
| `sql/707_virtualdj_linkage_candidates.sql` | VDJ → track/family/album candidates | No |
| `sql/708_linkage_readiness_report.sql` | Linkage coverage report | No |

1. `701` → `702` → `703` → `704` → `705` → `706` → `707` → `708`
2. VDJ import is optional; `707`/`708` succeed with zero staging rows.

**Phase 7 does not merge tracks/albums, delete rows, or rewrite `chart_appearances`.**

**Integrity viewer** (`/integrity`): Linkage, Hot 100 → Album, Album ↔ Family, Media Assets, VDJ Candidates (read-only).

### Acoustic features discovery (Phase 7b)

| File | Purpose |
|------|---------|
| `docs/acoustics_linkage_investigation.md` | SQLite `acoustic_features` forensics + integration plan |
| `sql/801_acoustic_features_track_album_candidates.sql` | Track ↔ album candidates from staging (read-only SELECT) |

No table named `acoustics` — source is **`acoustic_features`** in `billboard-200-albums-charts.db` only.

### Acoustic graph materialization (Phase 8A)

**`acoustic_features` is the primary bridge dataset** for album tracklists and track↔album linkage. Same song on multiple albums is **valid chart history**, not an error — those rows get `review_required`, not deletion.

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/801_acoustics_staging_schema.sql` | `staging_acoustic_tracks` + `acoustic_track_album_candidates` | **Yes** (DDL) |
| `scripts/export_acoustics_from_sqlite.py` | Export SQLite → CSV | No |
| `sql/803_load_acoustics_staging.sql` | Load staging (idempotent) | **Yes** (DML) |
| `sql/804_acoustic_track_album_candidate_generation.sql` | Build candidates | **Yes** (DML) |
| `sql/805_populate_album_track_lineage_from_acoustics.sql` | Lineage + ctal + `tracks.album_id` | **Yes** (additive) |
| `sql/806_hot100_album_backfill_from_acoustics.sql` | Hot 100 chart↔album links | **Yes** (additive) |
| `sql/807_acoustic_linkage_readiness_report.sql` | Coverage report | No |

**Run order:**

1. `801_acoustics_staging_schema.sql`
2. `python3 scripts/export_acoustics_from_sqlite.py`
3. `\copy` CSV → `staging_acoustic_tracks_import_buffer` (see `803`)
4. `803_load_acoustics_staging.sql`
5. `804_acoustic_track_album_candidate_generation.sql`
6. `805_populate_album_track_lineage_from_acoustics.sql`
7. `806_hot100_album_backfill_from_acoustics.sql`
8. `807_acoustic_linkage_readiness_report.sql`

**Integrity viewer:** Acoustic Linkage, Acoustic Tracklists, Hot 100 Backfill, Multi-Album Songs (read-only).

## Retroverse Canonical Linkage Layer

Tracks, albums, charts, and media files are **separate identity layers**. Linkage tables are the nervous system between them.

| Layer | Role | Canonical? |
|-------|------|------------|
| `tracks` / `track_families` | Recording-first song identity | Yes |
| `albums` / `album_editions` | Release-first album identity | Yes |
| `chart_appearances` | Historical chart facts (never rewritten) | Fact |
| `media_assets` / VDJ staging | Operational playback files | No — operational |

**Why linkage tables exist**

- A Hot 100 week points at a `track_id`, not necessarily an album. `chart_track_album_links` records *which album context* applies for that chart row without changing the chart fact.
- A track family can appear on many albums. `canonical_track_album_links` records each appearance with edition, disc, and track number when known.
- VirtualDJ paths are **operational identity** (what you play). Canonical tracks are **catalog identity** (what Retroverse knows). `media_track_links` bridges them with confidence and review flags.

**Self-healing review flags**

- `review_flag = ok` — safe for automated downstream use.
- `review_flag = review_required` — inserted but ambiguous (multiple albums, weak match, missing family). Human or later rules can promote to `ok` without re-ingesting charts.

**VirtualDJ / media**

- Import into `staging_virtualdj_tracks` when ready (`706` schema only in this phase).
- Candidates from `707` never overwrite canonical rows.
- Populate `media_assets` + `media_track_links` in a future execute step after staging review.

## Retroverse Album Identity Model

Albums in Retroverse are **canonical identity anchors**, not flat release metadata.

| Concept | Table / layer | What it represents |
|---------|----------------|-------------------|
| **Canonical album** | `albums` | Artist-owned album identity (title + release context) |
| **Edition** | `album_editions` | Release/edition slice (remaster year, deluxe, canonical flag) |
| **Album track** | `tracks.album_id` | Which recordings appear on this album |
| **Track family** | `track_families` + members | Song-level identity under the album |
| **Chart lineage** | `chart_appearances` | Week facts on `album_id` and/or `track_id` — never collapsed in Phase 4 |

### Relationship to track families

- **Album** = release container (Hotel California the album).
- **Track family** = song identity (title variants across cuts).
- **Edition** = which pressing/package (Deluxe, Remastered 2013).
- **Chart appearance** = historical proof of what charted.

Phase 4 analysis links these layers without merging rows. Future album merge tooling must preserve chart FKs the same way track merges do.

## Retroverse Track Identity Model

Retroverse models music as a **historical identity graph**, not a collapsed metadata catalog.

| Concept | Table / layer | What it represents |
|---------|----------------|-------------------|
| **Track family** | `track_families` | Canonical song family for one artist (e.g. `Hotel California`) |
| **Family membership** | `track_family_members` | Links existing `tracks` rows into a family without merging them |
| **Recording** | `tracks` row (primary member) | The best candidate canonical recording (`is_primary_recording`) |
| **Recording variant** | `tracks` row + `relationship_type` | Remaster, live, remix, edit, etc. |
| **Release version** | Album/edition context on `tracks.album_id` | Release packaging (not overwritten in Phase 3) |
| **Chart appearance** | `chart_appearances` | Historical chart fact — always stays on the original `track_id` |

### Why lineage is preserved

Chart weeks, DJ history, and curator review depend on knowing **which track row charted**. Families group related rows for analysis; they do not rewrite chart FKs. Live and remaster cuts remain distinct until an explicit future merge phase with dry-run approval.

### Reversibility

Phase 3 is additive: new tables only. Removing family assignments later does not require touching canonical track or chart data.

## Track normalization philosophy

Retroverse is building a **music identity graph**, not a flat deduped song list.

The same cultural work appears under many release identities:

- `Hotel California`
- `Hotel California - Remastered`
- `Hotel California (Live)`
- `Hotel California [Explicit]`

These are related but not interchangeable. A remaster is not a live performance. A radio edit is not an album cut. Chart history attaches to specific appearances.

### Why live / remix / remaster variants matter

Billboard and DJ history preserve **what charted, when, and as what listing**. Collapsing variants too early destroys lineage and makes chart inspection wrong.

### Why Retroverse preserves lineage

`chart_appearances` links through `tracks`. Merging the wrong rows rewrites chart history silently. Phase 2 analysis keeps variants visible until confidence and preservation rules are explicit.

### Three identity layers

| Layer | Meaning | Example |
|-------|---------|---------|
| **Canonical identity** | The underlying musical work for an artist | `Hotel California` by Eagles |
| **Release / version identity** | A specific edition or cut | `2013 Remaster`, `Live at Forum 1976` |
| **Chart identity** | A chart-week fact tied to a track row | Hot 100 #1, 1977-05-07 |

Phase 2 SQL separates these layers in analysis. Phase 2b merge tooling (not yet built) will only collapse rows when confidence and preservation rules allow.

## Example: Eagles / eagles

```bash
psql -h localhost -U bobhopp -d retroverse
```

```sql
-- 1) Find the group
\i integrity_console/sql/001_artist_case_duplicate_candidates.sql

-- Suppose you see:
--   duplicate artist_id = 42  name = eagles
--   canonical artist_id = 7   name = Eagles

-- 2) Dry-run single merge
\set duplicate_artist_id 42
\set canonical_artist_id 7
\i integrity_console/sql/002_artist_merge_dry_run.sql

-- 3) Execute only if safety_status is OK
\set duplicate_artist_id 42
\set canonical_artist_id 7
\i integrity_console/sql/003_artist_merge_execute.sql
```

Expected outcome:

- `tracks.artist_id` and `albums.artist_id` point at `Eagles`
- `eagles` preserved as an `artist_aliases` row when names differ by case
- `chart_appearances` unchanged (still linked through `tracks`)
- duplicate `artists` row removed

## Canonical selection rules (001 / 004 / 005)

1. Prefer name with mixed case over all-lowercase
2. Most chart rows (via `tracks` → `chart_appearances`)
3. Most tracks
4. Most albums
5. Lowest `artists.id`

Bulk execute (`005`) adds hard gates:

- Normalized names must match (case/spacing only)
- At most one mixed-case name per group
- No merge when multiple competing proper-case names exist

## Rollback philosophy

- Every execute script is wrapped in `BEGIN` / `COMMIT`.
- If anything fails, PostgreSQL rolls back the whole transaction.
- For extra safety on bulk: run inside a manual transaction and `ROLLBACK` instead of `COMMIT` until satisfied:

```sql
BEGIN;
\i integrity_console/sql/005_artist_lowercase_bulk_merge_execute.sql
-- review notices, then either:
ROLLBACK;
-- or COMMIT;
```

Take a `pg_dump` snapshot before first production bulk merge on a large database.

## What these scripts do not do

- No UI
- No Billboard 200 import
- No schema changes
- No CSV cleanup
- No writes to `staging_music_imports`
- No track merges, track deletes, or track updates (Phase 2–3)
- No album merges or edition deletes (Phase 4–5)
- Phase 5 adds chart rows only via idempotent inserts (never rewrites existing chart history)
- Phase 3–5 preserve `chart_appearances` lineage on original rows
- No automatic promotion to canonical beyond FK reassignment (artist execute scripts only)
