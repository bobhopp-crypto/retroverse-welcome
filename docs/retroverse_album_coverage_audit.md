# Retroverse album coverage audit

**Generated:** 2026-05-20 (live queries + frozen Supabase snapshot)

**Databases queried today**

| Store | Connection | Status 2026-05-20 |
|-------|------------|-------------------|
| **Supabase** (production graph) | `NEXT_PUBLIC_SUPABASE_URL` + service role | **503 / schema-cache errors** — counts below from last successful inventory run **2026-05-09** |
| **Local PostgreSQL** (`retroverse`) | `localhost` / `RETROVERSE_PG_*` | **Live** |
| **Shipped dossier bundle** | `public/data/albums/album-dossiers.json` | **Live** (file on disk) |

Scope: historically usable **canonical albums** (Billboard 200–anchored). Not deluxe/remaster SKUs as separate products, not integrity staging experiments.

---

## Section 1 — Album counts

### Supabase — `retroverse_albums` (stale snapshot 2026-05-09)

Source: `docs/RETROVERSE_INVENTORY_REPORT.md` from `npx tsx scripts/generate_retroverse_inventory_report.ts`.

| Metric | Count |
|--------|------:|
| Total canonical albums (`retroverse_albums`) | **41,352** |
| Album editions (`retroverse_album_editions`) | **~41,352** (1 primary edition per album in graph; not broken out in inventory) |
| Unique album titles | **not computed in inventory** |
| Albums with Billboard 200 source match (`retroverse_source_matches`, `billboard_200_sqlite`) | **36,334** |
| Albums with **no** B200 source match | **6,926** |

Live re-query attempted 2026-05-20: PostgREST **503** on `retroverse_albums` (no fresh count).

```sql
-- Supabase (intended; failed live 2026-05-20)
SELECT count(*) FROM retroverse_albums;
SELECT count(*) FROM retroverse_album_editions;
SELECT count(DISTINCT retroverse_artist_id || '::' || lower(canonical_album_title)) FROM retroverse_albums;
SELECT count(DISTINCT retroverse_album_id) FROM canonical_album_chart_runs;
SELECT count(*) FROM canonical_album_chart_runs;
```

### Local PostgreSQL — integrity / population warehouse (live 2026-05-20)

| Metric | Count |
|--------|------:|
| Total albums (`albums`) | **21,675** |
| Total album editions (`album_editions`) | **21,675** |
| Unique album titles (`lower(title)`) | **20,017** |
| Albums with Billboard 200 history (`chart_appearances`, `chart_name = 'Billboard 200'`) | **21,669** |
| Total B200 chart-week rows | **446,330** |

```sql
SELECT count(*) FROM albums;
SELECT count(*) FROM album_editions;
SELECT count(DISTINCT lower(title)) FROM albums;
SELECT count(DISTINCT album_id) FROM chart_appearances
  WHERE chart_name = 'Billboard 200' AND album_id IS NOT NULL;
SELECT count(*) FROM chart_appearances WHERE chart_name = 'Billboard 200';
```

**Note:** Local PG album count (**21,675**) ≠ Supabase graph (**41,352**). They are related pipelines, not the same row set.

---

## Section 2 — Cover coverage

### Supabase (stale 2026-05-09)

**Covered** = `retroverse_album_artwork` resolves to non-empty `canonical_cover_path` (UI resolver `selectCanonicalArtwork`).

| Metric | Count |
|--------|------:|
| Usable albums with canonical cover path | **288** |
| Usable albums **without** cover | **41,064** |
| % of 41,352 usable albums covered | **0.7%** |
| Artwork rows with non-null path | **288** |

```sql
SELECT count(*) FROM retroverse_album_artwork
 WHERE canonical_cover_path IS NOT NULL AND btrim(canonical_cover_path) <> '';
SELECT count(DISTINCT retroverse_album_id) FROM retroverse_album_artwork
 WHERE canonical_cover_path IS NOT NULL AND btrim(canonical_cover_path) <> '';
```

### Shipped dossier JSON (live 2026-05-20)

| Metric | Count |
|--------|------:|
| Dossiers shipped (`dossier_count`) | **8,680** |
| Dossiers with `identity.canonical_cover_path` set | **8,680** (100%) |

Paths are R2-style (`retroverse/covers/...`), not verified against disk in this audit.

### Local PG

Artwork not stored in the same `retroverse_album_artwork` table on local PG; cover work for the app is Supabase + dossier JSON paths.

---

## Section 3 — Tracklist coverage

### Supabase primary edition graph (stale 2026-05-09)

| Metric | Count |
|--------|------:|
| Albums with ≥1 `retroverse_album_tracks` (via edition) | **5,115** |
| Albums with **no** track linkage (direct or edition) | **36,237** |
| Avg tracks per direct-linked album | **4.74** |
| `retroverse_album_tracks` rows | **not counted in inventory** |

```sql
SELECT count(DISTINCT ed.retroverse_album_id)
FROM retroverse_album_tracks at
JOIN retroverse_album_editions ed ON ed.retroverse_album_edition_id = at.retroverse_album_edition_id;

SELECT count(DISTINCT ed.retroverse_album_id)
FROM retroverse_album_editions ed
WHERE ed.is_primary = true
  AND EXISTS (
    SELECT 1 FROM retroverse_album_tracks at
    WHERE at.retroverse_album_edition_id = ed.retroverse_album_edition_id
  );
```

**Original-tracklist proxy (Supabase):** primary edition with **≥6** sequenced rows and **zero** variant-keyword titles — **not batch-computed in inventory**; spot checks show many editions empty.

### Local PG — `album_track_lineage` (live 2026-05-20)

| Metric | Count |
|--------|------:|
| Total lineage rows | **203,422** |
| Distinct albums with any lineage | **15,327** |
| Lineage from acoustics (`source_provenance = 'acoustics'`) | **203,421** |
| Albums with **≥6** lineage rows | **14,722** |
| Albums with **≥6** rows and **zero** variant-keyword track titles | **317** |
| Albums with any variant-keyword title in lineage | **84** |

```sql
SELECT count(*) FROM album_track_lineage;
SELECT count(DISTINCT album_id) FROM album_track_lineage;

SELECT count(*) FROM album_track_lineage WHERE source_provenance = 'acoustics';

SELECT count(*) FROM (
  SELECT album_id FROM album_track_lineage GROUP BY album_id HAVING count(*) >= 6
) x;

SELECT count(*) FROM (
  SELECT atl.album_id
  FROM album_track_lineage atl
  JOIN tracks t ON t.id = atl.track_id
  GROUP BY atl.album_id
  HAVING count(*) >= 6
     AND count(*) FILTER (
       WHERE t.title ~* '(live|remaster|mono|stereo|demo|session|outtake|alternate|version|edit|mix|bonus|deluxe|expanded)'
     ) = 0
) clean;
```

### Shipped dossier JSON — acoustic track rows (live 2026-05-20)

What `/albums/[slug]` actually reads when `acoustic.tracks` is non-empty.

| Metric | Count |
|--------|------:|
| Dossiers shipped | **8,680** |
| Dossiers with ≥1 acoustic track row | **6,274** |
| Dossiers with **variant/remaster pollution** in acoustic rows | **1,862** |
| Total acoustic track rows | **82,780** |
| Variant-keyword rows | **11,724** |
| Manual canonical sequences (`canonical-album-sequences.json`) | **5** albums |

```javascript
// Executed via Node on album-dossiers.json — 2026-05-20
// VARIANT = live|remaster|mono|demo|session|outtake|alternate|version|mix|bonus|deluxe|expanded
```

**Historical original sequencing in dossier bundle:** **5** curated sequences only. The other **6,275** dossiers with tracks rely on **acoustic enrichment**, which is **not** original-LP-safe.

---

## Section 4 — Tracklist source analysis

### Supabase

| Source | Rows / coverage | Role |
|--------|-----------------|------|
| `retroverse_album_tracks` + `retroverse_album_editions` | **5,115** albums linked | Canonical **graph** track order when populated |
| `retroverse_tracks.retroverse_album_id` | **4,558** albums direct | Fallback / merge on album page |
| `retroverse_track_enrichment` | **not counted** (table exists) | Spotify/Billboard acoustic features only |
| `retroverse_source_matches` | **36,334** B200 album matches | Identity / chart provenance, not track order |

### Local PostgreSQL

| Source | Count |
|--------|------:|
| `staging_acoustic_tracks` | **339,804** |
| `acoustic_track_album_candidates` | **203,421** |
| `acoustic_track_album_candidates` (`review_flag = ok`) | **8,104** |
| `album_track_lineage` (`acoustics`) | **203,421** |
| `canonical_track_album_links` (`acoustics`) | **8,059** |

```sql
SELECT source_provenance, count(*) FROM album_track_lineage GROUP BY source_provenance ORDER BY count(*) DESC;
SELECT source, count(*) FROM canonical_track_album_links GROUP BY source ORDER BY count(*) DESC;
```

| `canonical_track_album_links.source` | Count |
|--------------------------------------|------:|
| acoustics | **8,059** |
| tracks.album_id | **1** |
| canonical_tracks_bootstrap | **1** |

### Shipped dossier JSON

| Source | Role |
|--------|------|
| `billboard-200-albums-charts.db` (per bundle metadata) | Chart aggregates + coordinates |
| Acoustic feature export | `acoustic.tracks[]` per dossier — **dominant tracklist on pages** |
| `canonical-album-sequences.json` | **Only** trusted original LP order ( **5** albums ) |

**Most reliable for original album sequencing today:** `canonical-album-sequences.json` (manual).  
**Most populated but polluted:** dossier `acoustic.tracks` (Spotify-style variants).  
**Best structural graph (when filled):** Supabase `retroverse_album_tracks` on **primary** edition — but only **5,115 / 41,352** albums.

---

## Section 5 — Quality audit

### BAD — remaster / expanded pollution (dossier acoustic)

**1,862** shipped dossiers contain at least one variant-keyword acoustic title.

### Thriller test case (live dossier JSON)

**Album:** Michael Jackson — *Thriller* (`RVAL586982`)

| Field | Value |
|-------|------:|
| Acoustic rows in dossier | **30** |
| Variant-keyword rows | **7** |
| Manual canonical sequence | **no** |
| Cover path in dossier | **yes** |
| Chart peak / weeks in dossier | **#1** / **30** |

**Sample acoustic titles (pollution in bold):**

1. Baby Be Mine  
2. **Beat It - Single Version**  
3. **Beat It 2008 (with Fergie) - Thriller 25th Anniversary Remix feat. Fergie**  
4. Billie Jean  
5. **Billie Jean (Home Demo from 1981)**  
6. **Billie Jean - Underground Mix**  
7. **Billie Jean 2008 Kanye West Mix (feat. Kanye West) - Thriller 25th Anniversary Remix**  
8. Carousel  
9. For All Time  
10. Human Nature  
11. P.Y.T. (Pretty Young Thing)  
12. **P.Y.T. (Pretty Young Thing) 2008 with will.i.am … Thriller 25th Anniversary Remix**

**Verdict:** Dossier tracklist for Thriller is **not** the original 1982 LP sequence; it is a **mixed enrichment bundle** (album cuts + demos + 25th-anniversary remixes).

### GOOD — examples

| Album | Why |
|-------|-----|
| Fleetwood Mac — *Rumours* (`RVAL000003`) | POC canonical sequence + stem filtering in code |
| Manual sequence albums (**5** in `canonical-album-sequences.json`) | Explicit original major listening edition |
| Local PG lineage (**317** albums) | ≥6 tracks, zero variant keywords in `tracks.title` |

---

## Section 6 — Dossier readiness (album pages)

**Definition used here:** shipped dossier + cover path + chart fields + (**manual canonical sequence** OR **≥6 acoustic tracks with no variant keywords**).

| Metric | Count |
|--------|------:|
| Dossiers shipped | **8,680** |
| Pass cover + chart + clean track rule above | **4,302** |
| **Fully ready by that rule** | **4,302** (**49.6%** of shipped dossiers) |
| Shipped but will show polluted acoustic lists (no sequence, variants present) | **~1,862** (minimum; overlaps partial lists) |

### Supabase + UI resolver (stale + structural)

| Metric | Count |
|--------|------:|
| B200-connected usable albums (approx., B200 source match) | **36,334** |
| With cover + clean ≥6-track primary graph | **≪ 288** (cover cap **0.7%**; primary graph sparse) |

**Honest production readiness today:** the **8,680** dossier pages are the real surface; **4,302** are trustworthy on track copy by the rule above. The **41k** Supabase graph is ahead on identity/chart spine but **not** on cover + original tracklists.

---

## Section 7 — True blockers

1. **Original LP sequencing is almost missing** — **5** manual sequences vs **8,680** dossiers; everything else leans on acoustic exports.  
2. **Acoustic pollution** — **1,862** dossiers (Thriller-class); **11,724** polluted rows in bundle.  
3. **Supabase primary track graph mostly empty** — **36,237** albums with no track linkage (inventory); pages ignore graph when dossier acoustic is non-empty.  
4. **Cover gap on Supabase corpus** — **288 / 41,352** (**0.7%**) with resolved artwork (inventory).  
5. **Two corpora** — local PG **21,675** vs Supabase **41,352**; lineage/acoustics on PG not wired 1:1 to dossier RVAL ids without bridge audit.  
6. **Supabase API unavailable for refresh** — 2026-05-20 **503**; ops must restore PostgREST/schema cache before live reconciliation.

---

## Recommendations (data-only)

1. Expand `canonical-album-sequences.json` (or MusicBrainz primary-medium import) for all high-traffic B200 albums.  
2. Never render raw `acoustic.tracks` when variant count is above zero unless a canonical sequence exists — enforce `buildDossierTrackRows` / `curateTrackSignals` on every page (already partially done in code).  
3. Backfill `retroverse_album_tracks` for primary editions from clean `album_track_lineage` (**317** clean albums on PG → graph bridge).  
4. Continue artwork fill beyond **288** covers.  
5. Re-run `npx tsx scripts/generate_retroverse_inventory_report.ts` and `npx tsx scripts/audit_album_coverage.ts` when Supabase is healthy.

---

## SQL / scripts executed

```sql
-- Local PG (all succeeded 2026-05-20)
SELECT count(*) FROM albums;
SELECT count(*) FROM album_editions;
SELECT count(DISTINCT lower(title)) FROM albums;
SELECT count(DISTINCT album_id) FROM chart_appearances WHERE chart_name = 'Billboard 200' AND album_id IS NOT NULL;
SELECT count(*) FROM chart_appearances WHERE chart_name = 'Billboard 200';
SELECT count(*) FROM album_track_lineage;
SELECT count(DISTINCT album_id) FROM album_track_lineage;
SELECT count(*) FROM album_track_lineage WHERE source_provenance = 'acoustics';
SELECT count(*) FROM canonical_track_album_links;
SELECT count(*) FROM canonical_track_album_links WHERE source = 'acoustics';
SELECT source_provenance, count(*) FROM album_track_lineage GROUP BY source_provenance;
SELECT source, count(*) FROM canonical_track_album_links GROUP BY source;
-- (plus clean-6+ and pollution queries in Section 3)

-- Supabase (attempted 2026-05-20 — 503 / schema cache; use inventory SQL from 2026-05-09)
SELECT count(*) FROM retroverse_albums;
SELECT count(*) FROM retroverse_album_editions;
SELECT count(DISTINCT retroverse_album_id) FROM canonical_album_chart_runs;
SELECT count(*) FROM retroverse_album_artwork WHERE canonical_cover_path IS NOT NULL;
```

```bash
# Dossier JSON analysis
node -e "/* VARIANT scan on public/data/albums/album-dossiers.json — see Section 3 counts */"

# Supabase inventory (last good run)
npx tsx scripts/generate_retroverse_inventory_report.ts  # 2026-05-09

# Repeat audit (includes Supabase pagination when API is up)
npx tsx scripts/audit_album_coverage.ts
```
