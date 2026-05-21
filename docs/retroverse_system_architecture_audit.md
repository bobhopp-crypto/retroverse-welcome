# Retroverse System Architecture Audit

**Date:** 2026-05-20  
**Scope:** `apps/retroverse-welcome` (deployed Next.js app + integrity console + ingest SQL)  
**Mode:** Read-only investigation — no code or schema changes.

---

## Executive summary

Retroverse is **architecturally converging in philosophy** (link systems, preserve chart history, additive graph) but **still fragmented in runtime wiring**. The **deployed production app** (`retroverse.live`) is powered primarily by:

1. **Supabase** (hosted Postgres / PostgREST) — `retroverse_*` tables, chart appearances, entity pages, portal year navigation, discover feed ordering, home search.
2. **Published JSON bundles** in `public/data/` — album dossiers, artist universe, retroscope coordinates, canonical sequences (shipped with the build).
3. **R2 + CDN** — canonical cover objects and `canonical-artwork-overrides.json` in production (`lib/canonical-cover-url.ts`, `lib/canonical-artwork-overrides.ts`).

A **second canonical graph** lives in **local Postgres** (`retroverse` on `localhost`, user `bobhopp`) — same conceptual domain (artists, albums, `chart_appearances`, media linkage) but **different table names and no automatic sync** to Supabase. It powers `/integrity`, optional portal/album enrichment via `lib/canonical-graph/`, and all `integrity_console/sql/` pipelines.

**SQLite** chart DBs and **VDJ/XML exports** are **ingest and offline-fallback** layers, not deploy authorities.

**Verdict:** Direction is right (SQL-first graph, staging vs canonical, bridge tables). **Risk:** two parallel “canonical” databases + three chart corpora + four artwork paths without a single publish pipeline to production.

---

## 1. Current deployed app

Production host: Vercel project `retroverse-welcome` → aliases `https://retroverse.live`, `https://www.retroverse.live`.  
Build: `npm run build` (Next.js 16, Turbopack). Requires Supabase env + cover CDN env for full UX.

### 1.1 Route map (major surfaces)

| Route | Page file | Primary loader(s) | Data source | Canonical vs legacy | Deploy-safe? |
|-------|-----------|-------------------|-------------|---------------------|--------------|
| `/` | `app/page.tsx` | Client → `GET /api/home-search` → `lib/home-search/index.ts` | **Supabase** (`retroverse_tracks`, `retroverse_albums`, `retroverse_artists`); **SQLite** Hot 100 (`lib/home-search/hot100.ts`); **JSON** dossier fallback (`lib/home-search/dossier-fallback.ts`) | Supabase = canonical IDs; Hot100/dossier = enrichment/fallback | **Yes** (Supabase required for full results; Hot100/SQLite optional — fails soft) |
| `/search` | `app/search/page.tsx` | Same as home (`AskRetroverseClient`) | Same as `/` | Same | **Yes** |
| `/welcome` | `app/welcome/page.tsx` | `POST /api/welcome-interest` → `createClient()` | **Supabase** (interest table) | Canonical write | **Yes** if env set |
| `/week` | `app/week/page.tsx` | Static/editorial | None / inline | N/A | **Yes** |
| `/random` | `app/random/page.tsx` | `createClient()` weighted queries | **Supabase** | Canonical IDs; album links may use **title slugs** (legacy routing) | **Partial** — known slug/id mismatch (`app/dev-index/page.tsx`) |
| `/albums` | `app/albums/page.tsx` | `getYearAlbums` + `attachCoverUrlsToYearAlbums` **or** `getAlbumDossiersBundleOrNull` | **Local PG graph** when `?year=` and graph returns rows; else **JSON** `public/data/albums/album-dossiers.json` | Year browse: graph (local) or dossier index (JSON); search/q/artist: dossier only | **Partial** — graph year mode **local-only** on Vercel unless `RETROVERSE_PG_*` points to reachable PG |
| `/albums/[slug]` | `app/albums/[slug]/page.tsx` | `getAlbumDossier`, `getAlbumDetailByExternalKey`, `pickCanonicalCoverForAlbum`, `resolveAlbumCoverUrl`, `getCanonicalAlbumSequence` | **JSON** dossier body; **local PG** enrichment (`lib/canonical-graph/queries.ts`); **R2/overrides** covers (`lib/canonical-artwork-overrides.ts`) | Dossier = published experience layer; graph = optional enrichment | **Yes** for dossier + R2 covers; graph enrichment **no-ops** if PG unreachable |
| `/artists` | `app/artists/page.tsx` | `getArtistUniverseBundle` / `listArtistsFromDossierBundle` | **JSON** `public/data/artists/artist-universe.json` or dossiers | Published index | **Yes** |
| `/artists/[slug]` | `app/artists/[slug]/page.tsx` | `loadArtistExperienceFromUniverse` → optional `loadArtistExperienceFromSupabase` (`ARTIST_SUPABASE_ENRICH=1`) → `loadArtistExperienceFromDossierBundle` | **JSON** first; **Supabase** optional; **SQLite** Hot100 in universe loader | Universe = primary UX; Supabase = optional enrich | **Yes** (JSON); enrich flag off by default |
| `/tracks` | `app/tracks/page.tsx` | `loadCanonicalTrackIndex` | **JSON** dossiers + sequences; **SQLite** Hot 100 | Hybrid index, not Supabase | **Partial** — Hot100 SQLite path Mac-default |
| `/tracks/[id]` | `app/tracks/[id]/page.tsx` | `tryCreateClient` / `createClient`, `loadTrackTrajectory`, pathways | **Supabase** entity graph; **SQLite** trajectory; **JSON** sequences | Supabase canonical for RVTR pages | **Yes** if Supabase populated |
| `/portal`, `/portal-v2` | `app/portal/page.tsx`, `app/portal-v2/portal-home-content.tsx` | `loadViewerBootstrap` (`lib/viewer-scope.ts`) | **Supabase** first (`retroverse_chart_appearances`, `retroverse_albums`); fallback **local PG** `chart_appearances`; fallback **SQLite** BB200 (`lib/viewer-corpus-sqlite.ts`); hydrate via `hydrateDiscoverAlbumRows` | Supabase = production corpus; graph/SQLite = degrade | **Yes** on Supabase; fallbacks **not** on typical Vercel |
| `/portal-v2/curate` | `app/portal-v2/curate/page.tsx` | `discoverStableAlbumRowFromLocalDossier`; APIs | **JSON** dossier + **Discogs** HTTP + overrides | Curator UX, not graph | **Yes** |
| `/portal-stage` | `app/portal-stage/page.tsx` | `loadViewerBootstrap` | Same as portal | Staging shell | **Yes** |
| `/eras`, `/eras/[slug]` | `app/eras/page.tsx`, `app/eras/[slug]/page.tsx` | `loadDiscoverStableFeed` + Supabase on detail | **Supabase** full album corpus + `hydrateDiscoverAlbumRows` | Discover ordering on all `retroverse_albums` | **Yes** |
| `/eras/1974-1977` | `app/eras/1974-1977/page.tsx` | Direct `createClient()` | **Supabase** | Legacy era page | **Yes** |
| `/discover` | `app/discover/page.tsx` | Redirect → `/album-retroscope` | Retired | Legacy redirect | N/A |
| `/viewer` | `app/viewer/page.tsx` | Redirect → retroscope | Retired | Legacy | N/A |
| `/album-retroscope` | `app/album-retroscope/page.tsx` | `loadAlbumRetroscopeDataset` | **JSON** `public/data/retroscope/retroscope-coordinates.json` (+ env overrides) | **Prototype** spatial UI; file-backed | **Yes** (bundled JSON) |
| `/artist-retroscope` | `app/artist-retroscope/page.tsx` | Artist rankings + universe JSON | **JSON** | Prototype | **Yes** |
| `/track-retroscope` | `app/track-retroscope/page.tsx` | Same engine | **JSON** / stub layer | **Stub** (Hot 100 layer pending) | **Yes** (limited) |
| `/track-deck` | `app/track-deck/page.tsx` | `GET /api/track-deck/week*` | **SQLite** Hot 100 (`lib/track-deck/db.ts`) | Ops chart browser | **No** on Vercel unless `HOT100_SQLITE_PATH` exists |
| `/chart-inspector` | `app/chart-inspector/page.tsx` | **Client** `createClient()` in browser | **Supabase** direct from browser | Internal tool | **Yes** (needs public Supabase keys) |
| `/integrity` | `app/integrity/page.tsx` | `loadExplorerDataWithAlbums` → `lib/integrity-console/*` | **Local PG only** (`integrityQuery`) | Operator graph explorer | **No** on Vercel (localhost PG default) |
| `/integrity/reports` | `app/integrity/reports/page.tsx` | `loadIntegrityAudits` | **Supabase** | Cross-check audits | **Yes** |
| `/internal/curator` | `app/internal/curator/page.tsx` | `loadWorkbenchData` (`app/artwork-workbench/data.ts`) | **Supabase** + JSON iTunes runs + living-archive registry | Curator | **Yes** (service role server-side for workbench data) |
| `/artwork-workbench` | `app/artwork-workbench/page.tsx` | Redirect → `/internal/curator` | — | Legacy path | — |
| `/api/artwork-workbench/living-action` | `app/api/artwork-workbench/living-action/route.ts` | R2 persist, optional `local-canonical-curation` (SQLite), `mirrorCanonicalArtworkToSupabase` | **R2** + optional **local SQLite** + **Supabase mirror** | Curator write path | **Yes** R2 + mirror; **no** local SQLite on Vercel (`shouldUseLocalCanonicalDb()` false) |
| `/api/viewer/year-albums`, `/api/viewer/hydrate` | `app/api/viewer/*` | `lib/viewer-scope.ts`, `lib/discover-hydrate-rows.ts` | Same cascade as portal | API mirror of portal | **Yes** (Supabase path) |
| `/api/discover/feed` | `app/api/discover/feed/route.ts` | `loadDiscoverStableFeed` | **Supabase** corpus + hydrate | Full-table discover | **Yes** |
| `/retroverse_v3` | `app/retroverse_v3/page.tsx` | `loadOccupancyBundle` | **Supabase** chart/album occupancy | Experimental visualization | **Yes** |
| `/relationship-workspace` | `app/relationship-workspace/page.tsx` | `lib/relationship-workspace/load-workspace.ts` | **Supabase** + VDJ/R2 search helpers | Ops linking | **Partial** |
| `/ops/*`, `/retroverse-archive/*` | various | FS / service scripts | Files, ops gate | Internal | Gated |
| `/dev-index`, `/toc`, `/site-index` | various | Static / index | Meta | Internal | **Yes** |

Reference checklist: `app/dev-index/page.tsx` (maintainer route status labels).

### 1.2 API routes (data-bearing)

| API | File | Sources |
|-----|------|---------|
| `/api/home-search` | `app/api/home-search/route.ts` | Supabase + Hot100 SQLite + dossier JSON |
| `/api/viewer/year-albums` | `app/api/viewer/year-albums/route.ts` | `loadViewerRankedAlbumEntriesForYear` (Supabase → graph → SQLite) |
| `/api/viewer/hydrate` | `app/api/viewer/hydrate/route.ts` | `hydrateDiscoverAlbumRows` (RVAL) or `hydrateSqliteAlbumRows` (`BB200-*`) |
| `/api/discover/feed` | `app/api/discover/feed/route.ts` | Supabase ordered ids + hydrate |
| `/api/artwork-workbench/*` | `app/api/artwork-workbench/*` | Discogs, R2, overrides, Supabase mirror |
| `/api/track-deck/week`, `/weeks` | `app/api/track-deck/*` | SQLite Hot 100 |
| `/api/playback/resolve` | `app/api/playback/resolve/route.ts` | Supabase + legacy media URLs |
| `/api/relationship-workspace*` | `app/api/relationship-workspace/*` | Supabase |
| `/api/welcome-interest` | `app/api/welcome-interest/route.ts` | Supabase |

### 1.3 Cover resolution chain (deployed)

Documented in `integrity_console/README.md` Phase 10; implemented across:

1. Curator override — `lib/canonical-artwork-overrides.ts` (R2 blob in production)
2. `album_artwork_links` — **local PG only** (`lib/canonical-graph/cover.ts`)
3. Dossier `identity.canonical_cover_path` — JSON (`lib/load-album-dossier.ts`)
4. `retroverse_album_artwork` — **Supabase** (`lib/discover-hydrate-rows.ts`, `lib/retroverse-artwork.ts`)
5. Placeholder

On **production Vercel**, step 2 is usually skipped (no local PG). Effective order: **override → dossier path → Supabase artwork → CDN URL** (`NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL` / `RETROVERSE_COVER_BASE_URL`).

Note: `.vercelignore` excludes `public/retroverse/covers` — production covers must be on R2/CDN, not the git tree.

---

## 2. Database topology

### 2.1 Stores at a glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RETROVERSE DATA PLANE                             │
├─────────────────┬─────────────────┬─────────────────┬───────────────────┤
│ Hosted Supabase │ Local Postgres  │ SQLite files    │ JSON / R2         │
│ retroverse_*    │ albums, artists │ hot-100.db      │ public/data/*     │
│ PostgREST       │ chart_appearances│ bb200-charts.db │ R2 cover objects  │
│                 │ media_*, staging│ local-retroverse│ overrides blob    │
└─────────────────┴─────────────────┴─────────────────┴───────────────────┘
```

### 2.2 Local Postgres (`retroverse`)

| Item | Detail |
|------|--------|
| **Connection** | `lib/integrity-console/pg.ts` — `pg.Pool`, env `RETROVERSE_PG_HOST` (default `localhost`), `RETROVERSE_PG_DATABASE` (`retroverse`), `RETROVERSE_PG_USER` (`bobhopp`) |
| **App access** | `integrityQuery()` used by `lib/integrity-console/*` and `lib/canonical-graph/*` |
| **Flag** | `RETROVERSE_CANONICAL_GRAPH=0` disables graph reads (`lib/canonical-graph/pg.ts`) |
| **Role** | SQL-first **authoring graph**: integrity merges, B200 ingest, track families, album population, VDJ/media linkage, album artwork bridge (`album_external_keys`, `album_artwork_links`) |
| **SQL assets** | `integrity_console/sql/001`–`910`, `1001`–`1003` (see `integrity_console/README.md`) |
| **Population scripts** | `scripts/populate_album_graph_bridge.py`, `scripts/parse_virtualdj_database.py`, `scripts/export_youtube_link_staging.py`, etc. |

**Key tables (local):** `artists`, `albums`, `album_editions`, `tracks`, `chart_appearances`, `track_families`, `track_family_members`, `album_track_lineage`, `staging_billboard_200_*`, `staging_virtualdj_tracks`, `media_assets`, `media_track_links`, `youtube_track_links`, `album_external_keys`, `album_artwork_links`, linkage tables (`canonical_track_album_links`, `chart_track_album_links`, …).

### 2.3 Supabase (hosted)

| Item | Detail |
|------|--------|
| **Client** | `lib/supabase.ts` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; scripts use `SUPABASE_SERVICE_ROLE_KEY` |
| **Schema** | `supabase/migrations/*.sql` — `retroverse_artists`, `retroverse_albums`, `retroverse_tracks`, `retroverse_chart_appearances`, `retroverse_album_artwork`, `canonical_album_chart_runs`, `retroverse_media_assets`, provenance, etc. |
| **Role** | **Deployed read/write model** for public app, discover, portal, track/artist pages, curator mirror |
| **Not the same DB** as local `retroverse` PG — separate connection string, separate DDL namespace (`retroverse_*` vs short names) |

### 2.4 SQLite

| Database | Default path | Env | Used by |
|----------|--------------|-----|---------|
| Billboard Hot 100 | `/Users/bobhopp/RETROVERSE_DATA/databases/billboard-hot-100.db` | `HOT100_SQLITE_PATH` | `lib/track-deck/*`, `lib/home-search/hot100.ts`, `lib/load-track-trajectory.ts`, `lib/load-canonical-track-index.ts` |
| Billboard 200 albums | `.../billboard-200-albums-charts.db` | `BILLBOARD200_SQLITE_PATH` | `lib/viewer-corpus-sqlite.ts`, `scripts/import_billboard200_albums.ts` |
| Curator local DB | `data/local-retroverse.db` | `LOCAL_RETROVERSE_DB_PATH` | `lib/local-canonical-curation.ts` when `shouldUseLocalCanonicalDb()` |

**Role:** Ingest source + **offline portal fallback** (`BB200-*` synthetic album IDs). **Not** authoritative for RVAL entity pages on production.

### 2.5 JSON publish bundles

| File (bundled) | Loader | Role |
|----------------|--------|------|
| `public/data/albums/album-dossiers.json` | `lib/load-album-dossier.ts` | Album dossier UX (acoustic, chart snapshot, track list) |
| `public/data/albums/canonical-album-sequences.json` | `lib/canonical-album-sequences.ts` | Track sequence overlay |
| `public/data/albums/canonical-artwork-overrides.json` | `lib/canonical-artwork-overrides.ts` | Dev disk overrides; prod uses R2 copy |
| `public/data/artists/artist-universe.json` | `lib/load-artist-universe.ts` | Artist index + experience |
| `public/data/retroscope/retroscope-coordinates.json` | `lib/load-album-retroscope-dataset.ts` | RetroScope cells |
| `data/discover_review_state.json` | `lib/discover-review-state.ts` | Curator review marks (local/server FS) |
| `data/relationship-workspace-decisions.json` | env `RELATIONSHIP_WORKSPACE_DECISIONS_PATH` | Ops decisions |

Override chain for paths: `*_PATH` env → `RETROVERSE_DATA_ROOT/runtime/` → `public/data/`.

### 2.6 R2

| Item | Detail |
|------|--------|
| **Client** | `lib/r2-client.ts` — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| **Writes** | `lib/curator-cover-persist.ts`, `lib/canonical-artwork-overrides.ts`, `living-action` API |
| **Reads** | CDN via `RETROVERSE_COVER_BASE_URL` / `NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL` |
| **Keys in graph** | `album_artwork_links.r2_cover_key`, `media_assets.r2_media_key` (local PG integrity views) |

### 2.7 Staging vs canonical (local PG)

Per `integrity_console/README.md`:

- **Canonical:** `artists`, `albums`, `tracks`, `chart_appearances` (facts never rewritten in analysis phases)
- **Staging:** `staging_billboard_200_*`, `staging_virtualdj_tracks`, acoustic staging, import buffers
- **Linkage:** `canonical_track_album_links`, `media_track_links`, `chart_track_album_links` — bridge layers
- **Operational:** `media_assets`, VDJ staging — not song identity

### 2.8 Duplication and conflicts

| Domain | Copy A | Copy B | Copy C | Conflict |
|--------|--------|--------|--------|----------|
| Album identity | Supabase `retroverse_albums` | Local `albums` + `album_external_keys` (RVAL) | JSON dossiers | IDs align by convention (RVAL) but **no live sync** |
| Chart weeks | Supabase `retroverse_chart_appearances` | Local `chart_appearances` | SQLite BB200 / Hot100 | Portal uses Supabase; graph uses local; fallback uses SQLite |
| Album chart ranking | Supabase aggregation in `viewer-scope.ts` | `getYearAlbums` local PG | SQLite ranked entries | Same year can differ if stores diverge |
| Artwork path | Supabase `retroverse_album_artwork` | `album_artwork_links` | overrides + dossier + `public/retroverse/covers` | Four read paths; curator writes multiple |
| Track index | Supabase `retroverse_tracks` | Local `tracks` | Dossier acoustic tracks | Track pages use Supabase; dossier uses JSON |
| Media/VDJ | — | Local `media_*` only | VDJ XML export | **Not** in Supabase app reads yet |
| Discover corpus | All `retroverse_albums` (`lib/discover-order-cache.ts`) | Former subset via `retroverse_source_matches` | Documented in `docs/DATA_PIPELINE_AUDIT.md` | **Fixed** toward full corpus — verify live counts on `/index` |

### 2.9 Disconnected pipelines

- **Local graph → Supabase:** No automated publish job in app repo; scripts under `scripts/` import to Supabase separately (`import_billboard200_albums.ts`, `backfill_*.ts`, etc.).
- **Phase 10 bridge:** `populate_album_graph_bridge.py` + `1002`/`1003` populate local `album_external_keys` / `album_artwork_links` only.
- **Integrity explorer vs reports:** `/integrity` = local PG; `/integrity/reports` = Supabase — intentional split, easy to misread.
- **VDJ / YouTube / R2 media:** Populated in local PG (`906`, `909`); **not** wired to deployed entity pages except display flags on dossier (`hasVideoMedia`, etc. from graph when PG up).

---

## 3. Canonical authority map

| Domain | Current authority (production) | Current authority (local ops) | Recommended authority |
|--------|------------------------------|-------------------------------|------------------------|
| **Artists** | Supabase `retroverse_artists` for enriched pages; JSON `artist-universe.json` for index/primary UX | Local `artists` | **Local PG** for merges/graph; **Supabase** as published read model; JSON as denormalized cache for fast artist UX |
| **Albums** | Supabase `retroverse_albums` (portal, discover, search); JSON dossiers for `/albums/[slug]` body | Local `albums` + `album_external_keys` | **Local PG** for identity + lineage; **publish** to Supabase + **dossier export** for narrative/acoustic |
| **Tracks** | Supabase `retroverse_tracks` + editions | Local `tracks` + families | **Local PG** canonical; Supabase mirror for RVTR pages |
| **Chart history** | Supabase `retroverse_chart_appearances` (portal) | Local `chart_appearances` (immutable facts) | **Single fact store** — recommend **local PG ingest → publish to Supabase**; SQLite **ingest-only** |
| **Media assets** | Supabase `retroverse_media_assets` (partial) | Local `media_assets`, VDJ staging | **Local PG** operational graph; optional Supabase mirror for deploy features |
| **Artwork** | R2 objects + overrides blob; Supabase `retroverse_album_artwork`; dossier paths | `album_artwork_links` + curator | **R2** binary authority; **one** metadata row set (recommend `album_artwork_links` → publish → Supabase + overrides projection) |
| **Playback history** | VirtualDJ XML → staging (local) | `staging_virtualdj_tracks` | **VDJ export** authoritative for play history; link via `media_track_links` only |
| **YouTube** | — | `youtube_track_links` / staging | **Enrichment only** — never replace track identity |
| **RetroScope layout** | JSON coordinates | Generated into `public/data` | **JSON export** from pipeline (spatial view layer) |
| **Hot 100 weeks** | SQLite + Supabase chart rows (track pages) | SQLite source files | **SQLite ingest-only** → publish chart facts to canonical store |

---

## 4. Deployment reality

### 4.1 Works on Vercel (typical prod env)

- Portal `/portal-v2` with Supabase chart + album hydration
- Home search, discover feed APIs, era pages (Supabase)
- Album dossier pages (bundled JSON + R2/CDN covers + overrides)
- Artist universe pages (JSON)
- Track detail (Supabase) when data exists
- Curator `living-action` → R2 + Supabase mirror (no local SQLite)
- Chart inspector (browser Supabase client)

**Required env (minimum):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, cover CDN vars, R2 vars for curator saves.

### 4.2 Local-only or degraded on Vercel

| Capability | Why |
|------------|-----|
| `/integrity` graph explorer | `RETROVERSE_PG_*` defaults to `localhost` |
| `/albums?year=` graph mode | `getYearAlbums` needs local PG |
| Album dossier graph enrichment | `getAlbumDetailByExternalKey` fails silently without PG |
| Portal graph/SQLite fallback | Mac paths; no BB200/Hot100 files on build image |
| Track deck / Hot100 search slice | SQLite not bundled (`.vercelignore` / path) |
| Curator local SQLite writes | `shouldUseLocalCanonicalDb()` false when `VERCEL=1` |
| `data/local-retroverse.db` | Excluded from deploy |
| Relationship workspace VDJ file scans | Depends on local paths |

### 4.3 Build-time behavior (observed)

Vercel build logs show portal bootstrap warnings when Supabase schema cache fails and SQLite dirs missing — static generation tolerates empty corpora; runtime depends on Supabase.

### 4.4 Cannot deploy as-is (without extra infra)

- Treating **local Postgres as production read DB** (no pooler on Vercel by default)
- **Integrity console** as public product surface without private PG tunnel
- **Full chart ops** from SQLite inside serverless (file size + path)

---

## 5. Graph integration status

### 5.1 What “graph-backed” means in code

`lib/canonical-graph/` is a thin read layer over **the same pool** as integrity console (`integrityQuery`). It is **not** a separate database product.

**Integrated (when PG reachable + `RETROVERSE_CANONICAL_GRAPH` on):**

- `/albums?year=YYYY` — full year grid from `chart_appearances` (Billboard 200)
- `/albums/[slug]` — chart peaks, media flags, cover from `album_artwork_links`
- Portal fallback — second choice after Supabase in `loadViewerRankedAlbumEntriesForYearImpl`
- Integrity cover views — `lib/integrity-console/cover-queries.ts`

**Not graph-backed (dominant on production):**

- Portal primary path — Supabase
- Discover feed — Supabase all-album corpus
- Artist pages — JSON universe (Supabase optional)
- Track index — JSON + SQLite
- Track detail — Supabase
- RetroScope — JSON only
- Home search — Supabase + SQLite + dossier

### 5.2 Estimate

| Layer | Graph share of user-visible routes |
|-------|--------------------------------------|
| **Production (retroverse.live)** | **Low** (~5–15%) — optional dossier enrichment; year album browse likely dossier-only |
| **Local dev (full stack)** | **Medium** — integrity 100%; year albums + portal fallback |

**Conclusion:** Canonical graph integration is **partial** — strong in **ops/integrity**, early in **album browse/detail**, **not dominant** in portal/discover/search.

### 5.3 Mock / prototype / legacy

| Surface | Status |
|---------|--------|
| `/album-retroscope`, `/artist-retroscope` | Prototype spatial UX — JSON corpus |
| `/track-retroscope` | Stub |
| `/discover`, `/viewer` | Legacy redirects |
| `/portal` vs `/portal-v2` | v1 legacy; v2 primary |
| `/artwork-workbench` | Redirect to `/internal/curator` |
| Title-slug album URLs | Legacy (`lib/retroverse-routes.ts` documents RVAL preference) |
| `BB200-*` album IDs | Synthetic SQLite corpus — not RVAL |

---

## 6. Recommended direction

**Do not implement in this audit** — architectural recommendations only.

### 6.1 Target state (12–18 month)

1. **Local Postgres `retroverse`** = **authoritative graph** for merges, ingest, linkage, integrity (keep SQL-first console).
2. **Supabase** = **published read replica** for serverless app (scheduled or gated publish scripts, not ad-hoc dual writes).
3. **SQLite** = **ingest-only** (B200, Hot 100) — never a runtime fallback on Vercel once publish is reliable.
4. **JSON dossiers** = **experience/cache layer** generated from graph + acoustic exports (not a second album database).
5. **R2** = **binary artwork authority** with one metadata projection chain.
6. **VDJ / YouTube** = linked enrichment, never merged into chart FKs.

### 6.2 Staging should remain

- All `staging_*` tables and candidate reports (`707`, `905`, etc.)
- Integrity dry-run SQL (`002`, `004`, `603`, …)
- iTunes acquisition JSON under ops paths
- `discover_review_state.json` until review state lives in DB

### 6.3 Migrate eventually

- Portal bootstrap off **triple fallback** → single Supabase corpus with explicit `corpusSource` telemetry
- Artist primary read from universe JSON → graph-backed publish with JSON snapshot for perf
- Duplicate artwork paths → one write (R2 + link row) → publish to Supabase + overrides
- `/integrity/reports` and `/integrity` should read the **same** store or clearly label “local vs hosted”

### 6.4 Postgres vs Supabase lead

| Question | Recommendation |
|----------|----------------|
| Should local Postgres remain primary? | **Yes** for graph hygiene, ingest, linkage, irreversible merges |
| Should Supabase lead? | **Yes** for **deployed read** and public API stability |
| Mirror or lead? | **Local leads, Supabase mirrors** (publish), not dual-write from app routes |

### 6.5 SQLite role

**Remain ingest-only.** Remove SQLite from production fallback paths once Supabase publish covers B200 years (reduces `BB200-*` fragmentation).

---

## 7. Risk analysis

| Risk | Severity | Detail |
|------|----------|--------|
| **Dual canonical DBs** | High | Supabase `retroverse_*` vs local `albums`/`artists` drift without publish discipline |
| **Triple chart corpora** | High | Supabase vs local `chart_appearances` vs SQLite — portal ordering can disagree |
| **Quadruple artwork** | Medium | overrides, `album_artwork_links`, Supabase artwork, dossier paths |
| **Graph assumed on deploy** | Medium | Features silently no-op; year albums revert to dossier JSON |
| **SQLite paths in repo defaults** | Medium | Hard-coded `/Users/bobhopp/RETROVERSE_DATA/...` — Vercel fallbacks fail |
| **Curator serverless** | Medium | No local SQLite on Vercel; relies on R2 + Supabase mirror only |
| **Client-side Supabase** | Low | Chart inspector exposes public keys (expected for internal tool) |
| **NFT / turbopack trace warnings** | Low | `next.config.ts` fs traces — build succeeds but noisy |
| **Random route slug mismatch** | Low | UX 404s for albums |
| **Accidental fragmentation** | High | Each new feature picks nearest store (JSON vs Supabase vs PG) — seen in discover audit history |

**Deployment blockers (historical):** TypeScript errors in curator routes (fixed in `ecee0a03`). **Ongoing:** no blocker for Supabase-only prod if env configured.

**Scaling:** Supabase full-table scans for discover years (`loadAllRetroverseAlbumRows`) — cached 5m; portal year scans cached 7d per year. Local integrity queries unbounded — OK for ops, not for public traffic.

---

## 8. Diagrams

### 8.1 Deployed app dependency (production happy path)

```
                    ┌─────────────────────┐
                    │   Browser / CDN     │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
   ┌───────────┐        ┌────────────┐       ┌────────────┐
   │ Next.js   │        │ R2 / CDN   │       │ Supabase   │
   │ routes    │        │ covers +   │       │ PostgREST  │
   │           │        │ overrides  │       │ retroverse_*│
   └─────┬─────┘        └────────────┘       └──────┬─────┘
         │                                          │
         │ read bundled JSON                        │
         ▼                                          │
   public/data/*.json ◄─────────────────────────────┘
   (dossiers, universe, retroscope)         hydrate + chart + entities
```

### 8.2 Local operator stack

```
  VDJ XML / CSV exports ──► staging_* ──► media_assets / media_track_links
  Billboard SQLite      ──► staging_billboard_200 ──► chart_appearances
  Acoustic exports      ──► staging_acoustics ──► album_track_lineage
  Dossier CSV/JSON      ──► populate_album_graph_bridge ──► album_external_keys
                                                      └──► album_artwork_links

                        ┌──────────────────────┐
                        │  Postgres retroverse │
                        │  (localhost)         │
                        └──────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      /integrity views      lib/canonical-graph    psql / DBeaver
      (read-only UI)        (app enrichment)      (SQL phases)
```

### 8.3 Portal corpus cascade

```
loadViewerBootstrap / loadViewerRankedAlbumEntriesForYear
        │
        ▼
   [1] Supabase retroverse_chart_appearances + retroverse_albums
        │ empty / error?
        ▼
   [2] Local PG getYearAlbums (chart_appearances Billboard 200)
        │ empty / error?
        ▼
   [3] SQLite BB200 ranked entries (BB200-* ids)
        │
        ▼
   hydrate: RVAL → hydrateDiscoverAlbumRows (Supabase + overrides + dossier)
            BB200-* → hydrateSqliteAlbumRows (SQLite + dossier)
```

### 8.4 Ingest → publish (recommended target)

```
 Sources                Staging (local PG)           Publish jobs              Deploy read
 ───────                ─────────────────           ────────────              ──────────
 BB200 SQLite    ──►    staging_billboard_*    ──►  (script)           ──►  Supabase charts
 Hot100 SQLite   ──►    chart links / tracks   ──►  (script)           ──►  Supabase tracks
 VDJ database.xml──►    staging_virtualdj_*  ──►  media populate     ──►  (future API)
 Curator/R2      ──►    album_artwork_links  ──►  mirror + overrides ──►  CDN + Supabase
 Dossier builder ──►    (export only)        ──►  publish-album-*.mjs ──►  public/data JSON
```

### 8.5 Source of truth (target)

```
DOMAIN              TRUTH (write)          PUBLISH TO              EXPERIENCE
──────              ─────────────          ──────────              ────────────
Song identity       local tracks/families  Supabase RVTR*          pages + search
Album identity      local albums           Supabase RVAL*          portal + discover
Chart facts         local chart_appearances Supabase chart rows    portal ordering
Artwork binary      R2                     CDN URL                 all UIs
Artwork metadata    album_artwork_links    Supabase + overrides    hydrate
DJ playback         VDJ staging            media_track_links       integrity / future
YouTube             youtube_track_links    (optional)              enrichment flags
Narrative/acoustic    export pipeline        dossier JSON            /albums/[slug]
```

---

## 9. Convergence assessment

| Signal | Converging? | Evidence |
|--------|-------------|----------|
| Philosophy (link, don’t merge charts) | Yes | `integrity_console/README.md`, linkage phases 7–9 |
| Single deploy read DB | Partial | Supabase dominant; graph not wired to prod PG |
| Graph ↔ app | Partial | Phase 10 albums + covers; portal still Supabase-first |
| Artwork pipeline | Partial | R2 + mirror exists; four read paths remain |
| Discover vs search corpus | Improving | `docs/DATA_PIPELINE_AUDIT.md` — full `retroverse_albums` |
| Operator tooling | Yes | `/integrity` + SQL phases 1–10 |
| Production deploy | Yes | `retroverse.live` on Supabase + JSON + R2 |

**Are we moving in the right direction?**  
**Yes at the data-model layer** (canonical graph, staging, bridge tables, media linkage).  
**Not yet at the integration layer** — production still behaves as **Supabase + JSON export app** with a **parallel local graph** that most public routes do not require.

**Critical path:** Define an explicit **publish** from local PG (+ R2) → Supabase + `public/data` exports, then **remove production fallbacks** that mask drift (SQLite corpus, silent graph no-ops).

---

## 10. Key file index

| Concern | Path |
|---------|------|
| Supabase client | `lib/supabase.ts` |
| Local PG pool | `lib/integrity-console/pg.ts` |
| Graph queries | `lib/canonical-graph/queries.ts` |
| Portal bootstrap | `lib/viewer-scope.ts` |
| Discover hydrate | `lib/discover-hydrate-rows.ts` |
| SQLite BB200 corpus | `lib/viewer-corpus-sqlite.ts` |
| Hot 100 SQLite | `lib/track-deck/db.ts`, `lib/track-deck/constants.ts` |
| Dossier loader | `lib/load-album-dossier.ts` |
| Artwork overrides | `lib/canonical-artwork-overrides.ts` |
| Cover URLs | `lib/canonical-cover-url.ts` |
| Curator runtime | `lib/curator-runtime-strategy.ts` |
| Integrity SQL | `integrity_console/sql/` |
| Supabase DDL | `supabase/migrations/` |
| Env defaults | `lib/integrity-console/pg.ts`, `lib/viewer-corpus-sqlite.ts`, `lib/track-deck/constants.ts` |
| Maintainer route map | `app/dev-index/page.tsx` |
| Prior discover audit | `docs/DATA_PIPELINE_AUDIT.md` |

---

*End of audit. No code was modified.*
