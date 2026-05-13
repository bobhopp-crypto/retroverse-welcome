# Retroverse inventory report

**Generated:** 2026-05-09T08:19:12.504Z (UTC)
**Sources:** Supabase (`https://arxngrghajbmmasecquq.supabase.co`) — `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; local repo `public/` (image files).

> This file is produced by `npx tsx scripts/generate_retroverse_inventory_report.ts`. Re-run to refresh counts.
> Supabase list queries use 1000-row pagination end-to-end (no silent row caps).

## 1. Album counts

| Metric | Count |
| --- | ---: |
| Total rows in `retroverse_albums` | 41352 |
| Usable in app (non-empty id + title; Discover/search corpus) | 41352 |
| Distinct albums with Billboard 200 SQLite source match (`source=billboard_200_sqlite`) | 36334 |
| Albums with **no** row in `retroverse_source_matches` (entity_type=`album`) | 4982 |
| Albums with **no** Billboard SQLite source match | 6926 |

## 2. Cover counts

| Metric | Count |
| --- | ---: |
| Usable albums with resolved canonical cover path (`selectCanonicalArtwork` on `retroverse_album_artwork`) | 288 |
| Usable albums **without** canonical cover | 41064 |
| % of usable albums covered | 0.7% |
| Rows in `retroverse_album_artwork` with non-null `canonical_cover_path` | 288 |
| Distinct **local** paths referenced (non-URL), normalized under `public/` | 288 |
| Image files under `public/` (jpg/jpeg/png/webp/gif) | 385 |
| Referenced local paths **missing** on disk (file not found) | 0 |
| Local image files **not** matching any referenced `public/...` path | 97 |

**Note:** Remote URLs in `canonical_cover_path` are not checked on disk.

## 3. Artist counts

| Metric | Count |
| --- | ---: |
| Total rows in `retroverse_artists` | 10402 |
| Distinct artists appearing on ≥1 album in `retroverse_albums` | 10399 |
| Distinct artists with ≥1 **usable** album that has a canonical cover path | 218 |
| Artists searchable on `/search` | 10402 (all rows; query is `ilike` on `canonical_artist_name`) |

*3 artists in `retroverse_artists` have no row in `retroverse_albums` (orphan artist stubs).*

## 4. Track / tracklist counts

| Metric | Count |
| --- | ---: |
| Total rows in `retroverse_tracks` | 21614 |
| Track rows with non-null `retroverse_album_id` | 21614 |
| Distinct albums with ≥1 such track | 4558 |
| Distinct albums reachable via `retroverse_album_tracks` → edition | 5115 |
| Albums in **both** direct and edition graphs | 4558 |
| Albums **only** direct (no edition track rows) | 0 |
| Albums **only** edition (no direct `retroverse_album_id` on tracks) | 557 |
| **Union** of albums with any track linkage | 5115 |
| Usable albums with **no** track linkage (neither direct nor edition) | 36237 |
| Avg tracks per album among **direct-linked** albums (`retroverse_tracks.retroverse_album_id`) | 4.74 |

### Album page track resolution (current code)

- **Primary path:** `retroverse_album_tracks` for primary (or best track-rich) edition, ordered by disc/track.
- **Merge:** Tracks linked on the edition are unioned with extra rows where `retroverse_tracks.retroverse_album_id` matches the album and wasn’t already in the edition list (appended after the last edition track number).
- **Fallback:** If the edition has no tracks, the page maps **all** `retroverse_tracks` with `retroverse_album_id = album`, sorted by year + title.
- **Assessment:** Linkage is **mixed** — edition-based sequencing when `retroverse_album_tracks` is populated; **direct `retroverse_album_id`** fills gaps or replaces when editions are empty. Gaps indicate **partial ingestion**, not a broken resolver.

## 5. Discover feed status

| Metric | Count |
| --- | ---: |
| Albums **eligible** for Discover home (`all` era, after repo `discover_review_state.json` filter: not `hidden` / `fixed`) | 41352 |
| Usable albums marked **hidden** (repo file) | 0 |
| Usable albums marked **fixed** (repo file; excluded from feed) | 0 |
| Usable albums marked **skipped** | 0 |
| Usable albums marked **reviewed** | 0 |
| Eligible-for-Discover albums **with** canonical cover (same resolver as UI) | 288 |
| Eligible-for-Discover albums **without** canonical cover | 41064 |
| Eligible covered % | 0.7% |

**Implementation:** Ordered id list is cached server-side (`unstable_cache`, 300s). Each request hydrates a **window** of up to 48 ids for artwork/interleave, then returns 12.
**Client:** Per-device `localStorage` (`retroverse_discover_memory_v1`) can hide/snooze albums; not reflected in the table above.

## 6. Search status

| Capability | Supported? |
| --- | --- |
| Album **title** substring match on `retroverse_albums.canonical_album_title` | Yes (`ilike`, cap 500/variant) |
| **Spelling variants** (e.g. Rumors/Rumours, color/colour) | Yes (`lib/corpus-search.ts`) |
| **Artist name** match on `retroverse_artists.canonical_artist_name` | Yes |
| Album results expanded by **matched artists** (discography slice per artist) | Yes |
| **Aliases** / alternate artist strings without a DB row | No (no alias table wired in) |
| Full-text / fuzzy index | No |

## 7. Known problems before ship

- **Feed generation:** First rebuild of the ordered id cache still walks all `retroverse_albums` (paginated); hot path is cached ~5m. Cold starts can feel slow.
- **Covers:** 41064 usable albums lack a canonical path; 0 referenced local paths are missing on disk in this checkout.
- **Tracks:** 36237 usable albums have no track linkage; many catalogs are **partially** linked (edition vs direct skew: only-edition 557, only-direct 0).
- **Era streams:** Each era uses the same resolver with a year filter on the cached ordering; very large eras still pay hydrate cost per page.
- **Public ship readiness:** Verify env, Supabase RLS, and that production hosts the same `public/` assets (or URLs) referenced by `canonical_cover_path`.

## 8. Ship readiness (honest snapshot)

| Area | Status |
| --- | --- |
| Corpus present (`retroverse_albums`) | **Yes** — 41,352 rows |
| Search + album routes | **Functional** — full table title search + slug/id resolution |
| Discover | **Functional** — cached ordering + windowed hydrate (see §5) |
| Covers (usable %) | **Critical gap** — 0.7% |
| Tracklists (usable %) | **Critical gap** — 12.4% |
| Local cover files vs DB refs | **OK** — 0 missing paths, 97 unreferenced image files under `public/` |

