# Original release recovery audit

**Generated:** 2026-05-20  
**Scope:** MusicBrainz, album track ordering, canonical sequencing, acoustics, staging, dossier pipeline  
**Method:** Live queries on local PostgreSQL (`retroverse`), SQLite (`billboard-200-albums-charts.db`), shipped JSON, and file inspection. No speculative counts.

---

## Executive summary

Retroverse **does not** have MusicBrainz release tracklists loaded into production databases or dossiers today. What **does** exist:

1. A **36k-entry MusicBrainz album match cache** (`source_musicbrainz_album_cache.json`) with pipe-delimited `top_tracks` in release order for **29,413** matched albums — including correct **1982 Thriller** sequencing.
2. **Billboard/Spotify acoustic SQLite** with original LP cuts often present **before** variant rows, but the dossier materializer **re-sorts** deduped titles by ingest date + alphabet — destroying LP order.
3. **Five** manually curated canonical sequences shipped to the web app.
4. **Postgres staging tables** for MB tracklists — **schema only, zero rows** on local PG.
5. Album pages read **dossier `acoustic.tracks`** and apply **signal curation**, not MB positions or graph edition order.

**Verdict:** Original-release sequencing was **partially discovered** (MB cache + raw acoustics) but **never wired** into the dossier display path. Recovery can start from **existing files** without a new MusicBrainz scrape for a large subset of shipped dossiers.

---

## Section 1 — What exists

### PostgreSQL (local `retroverse`, live 2026-05-20)

| Artifact | Role | Row count / status |
|----------|------|-------------------|
| `staging_album_tracklist_imports` | MB / manual tracklist rows (`disc_number`, `track_number`, `mb_recording_mbid`, `mb_release_mbid`) | **0** |
| `staging_musicbrainz_release_mappings` | Release → canonical album mapping | **0** |
| `staging_billboard_200_weekly` | B200 weekly staging | **573,666** |
| `staging_acoustic_tracks` | Acoustic bridge staging | **339,804** |
| `album_track_lineage` | Album ↔ track_family sequence | **203,422** rows, **15,327** albums |
| `album_track_lineage` by `source_provenance` | | `acoustics` **203,421**; `canonical_tracks_bootstrap` **1** |
| `acoustic_track_album_candidates` | Acoustic linkage candidates | **203,421** (**8,104** `review_flag = ok`) |
| `canonical_track_album_links` | Canonical album ↔ track links | **8,061** (`acoustics` **8,059**) |
| `albums` / `album_editions` | Canonical album graph | **21,675** each |
| `chart_appearances` (Billboard 200) | Chart spine | **446,330** rows, **21,669** albums |

**SQL (staging / lineage):**

```sql
SELECT count(*) FROM staging_album_tracklist_imports;
SELECT count(*) FROM staging_musicbrainz_release_mappings;
SELECT source_provenance, count(*) FROM album_track_lineage GROUP BY source_provenance;
```

**Schema / population scripts (welcome app):**

| File | Purpose |
|------|---------|
| `integrity_console/sql/501_billboard_200_staging_schema.sql` | Creates `staging_album_tracklist_imports`, `staging_musicbrainz_release_mappings`, `album_track_lineage` |
| `integrity_console/sql/503_musicbrainz_tracklist_linkage.sql` | Read-only MB ↔ graph linkage analysis |
| `integrity_console/sql/504_album_track_graph_population.sql` | Lineage from MB staging (`ORDER BY disc_number, track_number`) |
| `integrity_console/sql/505_billboard_200_readiness_report.sql` | Reports MB staging + lineage coverage |
| `integrity_console/sql/702_album_tracklist_linkage_candidates.sql` | Candidates from lineage, `tracks.album_id`, **and** MB staging |
| `integrity_console/sql/703_populate_canonical_track_album_links.sql` | Links including MB staging path |
| `integrity_console/sql/805_populate_album_track_lineage_from_acoustics.sql` | Lineage from acoustics (`sequence_index` = row order in candidates, **not** LP order) |

### Supabase (production graph)

| Table / concept | Role | Coverage (inventory snapshot **2026-05-09**; live API **503** on 2026-05-20) |
|-----------------|------|------|
| `retroverse_albums` | Canonical album identity | **41,352** |
| `retroverse_album_editions` | Editions (primary flag) | ~1 per album |
| `retroverse_album_tracks` | Ordered edition tracklist (`disc_number`, `track_number`, `side_position`) | **5,115** albums with ≥1 row |
| `retroverse_tracks.retroverse_album_id` | Direct album membership fallback | **4,558** albums |
| `retroverse_source_matches` | External ID bridge | **36,334** B200 album matches; pilot **artist-only** MB seeds in `supabase/seed.sql` |
| `retroverse_track_enrichment` | Spotify/Billboard acoustics | Features only, **not** sequence authority |

Migrations: `supabase/migrations/20260506202000_expand_album_graph.sql` (ordered tracklists).

### SQLite / RETROVERSE_DATA archives

| Path | Role |
|------|------|
| `RETROVERSE_DATA/databases/billboard-200-albums-charts.db` | `albums` (B200 weekly), `acoustic_features` (song/album/artist, Spotify ids, features) |
| `RETROVERSE_DATA/runtime/retroscope-coordinates.json` | RVAL spine for dossier materialization |
| `RETROVERSE_DATA/runtime/album-dossiers.json` | Source bundle (copied to app via publish script) |
| `RETROVERSE_DATA/runtime/dossier-musicbrainz-by-rval.json` | **Optional MB sidecar for materialize — file does not exist** |
| `RETROVERSE_DATA/runtime/dossier-retroverse-scores-by-rval.json` | Optional scores sidecar |

### External / legacy JSON (outside welcome app repo)

| Path | Role | Inspected size |
|------|------|----------------|
| `/Users/bobhopp/Sites/retroverse/data/derived/albums/source_musicbrainz_album_cache.json` | MB album match + `top_tracks` pipe string + `mbid` | **36,322** keys; **29,413** `match_status=matched`; **29,157** with `track_count >= 6` |
| `/Users/bobhopp/RETROVERSE_DATA/logs/tracklist-backfill/*.json` | Wave1 CSV backfill runs | Small pilot (e.g. 3 albums applied) |

**No repo script** references `source_musicbrainz_album_cache.json` or builds `dossier-musicbrainz-by-rval.json` (grep across workspace).

### Shipped web bundle (`public/data/albums/`)

| File | Role | Count |
|------|------|------:|
| `album-dossiers.json` | Page source: chart + `acoustic.tracks[]` | **8,680** dossiers |
| `canonical-album-sequences.json` | Manual original LP sequences | **5** albums |

### Scripts / pipelines

| Script | Role |
|--------|------|
| `RETROVERSE_DATA/scripts/materialize_album_dossiers.py` | Builds dossiers from SQLite + coords; optional `attach_musicbrainz()` from sidecar; **dedupes/sorts acoustic titles** |
| `scripts/publish-album-dossiers.mjs` | Copies runtime bundle → `public/data/albums/` |
| `package.json` → `dossiers:materialize` | Invokes materialize Python |
| `scripts/backfill_wave1_tracklists.ts` | CSV → Supabase `retroverse_album_tracks` (pilot scale) |
| `scripts/audit_album_coverage.ts` | Coverage metrics (companion doc) |
| `lib/album-dossier-display-tracks.ts` | **Display order**: canonical sequence → else `curateTrackSignals` primary stems |
| `lib/canonical-album-sequences.ts` | Loads manual sequences |
| `lib/signal-curation.ts` | Variant demotion (`live`, `remaster`, `demo`, `mix`, etc.) |

### Documentation (related)

| Doc | Notes |
|-----|-------|
| `docs/retroverse_album_coverage_audit.md` | Counts, Thriller pollution, dossier readiness |
| `docs/retroverse_track_graph_plan.md` | MB via sidecar + `retroverse_source_matches`; no MB tables in SQLite |
| `docs/acoustics_linkage_investigation.md` | Acoustics viable for linkage, not Hot 100 spine |
| `integrity_console/README.md` | Phase 5: load MB staging → 503/504 |

---

## Section 2 — Track order confidence

| Source | Preserves original LP / primary-edition order? | Confidence | Evidence |
|--------|-----------------------------------------------|------------|----------|
| `canonical-album-sequences.json` | **Yes** — explicit `global_position` / side labels | **HIGH** | 5 manual albums; used first in `buildDossierTrackRows` |
| `source_musicbrainz_album_cache.json` → `top_tracks` | **Yes** for matched primary releases (pipe order) | **HIGH** (title-level); **MEDIUM** (edition mismatch risk) | Thriller: 9 tracks in correct 1982 order; **76.9%** of shipped dossiers match cache by normalized artist+album |
| `dossier-musicbrainz-by-rval.json` (planned sidecar) | **Would** attach `position` per track if populated | **HIGH** if built from MB API or cache | Schema in `materialize_album_dossiers.py`; **file missing** |
| `staging_album_tracklist_imports` → `504` lineage | **Yes** when loaded (`disc_number`, `track_number`) | **HIGH** (when populated) | **0 rows** today |
| `retroverse_album_tracks` (Supabase primary edition) | **Yes** when rows exist | **HIGH** (when populated) | Only **5,115 / 41,352** albums (stale inventory) |
| `billboard-200-albums-charts.db` `acoustic_features` (raw `rowid`) | **Often** original cuts appear before variants | **MEDIUM** | Thriller: first 9 SQLite rows = LP order |
| `materialize_album_dossiers.py` deduped `acoustic.tracks` | **No** — sorted by `min(feature_ingest_dates)` then title | **LOW** for sequencing | Thriller dossier starts with "Baby Be Mine" (alphabetical), not side A opener |
| `album_track_lineage` (`acoustics`) | **No** — `sequence_index` from acoustic candidate row order | **LOW** | Thriller `album_id=39831`: indices 1–15, sparse `track_family` names |
| Dossier display (`curateTrackSignals`) | **No** — stem dedupe + variant tiers | **LOW** for historical order | Picks "Beat It - Single Version" over LP "Beat It" when no canonical sequence |
| `musicbrainz.position` on dossier tracks | **Would** work if present | **N/A today** | **0 / 30** Thriller acoustic rows carry `musicbrainz` |

---

## Section 3 — MusicBrainz recovery status

### What was done

| Work | Status |
|------|--------|
| Album-level MB matching cache | **Done** — `source_musicbrainz_album_cache.json` (29,413 matched albums, `mbid`, `top_tracks`, `track_count`) |
| Postgres MB staging tables | **Schema only** — **0** rows in `staging_album_tracklist_imports` and `staging_musicbrainz_release_mappings` |
| Lineage from MB staging (`504`) | **Not run** (no staging data) |
| Dossier MB sidecar (`dossier-musicbrainz-by-rval.json`) | **Never created** — materialize logs optional path but file absent |
| MB positions on shipped dossiers | **Not present** on spot-checked albums (Thriller: 0 tracks) |
| Supabase `retroverse_source_matches` for MB | **Pilot artist rows only** in seed — not release/recording tracklists |
| Release-group / recording-level graph | **Not ingested** into welcome app or local PG |

### What was partial

- **Acoustic / Spotify feature export** — rich title-level features, **polluted** with remasters, demos, anniversary editions (**1,862** shipped dossiers with variant keywords per coverage audit).
- **Integrity console** — analysis SQL and population paths **documented**, MB load step **not executed** on this database.

### Conclusion

MusicBrainz work stopped at **album-level match + top-track string cache**. Full **release tracklists with positions** were **not** imported into staging, lineage, Supabase edition tables, or dossiers.

---

## Section 4 — Thriller test (`RVAL586982`)

**Identity:** Michael Jackson — *Thriller* (`retroscope-coordinates.json` confirms `RVAL586982`).

### Do we already possess the correct original sequence?

| Store | Correct 1982 LP order? | Where |
|-------|------------------------|-------|
| `source_musicbrainz_album_cache.json` | **Yes** (9 tracks) | `norm_key(Michael Jackson, Thriller)` → `top_tracks`: Wanna Be Startin' Somethin' → … → The Lady in My Life |
| SQLite `acoustic_features` (by `rowid`) | **First 9 rows yes**, then 25th-anniversary pollution | See query below |
| Shipped `album-dossiers.json` | **No** | 30 acoustic rows; variants and demos mixed |
| `canonical-album-sequences.json` | **No entry** | Only 5 other albums |
| Local `album_track_lineage` | **No** | 30 `acoustics` rows; order follows acoustic ingest, not LP |
| MB staging / sidecar | **No** | 0 staging rows; no sidecar file |

```sql
-- SQLite (first rows = LP-side order before later variants)
SELECT song FROM acoustic_features
 WHERE artist LIKE '%Michael Jackson%' AND album = 'Thriller'
 ORDER BY rowid LIMIT 9;
```

```text
Wanna Be Startin' Somethin'
Baby Be Mine
The Girl Is Mine (with Paul McCartney)
Thriller
Beat It - Single Version
Billie Jean
Human Nature
P.Y.T. (Pretty Young Thing)
The Lady in My Life
```

### Why it does not surface on the album page

1. **No** `canonical-album-sequences` entry for `RVAL586982`.
2. **`dossier-musicbrainz-by-rval.json` missing** — materialize never attaches `musicbrainz.position`.
3. **Materialize sort** — after title dedupe, tracks sort by earliest feature date + **alphabetical title** → page order diverges from LP (starts "Baby Be Mine").
4. **Display layer** — `buildDossierTrackRows` uses `curateTrackSignals` **primary** stems from polluted acoustic list; variant penalty does not remove "Single Version" / "25th Anniversary" patterns as aggressively as manual sequence would.

### What layer overrides with variants?

| Layer | Behavior |
|-------|----------|
| SQLite acoustic ingest | Multiple Spotify album editions in one `album` bucket |
| `materialize_album_dossiers.py` | Merges all variants; **does not filter** to primary edition; **reorders** |
| Shipped dossier JSON | Stores full polluted list |
| `lib/album-dossier-display-tracks.ts` | Stem dedupe + signal tiers — **not** MB/cache order |

---

## Section 5 — Best source of truth (recommendation)

**Ranked for historically trustworthy *original major listening edition* sequencing:**

| Rank | Source | Rationale |
|------|--------|-----------|
| **1** | `source_musicbrainz_album_cache.json` (matched, `top_tracks`) | Already on disk; **6,672 / 8,680** shipped dossiers match by normalized artist+album; Thriller-proven order; no scrape required for first pass |
| **2** | Build `dossier-musicbrainz-by-rval.json` from cache + RVAL map | Materialize already supports `attach_musicbrainz()` + `musicbrainz.position`; minimal pipeline change |
| **3** | Expand `canonical-album-sequences.json` from rank-1/2 | Display layer already prefers this file — clearest contract for "original LP" |
| **4** | Load `staging_album_tracklist_imports` + run `504` | Correct long-term graph home; requires ETL from cache or MB API |
| **5** | Filtered SQLite acoustic (primary-edition row filter) | Viable fallback where MB cache misses; requires edition-detection rules |
| **6** | `album_track_lineage` (current `acoustics`) | **Not** authoritative for order until repopulated from MB staging |
| **7** | Supabase `retroverse_album_tracks` | Authoritative when filled — today sparse vs dossier surface |

**Not recommended as sequence authority:** raw dossier `acoustic.tracks` order, signal-curation stem order, or acoustic lineage `sequence_index` as populated today.

---

## Section 6 — Recovery feasibility (without major new scraping)

| Cohort | Count | Notes |
|--------|------:|-------|
| Shipped dossiers | **8,680** | Current album page surface |
| MB cache match (normalized artist+album) | **6,672** (**76.9%**) | `top_tracks` pipe order |
| MB cache match with ≥6 tracks | **6,633** | Enough for full-album UI |
| Manual canonical sequences today | **5** | Proof pattern (Rumours, Abbey Road, etc.) |
| Dossiers passing clean-acoustic rule (no manual sequence) | **4,302** | Stem curation only; order still wrong |
| Local PG albums with ≥6 acoustic lineage rows | **14,722** | Order not LP-trustworthy |
| Local PG "clean" titles (≥6, no variant keywords in `tracks.title`) | **317** | Title quality only |
| Supabase albums with edition track rows | **5,115** | Graph order viable when present; not wired to dossier pages |

**Estimate:** For **~6,600–6,700** shipped dossiers (**~77%**), recover **usable original sequencing** from **existing** `source_musicbrainz_album_cache.json` by mapping to RVAL and emitting either canonical sequences or the MB dossier sidecar — **no MusicBrainz API scrape** required for that cohort.

**Caveats (honest):**

- `top_tracks` may be **partial** (Thriller = 9, not 12 with bonus cuts) — still correct for **primary LP listening order**.
- Cache edition may differ from Billboard anchor (compilation vs studio LP) — needs `mapping_status` / year review for edge cases (~23% dossiers without normalized cache hit).
- Remaining **~2,000** dossiers need acoustic filtering, manual curation, or **new** MB release-level fetch.

---

## Section 7 — Next action (data recovery path)

**Do not** start UI or architecture redesign.

### Next exact step

**Build `RETROVERSE_DATA/runtime/dossier-musicbrainz-by-rval.json` from existing MB cache + `retroscope-coordinates.json`**, then regenerate dossiers:

1. **Script** (new, under `RETROVERSE_DATA/scripts/`): For each RVAL in coordinates, `norm_key(artist, album)` → lookup cache → emit:
   ```json
   "RVAL586982": {
     "release_mbid": "<mbid>",
     "tracks": [
       { "title": "Wanna Be Startin' Somethin'", "position": 1 },
       ...
     ]
   }
   ```
   Split `top_tracks` on `|`; preserve order; use cache `matched_album` titles.

2. **Run:** `npm run dossiers:materialize` (attaches `musicbrainz.position` per `attach_musicbrainz()`).

3. **Run:** `node scripts/publish-album-dossiers.mjs`.

4. **Verify Thriller:** Dossier tracks should carry `musicbrainz.position` 1–9; extend `buildDossierTrackRows` to **sort by `musicbrainz.position`** when no canonical sequence (small display-layer follow-up if positions alone are insufficient).

5. **Parallel (graph):** Bulk `COPY` into `staging_album_tracklist_imports` (`source_name = 'musicbrainz_cache'`) from the same cache → `504_album_track_graph_population.sql` for lineage with real `track_number` / `sequence_index`.

**Checkpoint:** Thriller page shows nine primary cuts in MB order (Wanna Be Startin' Somethin' first), with variants demoted or absent from primary list.

---

## Appendix — Key queries & commands

```sql
-- Local PG MB staging (empty today)
SELECT count(*) FROM staging_album_tracklist_imports;
SELECT count(*) FROM staging_musicbrainz_release_mappings;
SELECT source_provenance, count(*) FROM album_track_lineage GROUP BY source_provenance;
```

```bash
# MB cache stats
node -e "const j=require('/Users/bobhopp/Sites/retroverse/data/derived/albums/source_musicbrainz_album_cache.json');const v=Object.values(j);console.log({keys:Object.keys(j).length,matched:v.filter(x=>x.match_status==='matched').length});"

# Thriller dossier MB fields
node -e "const d=require('./public/data/albums/album-dossiers.json').dossiers.RVAL586982;console.log(d.acoustic.tracks.length,d.acoustic.tracks.filter(t=>t.musicbrainz).length);"
```

**Related audit:** `docs/retroverse_album_coverage_audit.md` (coverage counts, dossier readiness rule, Thriller pollution samples).
