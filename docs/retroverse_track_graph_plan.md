# Retroverse canonical track graph — architecture & reconciliation plan

**Status:** Planning only (no UI, RetroScope, dossier, or playback changes in this document).  
**Date:** 2026-05-15  
**Goal:** Unify all track-shaped sources under one canonical identity: **`RVTR######`**, with explicit matching, provenance, and migration steps.

Related references: `docs/retroverse_schema_overview.md`, `docs/retroverse_system_map.md`, Supabase migrations under `supabase/migrations/`.

---

## 1. Current state (audit)

### 1.1 Where `RVTR` already exists

| Layer | Role | Location |
|--------|------|-----------|
| **Primary canonical row** | One row per logical track (`canonical_title`, `retroverse_artist_id`, optional `retroverse_album_id`, era/year inheritance) | `public.retroverse_tracks` — ID pattern `^RVTR[0-9]{6}$` (`20260506195500_retroverse_canonical_graph.sql`) |
| **Album placement** | Edition-scoped sequencing (disc/track/side); *not* duplicate identities | `public.retroverse_album_tracks` → `RVAT######` |
| **Charts (Retroverse)** | Timeline per canonical track (+ optional album chart rows) | `public.retroverse_chart_appearances` → `RVCH######` (`retroverse_track_id` and/or `retroverse_album_id`) |
| **Acoustic enrichment (attached)** | Optional link from SQLite-derived features to `RVTR` | `public.retroverse_track_enrichment` (`retroverse_track_id` nullable; `source_fingerprint` unique) (`20260508120000_retroverse_track_enrichment.sql`) |
| **External ↔ canonical map** | Polymorphic bridge | `public.retroverse_source_matches` — `retroverse_entity_type = 'track'`, `retroverse_entity_id` = `RVTR` |
| **Playback / display assets** | Files + `media_source` (YouTube ids can live here as conventions) | `public.retroverse_media_assets` → `RVMA######` (`20260506220500_retroverse_media_assets.sql`) |
| **Lineage / pathways** | Graph edges derived from memberships, reuse, charts, eras | `lib/retroverse-pathways.ts`, `lib/retroverse-lineage.ts` (consume **RVTR**) |
| **ID allocation pattern** | Deterministic hashing + collision walk | `scripts/backfill_wave1_tracklists.ts` — `allocateId("RVTR", \`track::${canonicalKey}\`, …)` |

**Conclusion:** The *schema* for a canonical track graph exists in Postgres. The gap is **consistent reconciliation**: many silos still key on **_strings_** (Billboard titles, Spotify row ids, CSV tracklists, Hot 100 `work`/chart rows) without a guaranteed **`retroverse_track_id`** edge.

---

### 1.2 SQLite / local archives (no native `RVTR`)

| Source | Path / artifact | Track-like keys | Notes |
|--------|-------------------|-----------------|--------|
| **Billboard 200 + Spotify acoustics** | `RETROVERSE_DATA/databases/billboard-200-albums-charts.db` → `acoustic_features` | `song`, `album`, `artist`, `id` (Spotify track id), `album_id` (Spotify album id), `date` | Joined in dossier materializer by **normalized `artist`+`album`**; per-title dedupe. **No `RVTR`.** |
| **Billboard 200 weekly album chart** | Same DB → `albums` | `artist`, `album`, `date`, `rank` | Album spine, not per-track identity. |
| **Hot 100 graph** | `RETROVERSE_DATA/databases/billboard-hot-100.db` | `chart_positions`: `mbid`, `title`, `artist`, `issue_date`, `rank`; `work` / `event_entry` graph | **MusicBrainz id on chart row** when present; separate **`work_id`** space. **No `RVTR`.** |
| **VDJ bridge (schema)** | Same Hot 100 DB | `vdj_asset`, `work_asset_link` (often **empty** in inventory) | Intended local file bridge; not yet a unified track identity. |
| **Album dossier bundle** | `RETROVERSE_DATA/runtime/album-dossiers.json` (published to `public/data/albums/`) | Embeds acoustic track rows + optional MusicBrainz **sidecar** | **View layer** for `RVAL######`; does not author canonical `RVTR`. |

---

### 1.3 How matching works today (by silo)

| Silo | Match strategy | Weakness / duplication risk |
|------|----------------|-----------------------------|
| **Wave1 tracklist backfill** | `trackKey = normalize(title) + "::" + retroverse_artist_id` → hash → `RVTR` | Same recording under **different** `RVAR` splits → **duplicate RVTR**. Reissues with identical title/artist on **another RVAL** may **reuse** one RVTR (good) or miss if artist normalization differs. |
| **Acoustic SQLite → Supabase** | `source_fingerprint` from song/album/artist/album_id + metrics (`scripts/lib/acoustic-enrichment.ts` pattern) | Rows can exist **before** `retroverse_track_id` is set; multiple RVTR could match one fingerprint if governance is loose. |
| **Dossier generator** (`materialize_album_dossiers.py`) | `norm_key(artist, album)` on `acoustic_features`; optional MB title match via sidecar | **No track-level link** to `RVTR`; titles are display strings only. |
| **Hot 100 local DB** | Graph keys: `work_id`, `person`, `mbid` on `chart_positions` | Parallel universe to Retroverse until **`retroverse_source_matches`** or graph import maps `work_id`/`mbid` → `RVTR`. |
| **`retroverse_chart_appearances`** | Editorial / ingestion pipelines | Orphan chart rows possible; validation suite checks FK integrity (`supabase/validation/retroverse_validation_suite.sql`). |
| **`retroverse_source_matches`** | Manual / script inserts: `(source, source_key)` → entity | Coverage gaps → **lost joins** everywhere downstream. |

---

### 1.4 Partial canonicalization already in schema

- **Single track row, many contexts:** `retroverse_album_tracks` encodes reuse without cloning `retroverse_tracks` (see `docs/retroverse_schema_overview.md`).
- **Album anchor optional:** `retroverse_tracks.retroverse_album_id` nullable — supports singles / orphan tracks **if** ingestion allows it (trigger inherits year/era from album when set).
- **Chart rows can be album-only:** `retroverse_chart_appearances` supports album-level charting without a track (`20260510140000_chart_appearances_album_optional_track.sql`).
- **Enrichment separated from identity:** `retroverse_track_enrichment` is explicitly non-canonical for chart history (comment in migration).

---

### 1.5 “Retroverse scores”

- Not a single table: pathway scores are **derived** (`lib/retroverse-pathways.ts`); dossier-local scores are **optional JSON sidecars** in the album dossier pipeline.
- Recommendation: treat **scores as derived views** keyed by `RVTR` (or chart edge ids), not as source-of-truth identity.

---

### 1.6 MusicBrainz

- **Local canonical DB:** no MusicBrainz tables in surveyed SQLite DBs beyond **Hot 100 `mbid`** on chart rows (plus optional dossier MB sidecars).
- **Supabase:** use **`retroverse_source_matches`** with a fixed `source` vocabulary (e.g. `musicbrainz_recording`) and `retroverse_entity_type = 'track'`.
- **Dossier sidecar:** optional `dossier-musicbrainz-by-rval.json` — **album-scoped**, title-matched strings; does not assign `RVTR` today.

---

### 1.7 YouTube / playback

- **`retroverse_media_assets`:** `media_source` + `local_path` + optional dimensions; **no hard-coded YouTube enum** — YouTube/video URLs or ids are operational conventions **`RVTR`-scoped**.
- **This plan:** defer playback UX; require only that **every playback asset row resolves to exactly one `RVTR`** (or is quarantined as unmatched).

---

## 2. Canonical track model (target)

### 2.1 Logical object: authoritative identity

Minimal fields backing **`RVTR`** (already mirrored in DB):

| Field | Description |
|--------|-------------|
| `retroverse_track_id` | `RVTR######` (immutable) |
| `canonical_title` | Human display + primary match key |
| `retroverse_artist_id` | `RVAR######` primary credit |
| `retroverse_album_id` | Optional default album anchor (`RVAL######`) |
| `release_year`, `era_id` | Inherited or explicit |
| `provenance_level` | Trust tier (`20260507100500_retroverse_provenance_layer.sql`) |

**Normalized matching fields** (derive now; optional DB columns later for index speed):

- `title_norm` — contract shared with ingestion (same family as Wave1 `normalize()` + dossier/billboard `norm_key`-style stripping where appropriate — **pick one canonical function per pipeline stage**).

### 2.2 Graph edges (not flattened into `retroverse_tracks`)

| Concern | Table / artifact |
|---------|-------------------|
| **Album appearances** | `retroverse_album_tracks` (+ edition → album) |
| **Chart history** | `retroverse_chart_appearances` |
| **Acoustic vectors** | `retroverse_track_enrichment` (version or “primary enrichment” rule if multiple snapshots) |
| **MusicBrainz / Spotify / import ids** | `retroverse_source_matches` |
| **VDJ assets** | future: FK from local asset → `RVTR` via **`retroverse_media_assets`** or dedicated library link table (**TBD**) |
| **Pathways** | Derived from RVTR graph (`lib/retroverse-pathways.ts`) |

### 2.3 Invariants

1. **`RVTR` is the only track primary key** for product features keyed on “Retroverse track.”
2. **No production join** should depend solely on raw `(artist string, title string)` without reconciliation output or `source_matches`.
3. **Govern `source_matches` uniqueness:** `(source, source_key)` → at most one **`RVTR`** for automated promotion (manual override flag excepted).

---

## 3. Matching & reconciliation strategy

### 3.1 Tiered resolution (ordered)

1. **Hard keys (highest confidence)**  
   - Incoming row already carries `RVTR`.  
   - **`retroverse_source_matches`** hit for `source_key` (Spotify track id, MB recording id, stable import row id).

2. **Deterministic string keys**  
   - `normalize(title) + retroverse_artist_id` (current Wave1 pattern).  
   - **Candidate generation** may also use `normalize(title) + normalize(artist)` when **`RVAR` mapping** is ambiguous (never promote without scoring).

3. **Contextual disambiguation**  
   - Same title + primary artist on **same album edition slot** → same `RVTR` unless MBID/duration contradicts alternate recording policy.  
   - **Edition position** (disc/track) as tie-break when titles vary (typos).

4. **Fuzzy / numeric hints**  
   - Token similarity on titles; duration tolerance when both sides have length.  
   - Acoustic vectors **only secondary** — different masters collide and diverge unpredictably.

5. **Manual / ops queue**  
   - Conflicts surfaced via integrity scripts or review surfaces — **never silent merge at max confidence.**

### 3.2 Source-specific linkage

| Source | Proposed RVTR linkage |
|--------|----------------------|
| **Album tracklists (CSV / Wave1)** | Keep `allocateId / trackKey`; add **`source_matches`** for stable CSV keys (`albumSourceKey:disc:track`) → `RVTR`. |
| **`acoustic_features` (SQLite)** | Primary: **`id` (Spotify track)** → `source_matches` → `RVTR`; fallback: keyed candidate search within **album-linked** Billboard / RVAL context. |
| **Hot 100** | Prefer **`chart_positions.mbid`** → MB recording → `RVTR`; else clustering on `title_display`/`title_norm` + `person` graph with review. |
| **MusicBrainz bulk files** | Import as **`source_matches` first**, then mint or attach `RVTR` per recording cluster. |
| **VirtualDJ exports** | Map tag triple (artist/title/remix filepath) → proposal row → `RVTR`; store file reference in **`retroverse_media_assets`**. |

### 3.3 Duplicate RVTR detection (pre-merge)

- Same artist + overly similar title + overlapping external keys → suspicion set.  
- Conflicting **`source_matches`** targeting different `RVTR` for identical `source_key`.  
- Multiple MBIDs flagged “same RVTR” without merge metadata.

Deliverable before merges: **read-only conflict report**, not automated destructive merge in phase 1.

---

## 4. Migration & generation pipeline (recommended)

### 4.1 Phased rollout

| Phase | Action | Exit criteria |
|-------|--------|----------------|
| **A — Inventory** | Distinct counts of external keys per silo (SQLite + Supabase export) | Single dashboard-style markdown or CSV artifact |
| **B — Expand `retroverse_source_matches`** | Bulk insert high-confidence deterministic matches | Unique violations = explicit conflict backlog |
| **C — Attach `retroverse_track_enrichment`** | Backfill nullable `retroverse_track_id` | High coverage on fingerprints |
| **D — Charts** | Map Hot 100 / imports → **`retroverse_chart_appearances`** with `retroverse_track_id` | Falling orphan FK rate |
| **E — Consumers** | Dossiers / scripts may **surface** resolved `RVTR` read-only alongside strings | Audit sample: random RVTR resolves back to SQLite row |
| **F — Derived** | Pathway regen keyed on RVTR-only graph | Reproducible nightly |

### 4.2 Suggested offline job layout (`RETROVERSE_DATA` + repo scripts)

1. **`inventory_track_sources`** — summarize tables: `acoustic_features`, Hot 100 `chart_positions` / `work`, VDJ stubs, Supabase-exported `retroverse_tracks` + `retroverse_source_matches`.  
2. **`propose_track_reconciliation`** — emit proposal file: `{ source, source_key, proposed_rvtr, confidence, rationale }`.  
3. **`apply_track_reconciliation`** (TS against Supabase) — upsert **`retroverse_source_matches`** + enrichment patches; **`--dry-run`** default.

### 4.3 ID policy

- **Authoritative RVTR minting** only via blessed writers (`allocateId` contract in `scripts/backfill_wave1_tracklists.ts` or equivalent server path).  
- **SQLite-local “staging ids”** are forbidden as production `RVTR` unless explicitly promoted through Supabase insert.

---

## 5. Out of scope (explicit)

- Playback UI or embed logic.  
- RetroScope grid / coordinate runtime.  
- Dossier visual design; dossiers may eventually **expose** RVTR ids as copy-only fields once data exists.  
- Replacing Spotify/VirtualDJ tagging truth — **`RVTR` is Retroverse interchange**, not replacing DJ crates.

---

## 6. Success criteria (checkpoint)

1. Given any **SQLite acoustic row**, you can traverse **`source_matches` → RVTR → album placements / charts / media** with defined confidence.  
2. Hot 100 **mbid-bearing** positions have a deterministic path to **`RVTR`** or land in **`unmatched`** with reason codes.  
3. Pathway / lineage code needs **zero** alternate string-ID paths for tracks in new codepaths.

---

## 7. Appendix — key file pointers

| Topic | Path |
|--------|------|
| Core graph DDL | `supabase/migrations/20260506195500_retroverse_canonical_graph.sql` |
| Album tracks DDL | `supabase/migrations/20260506202000_expand_album_graph.sql` |
| Track enrichment DDL | `supabase/migrations/20260508120000_retroverse_track_enrichment.sql` |
| Media assets DDL | `supabase/migrations/20260506220500_retroverse_media_assets.sql` |
| Chart optional album DDL | `supabase/migrations/20260510140000_chart_appearances_album_optional_track.sql` |
| Validation SQL | `supabase/validation/retroverse_validation_suite.sql` |
| RVTR allocate / `trackKey` | `scripts/backfill_wave1_tracklists.ts` |
| Acoustic fingerprint pattern | `scripts/lib/acoustic-enrichment.ts` |
| Pathways consumer | `lib/retroverse-pathways.ts` |
| Track route pattern | `lib/retroverse-routes.ts` (`RVTR\d{6}`) |

---

*Next step after stakeholder sign-off: Phase A inventory script + proposal CSV schema (`propose_track_reconciliation`), still without playback or dossier UX changes.*
