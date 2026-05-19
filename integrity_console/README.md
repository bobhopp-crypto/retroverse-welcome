# Retroverse Integrity Console

SQL-first integrity operations for the local `retroverse` PostgreSQL database.

This is **not** a disposable importer script. It is the controlled merge layer for canonical graph hygiene: find duplicates, preview impact, execute with transactions, and audit results in DBeaver or `psql`.

## Prerequisites

- Database: `retroverse` on `localhost`
- User: `bobhopp`
- Populated tables: `artists`, `artist_aliases`, `albums`, `tracks`, `chart_appearances`

## File guide

| File | Purpose | Modifies data? |
|------|---------|----------------|
| `sql/001_artist_case_duplicate_candidates.sql` | List case/whitespace duplicate artist groups | No |
| `sql/002_artist_merge_dry_run.sql` | Preview one merge (single pair) | No |
| `sql/003_artist_merge_execute.sql` | Merge one duplicate into one canonical | **Yes** |
| `sql/004_artist_lowercase_bulk_merge_dry_run.sql` | Preview all safe bulk case merges | No |
| `sql/005_artist_lowercase_bulk_merge_execute.sql` | Execute safe bulk case merges | **Yes** |

## Run order

1. **Discover** — `001_artist_case_duplicate_candidates.sql`
2. **Preview one** — `002` with IDs from step 1
3. **Execute one** (optional) — `003` with same IDs
4. **Preview bulk** — `004_artist_lowercase_bulk_merge_dry_run.sql`
5. **Execute bulk** (optional) — `005` only after reviewing step 4

**Always run dry-run (`002` or `004`) immediately before execute (`003` or `005`).**

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
- No automatic promotion to canonical beyond FK reassignment
