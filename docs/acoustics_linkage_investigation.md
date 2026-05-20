# Acoustics / `acoustic_features` linkage investigation

**Date:** 2026-05-20  
**Phase:** discovery + linkage analysis (no graph mutations)

## Executive summary

| Question | Answer |
|----------|--------|
| Table named `acoustics`? | **No** — not found in any scanned SQLite DB |
| Actual table | **`acoustic_features`** in Billboard 200 album chart SQLite only |
| Row granularity | **Track-level** (Spotify track), grouped under album/artist text |
| Track ↔ album linkage | **Yes** — every row has `song`, `album`, `artist`, `album_id` (Spotify album id) |
| Artist linkage | **Yes** — `artist` text on every row |
| Duration | **Yes** — `duration_ms` (99.998% populated) |
| Acoustic metadata | **Yes** — full Spotify audio feature vector |
| External IDs | **Spotify track `id`** (22-char) + **Spotify `album_id`** — no MusicBrainz, no VDJ GUID |
| Viable for `tracks.album_id` / lineage / `canonical_track_album_links`? | **Yes, with staging + review** — high value for album tracklists; not a Hot 100 spine |

---

## 1. Databases searched

Scanned `*.db` / `*.sqlite` under:

- `/Users/bobhopp/Sites/retroverse/`
- `/Users/bobhopp/RETROVERSE_DATA/`
- `/Users/bobhopp/RETROVERSE_IMPORTS/`

**Postgres `retroverse`:** no `acoustics` or `acoustic_features` table.

### Databases containing `acoustic_features`

| Path | `acoustic_features` rows | `albums` (chart) rows | Notes |
|------|---------------------------:|----------------------:|-------|
| `/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db` | 339,855 | 573,947 | Primary Sites copy (~123 MB) |
| `/Users/bobhopp/RETROVERSE_DATA/databases/billboard-200-albums-charts.db` | 339,855 | 573,947 | RETROVERSE_DATA canonical copy |
| `/Users/bobhopp/RETROVERSE_DATA/databases/billboard-200-albums-charts_20260515T175746Z.db` | 339,855 | 573,947 | Timestamped backup; identical counts |

**Not present in:**

- `billboard-hot-100.db` (Hot 100 universe uses `work`, `chart_positions`, `vdj_asset`, etc.)
- `retroverse-master.db`
- Local Postgres graph (`artists`, `tracks`, `albums`, …)

**Naming note:** Docs and pipelines refer to this layer as “acoustics” or “Spotify acoustics”; the SQLite table name is **`acoustic_features`**.

---

## 2. Schema (`acoustic_features`)

```sql
CREATE TABLE acoustic_features (
  id                TEXT PRIMARY KEY,   -- Spotify track id (22 chars)
  song              TEXT,
  album             TEXT,
  artist            TEXT,
  acousticness      FLOAT,
  danceability      FLOAT,
  duration_ms       FLOAT,
  energy            FLOAT,
  instrumentalness  FLOAT,
  key               INT,
  liveness          FLOAT,
  loudness          FLOAT,
  mode              INT,
  speechiness       FLOAT,
  tempo             FLOAT,
  time_signature    INT,
  valence           FLOAT,
  album_id          TEXT,               -- Spotify album id
  date              TEXT                -- scrape / album context date
);
```

**Indexes:** none (PK on `id` only).

### Sample row (Eagles — *Hotel California*)

| song | album | artist | duration_ms | id (track) | album_id | date |
|------|-------|--------|------------:|------------|----------|------|
| Life in the Fast Lane - 2013 Remaster | Hotel California | Eagles | 286,220 | `6gXrEUzibufX9xYPk3HD5p` | `2widuo17g5CEC66IbzveRu` | 1976 |

---

## 3. Row granularity & field coverage

| Metric | Value |
|--------|------:|
| Total rows | 339,855 |
| Distinct `id` (Spotify track) | 339,855 |
| Distinct `song` titles | 245,777 |
| Distinct `artist` | 8,082 |
| Distinct `album` titles | 25,074 |
| Distinct `album_id` (Spotify) | 25,780 |
| Distinct `(artist, album)` text pairs | 25,780 |
| Distinct chart `(artist, album)` pairs | 36,336 |
| Duplicate `(artist, album, song)` triples | 687 |
| Songs with same artist on **multiple** albums | 11,198 |
| Empty `song` / `album` / `album_id` | 0% |
| Empty `artist` | 0.02% |
| `duration_ms` populated | 339,850 (100%) |
| `date` range | `1900` … `2019-04-07` |
| Numeric features null rate | 0% |

**Granularity:** **track / recording (Spotify)** — not album-level, not media-file-level.

**Typical album density:** up to ~50 tracks per `album_id` (full album tracklists + variants/remasters).

---

## 4. Linkage dimensions

| Dimension | Present? | Details |
|-----------|----------|---------|
| Artist name | ✅ | Text; 8,082 distinct |
| Track title | ✅ | `song`; often includes “Remaster”, feat. credits |
| Album title | ✅ | `album`; aligns with BB200 chart album names |
| Duration | ✅ | `duration_ms` → compare to `tracks.duration_seconds` (currently empty in PG) |
| Acoustic vector | ✅ | 12+ Spotify metrics, zero nulls |
| Spotify track ID | ✅ | `id` |
| Spotify album ID | ✅ | `album_id` — stable within Spotify catalog |
| MusicBrainz | ❌ | |
| VDJ GUID / file hash | ❌ | |
| FK to `albums.id` (chart surrogate) | ❌ | Join is **normalized text** only |

### Chart album coverage

All **339,855** acoustic rows match at least one Billboard 200 chart row on  
`lower(trim(artist)) + lower(trim(album))` — expected, since features were collected for charting albums.

Acoustic distinct album pairs (**25,780**) ⊆ chart album universe (**36,336** pairs).

---

## 5. Fit with local Postgres graph (2026-05-20)

| PG table | Relevant state |
|----------|----------------|
| `tracks` | 32,271 rows; **1** with `album_id`; **0** with `duration_seconds` |
| `albums` | 21,675 (Phase 6 registry) |
| `album_track_lineage` | 1 row |
| `canonical_track_album_links` | 2 rows |
| `artists` | 8,938 |

**Artist name overlap (exact lower(trim)):** **3,672** names in both acoustic set and `artists` (~45% of acoustic artists).

Acoustic is **album-tracklist-centric** (B200 albums). Postgres Hot 100 tracks are **single-centric** — linkage is via **artist + title** (+ duration when populated), then album context from acoustic.

---

## 6. Can it populate target tables?

| Target | Viability | Confidence | Notes |
|--------|-----------|------------|-------|
| `tracks.album_id` | **High** | 75–90 | Match PG `tracks` → acoustic on artist+title; set album from `album` text via `album_population_registry` / `albums` |
| `album_track_lineage` | **High** | 80–90 | One row per acoustic track on album; include `track_number` if derivable from row order / future MB |
| `canonical_track_album_links` | **High** | 80–95 | `track_family_id` + resolved `album_id` + optional edition; review when title variants or multi-album |
| Hot 100 → album (Phase 7) | **Medium** | 60–75 | Singles may not appear on B200 album tracklists; use only when acoustic row exists |
| `media_assets` / VDJ | **No** | — | No file paths or VDJ GUIDs |

**Do not:** auto-merge tracks, overwrite chart rows, or bulk-update without `review_flag`.

---

## 7. Recommended integration strategy

### Phase A — Staging (no canonical writes)

1. Add Postgres `staging_acoustic_features` (mirror SQLite columns).
2. Bulk load from `billboard-200-albums-charts.db`:

   ```bash
   sqlite3 -header -csv /Users/bobhopp/RETROVERSE_DATA/databases/billboard-200-albums-charts.db \
     "SELECT * FROM acoustic_features;" > /tmp/acoustic_features.csv
   psql -U bobhopp -d retroverse -c "\copy staging_acoustic_features FROM '/tmp/acoustic_features.csv' CSV HEADER"
   ```

3. Run **`801_acoustic_features_track_album_candidates.sql`** (read-only) — review counts and flags.

### Phase B — Controlled population (future execute script)

1. Match keys (in order):
   - `artists.canonical_name` ↔ `artist`
   - `tracks.title` ↔ `song` (normalized; handle remaster suffixes)
   - `albums` / registry ↔ `album`
   - `duration_ms` ↔ `tracks.duration_seconds` as tie-breaker
2. Store Spotify ids on a **`track_source_ids`** or enrichment table (do not replace `tracks.id`).
3. Insert `canonical_track_album_links` with `source = 'acoustic_features'`; `review_flag = ok` only when artist+album+title strong match and single album candidate.
4. Backfill `tracks.album_id` only for rows with `ok` and one album resolution.

### Phase C — Acoustic metadata

- Keep features in enrichment table keyed by `source_fingerprint` (see `scripts/lib/acoustic-enrichment.ts`).
- Do not fold features into canonical identity tables.

---

## 8. Risks & review triggers

- **Title variants:** “- 2013 Remaster”, “feat. …” vs Hot 100 clean titles → `review_required`
- **Multi-album songs:** 11,198 artist+song pairs map to >1 album
- **Compilation / soundtrack albums:** verify Phase 6 album keys
- **Spotify IDs ≠ Retroverse IDs:** always bridge via matches, never replace PKs
- **Stale scrape date:** album `date` up to 2019 only

---

## 9. Artifacts

| Artifact | Purpose |
|----------|---------|
| `docs/acoustics_linkage_investigation.md` | This report |
| `integrity_console/sql/801_acoustic_features_track_album_candidates.sql` | PG candidate preview (requires staging) |
| `scripts/audit_acoustic_source_db.ts` | Repeatable SQLite audit → `RETROVERSE_DATA/logs/acoustic_import/` |
| `docs/billboard_200_source_sqlite_forensics.md` | Prior B200 schema forensics |

---

## 10. Verdict

**`acoustic_features` is viable and high-value** for album tracklist ↔ track family ↔ canonical album linkage.  
It is **not** a substitute for Hot 100 chart spine or VDJ media linkage.

Proceed with **staging + 801 review**, then a future **802_populate_…_execute.sql** after human spot-check.
