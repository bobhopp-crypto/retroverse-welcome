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
- Phase 3 does not rewrite `chart_appearances` lineage
- No automatic promotion to canonical beyond FK reassignment (artist execute scripts only)
