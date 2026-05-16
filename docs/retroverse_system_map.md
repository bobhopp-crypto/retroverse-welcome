# Retroverse system map (canonical architecture reference)

**Scope:** Current-state inventory of the `retroverse-welcome` Next.js app as of 2026-05-15.  
**Out of scope:** UI redesign, new features, styling, RetroScope behavior, runtime JSON/SQLite generators (documented only as consumption points).

**Sources:** `app/**`, `lib/**`, `middleware.ts`, `lib/site-toc.ts` (TOC may lag code).

---

## Legend

| Tag | Meaning |
|-----|---------|
| **ACTIVE** | Intended for normal use today. |
| **LEGACY** | Kept for redirects, bookmarks, or ops; not the forward path. |
| **EXPERIMENTAL** | Prototype / lab surface. |
| **SUPERSEDED** | Replaced by another route; prefer the replacement. |
| **BROKEN / FRAGILE** | Reaches a real page but links or mental model don’t match data (e.g. slug vs RVAL). |
| **SUPABASE-DEPENDENT** | Needs live Supabase + env for core behavior. |
| **LOCAL-FIRST** | Core UX works from shipped/edge JSON or static files (may still use R2 URLs in paths). |

Routes can combine tags (e.g. ACTIVE + SUPABASE-DEPENDENT).

---

## Route hierarchy (pages)

```text
/                          → redirect → /album-retroscope
/album-retroscope          RetroScope (year × rank grid)
/welcome                   Marketing / early-access landing
/week                      Static editorial “This week” slice

/portal                    Portal v1 shell (bootstrap from Supabase)
/portal-v2                 Portal v2 shell (same bootstrap pattern)
/portal-stage              Staging shell for portal experiments
/portal/curate             → redirect → /portal-v2/curate
/portal-v2/curate          Public curator (albumId=RVAL), hydrates from Supabase

/discover                  → redirect → /
/viewer                    → redirect → /

/eras                      Era index (local eras.json)
/eras/[slug]               Era stream (Supabase-driven discover-style feed)
/eras/1974-1977            Canonical era graph page (Supabase)

/artists                   Artists index (Supabase)
/artists/[slug]            Artist detail (Supabase)

/albums                    Albums index (Supabase) — links use title slugs
/albums/[slug]             Album dossier when slug is RVAL###### (local bundle); else 404

/tracks                    Tracks index (Supabase)
/tracks/[id]               Track detail (Supabase)

/search                    Search (Supabase); album hits link /albums/{RVAL}

/random                    Weighted random jump (Supabase) — album targets use title slugs

/index                     Internal index + corpus coverage audit (Supabase for audit)
/toc                       Human-readable route table (static + era examples from JSON)

/retroverse_v3             Occupancy / trails experiment (Supabase in loaders)

/chart-inspector           Internal chart tooling (client + Supabase)
/integrity                 Internal integrity report (Supabase)

/internal/ops-pin          Ops PIN gate UI
/internal/curator          Curator repair surface (Supabase via workbench data)
/internal/artwork          Archived notice → /internal/curator

/artwork-workbench         → redirect → /internal/curator

/ops/review                Review console (local snapshot files on disk)
/ops/itunes-album-review   iTunes calibration UI + APIs

/favicon.ico               (asset)
```

---

## API routes (`app/api`)

| Route | Role | Tags |
|-------|------|------|
| `/api/welcome-interest` | Inserts lead into Supabase | SUPABASE-DEPENDENT |
| `/api/discover/feed` | JSON feed via `loadDiscoverStableFeed` → hydrates albums | SUPABASE-DEPENDENT |
| `/api/discover/review-state` | Review state mutations (middleware-gated in prod) | SUPABASE-DEPENDENT |
| `/api/viewer/hydrate` | Batch hydrate album rows for portal clients | SUPABASE-DEPENDENT |
| `/api/viewer/year-albums` | Year-ranked album ids for portal | SUPABASE-DEPENDENT |
| `/api/artwork-workbench/*` | Candidates, image, resolve, decision, living-action | SUPABASE-DEPENDENT (living-action uses service role) |
| `/api/internal/ops-auth` | Ops auth helper | INTERNAL |
| `/api/ops/*` | iTunes review / calibration / raw file reads | Mostly **local `data/`** files (middleware-gated); not Supabase-centric |

**Middleware:** Most `/api/*` calls return `401` unless ops cookie is set (`internal/ops-pin`), except a small whitelist (e.g. public artwork candidate reads; dev-only `living-action`). `/api/discover/review-state` is explicitly gated.

---

## Page-level inventory (purpose, status, dependencies)

| Route | Purpose | Status & tags | Runtime dependencies |
|-------|---------|---------------|----------------------|
| `/` | Root: sends users to RetroScope | ACTIVE; **terminology conflict** (global nav label: “Portal”) | Redirect only |
| `/album-retroscope` | Primary handheld navigator | ACTIVE; LOCAL-FIRST for grid | `retroscope-coordinates.json` (+ seed fallback); cover URLs via `canonicalCoverPathToUrl` → optional **R2** |
| `/welcome` | Landing / interest form | ACTIVE | Static page + **Supabase** for `welcome-interest` POST |
| `/week` | Editorial slice | ACTIVE | Static content / assets |
| `/portal` | Year×album portal | ACTIVE; SUPABASE-DEPENDENT | `loadViewerBootstrap` → chart + album tables + `hydrateDiscoverAlbumRows` |
| `/portal-v2` | Primary portal UI | ACTIVE; SUPABASE-DEPENDENT | Same bootstrap stack; **R2** for covers |
| `/portal-stage` | Alternate portal shell | EXPERIMENTAL / staging | Same as portal |
| `/portal/curate` | Old curator URL | LEGACY; SUPERSEDED | Redirect to v2 |
| `/portal-v2/curate` | Deep-link curator | ACTIVE; SUPABASE-DEPENDENT | `hydrateDiscoverAlbumRowsFresh` + validation |
| `/discover` | Old “Discover home” | SUPERSEDED | redirect → `/` → RetroScope |
| `/viewer` | Old viewer | SUPERSEDED | redirect → `/` |
| `/eras` | Era chooser | ACTIVE; LOCAL-FIRST (metadata) | `lib/eras` JSON |
| `/eras/[slug]` | Era album stream | ACTIVE; SUPABASE-DEPENDENT | Supabase + discover hydration path |
| `/eras/1974-1977` | Fixed era experience | ACTIVE; SUPABASE-DEPENDENT | Supabase |
| `/artists` | Artist listing | ACTIVE; SUPABASE-DEPENDENT | Supabase + artwork helpers |
| `/artists/[slug]` | Artist page | ACTIVE; SUPABASE-DEPENDENT | Supabase |
| `/albums` | Album listing | ACTIVE; SUPABASE-DEPENDENT; **BROKEN/FRAGILE** vs dossiers | Links use `albumRoute(title)` → title slugs, not RVAL |
| `/albums/[slug]` | Album dossier | ACTIVE; LOCAL-FIRST when slug is RVAL | `album-dossiers.json` bundle; **R2** for cover path |
| `/tracks` | Track index | ACTIVE; SUPABASE-DEPENDENT | Supabase |
| `/tracks/[id]` | Track detail | ACTIVE; SUPABASE-DEPENDENT | Supabase |
| `/search` | Search UI | ACTIVE; SUPABASE-DEPENDENT | Supabase; album links use **RVAL** paths — aligns with dossiers |
| `/random` | Random traversal | ACTIVE; SUPABASE-DEPENDENT; **BROKEN/FRAGILE** | Album branch uses `albumRoute(title)` → mismatch with dossier URLs |
| `/index` | Ops/developer index + coverage | ACTIVE (internal) | **Supabase** for `computeDiscoverCoverageReport` |
| `/toc` | Site map | ACTIVE | Mostly static; era links from JSON |
| `/retroverse_v3` | 3D/occupancy experiment | EXPERIMENTAL | Supabase loaders |
| `/chart-inspector` | Internal charts | EXPERIMENTAL / internal | Supabase (client) |
| `/integrity` | Data integrity audits | INTERNAL | Supabase |
| `/internal/ops-pin` | Gate | INTERNAL | Cookie session |
| `/internal/curator` | Artwork triage | INTERNAL; SUPABASE-DEPENDENT | Workbench data loaders |
| `/internal/artwork` | Archived | LEGACY | Static notice |
| `/artwork-workbench` | Old path | LEGACY | redirect → curator |
| `/ops/review` | Review console | INTERNAL | **Local files** under ops data paths |
| `/ops/itunes-album-review` | Calibration | INTERNAL | APIs + Supabase where applicable |

---

## Dependency map (conceptual)

```text
                    ┌─────────────────────────┐
                    │ Supabase (retroverse_*) │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        v                       v                       v
  Portal bootstrap      Discover hydration      Indexes: artists,
  (viewer-scope)        (discover-hydrate)      tracks, /albums,
                                                search, eras/[slug]…

                    ┌─────────────────────────┐
                    │ Local / published JSON    │
                    └───────────┬─────────────┘
                                │
                    retroscope-coordinates.json  ──► /album-retroscope
                    album-dossiers.json         ──► /albums/RVAL######
                    eras.json                   ──► /eras, /toc examples

                    ┌─────────────────────────┐
                    │ R2 (optional CDN origin)   │
                    └───────────┬─────────────┘
                                │
                    NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL
                    + canonical_cover_path → browser URL
```

**SQLite-generated runtime:** The pipeline that writes `retroscope-coordinates.json`, `album-dossiers.json`, etc. lives outside this app (e.g. `RETROVERSE_DATA` scripts). The **app only reads** published files from `public/data/...` or `RETROVERSE_DATA_ROOT/runtime/`.

---

## Navigation flows (actual links in code)

### Entry & global chrome

- **`app/page.tsx`:** `/` → `/album-retroscope` (RetroScope is the real home).
- **`app/layout.tsx` header:** “Retroverse” → `/`; nav label **“Portal”** also → `/` → therefore **RetroScope**, not `/portal-v2`. This duplicates the product name “portal” with a different destination than `/portal` or `/portal-v2`.

### From RetroScope (`album-retroscope-client`)

- **Archive / dossier:** `/albums/{RVAL}` when cover path or `albumId` contains RVAL; else **search** `?q=artist+title`.
- **Curator (double-tap path):** `/portal-v2/curate?albumId=RVAL…` or fallback `/internal/curator`.
- **Exit:** `/welcome`.
- **Index:** `/toc`.

### From Portal v2 (`portal-v2-client`)

- Footer/menu: `/eras`, `/albums`, `/artists`, `/search`, `/index`.
- Hero: `/albums/{centeredAlbumId}` (expects **RVAL**-style id for dossier alignment).
- Artist link: `artistRoute(name)` → `/artists/{slug}`.

### Dead ends / loops

- **`/discover` → `/` → `/album-retroscope`:** The “Discover” naming in `lib/site-toc.ts` and historical comments no longer matches behavior.
- **`/viewer` → `/`:** Old bookmarks eventually land on RetroScope.
- **`/albums` index → title slug:** Often **404** on `/albums/[slug]` because dossier route requires **RVAL**.
- **`/random`:** Album outcomes skewed toward **slug URLs** → same mismatch.

### Duplicate or overlapping journeys

| Journey | Variants |
|---------|-----------|
| Year×album browsing | `/portal`, `/portal-v2`, `/portal-stage` (same bootstrap family) |
| Album detail | RVAL dossiers (`/albums/RVAL…`) vs legacy mental model of slug-from-title (`albumRoute`) |
| Curator | `/portal-v2/curate` (focused) vs `/internal/curator` (full triage) vs legacy `/portal/curate` redirect |
| “Home” | RetroScope (`/album-retroscope`), accidental “portal” nav to `/`, portal routes at `/portal*` |

---

## Duplicate / generational systems (same product, multiple implementations)

1. **Album identity in URLs:** `lib/retroverse-routes.albumRoute(title)` (slug) vs dossier requirement `RVAL\d{6}`. **Search** and **Portal hero** use album id; **albums index** and **random** use title slugs.
2. **Portal shells:** Three routes share `loadViewerBootstrap`; only product positioning differs.
3. **Discover naming vs routing:** `/discover` and “Discover” in TOC/index copy imply a feed home; **actual** home is RetroScope unless user opens `/portal-v2` directly.
4. **Global nav “Portal”:** Points to `/` (RetroScope), not portal UI — duplicates the word “portal” across incompatible targets.
5. **Curator surfaces:** Public deep-link curate vs internal workbench vs redirect shim.
6. **Artwork:** `/internal/artwork` archived; `/artwork-workbench` redirect; APIs remain the living layer.

---

## What should become canonical (recommendations)

| Area | Canonical direction |
|------|---------------------|
| **Public entry** | Treat **`/album-retroscope`** as the primary front door; align nav labels and `site-toc` with that (documentation-only follow-up when you resume feature work). |
| **Album detail URL** | **`/albums/{RVAL}`** backed by local **`album-dossiers.json`**; any list UI that still emits title slugs should eventually emit **RVAL** (or redirect layer). |
| **Year×rank frame** | **Single** portal variant for product story — keep **`/portal-v2`** as candidate canonical; freeze or deprecate **`/portal-stage`** when staging is done; **`/portal`** becomes legacy alias if v2 wins. |
| **Curator deep link** | **`/portal-v2/curate?albumId=RVAL`**; keep **`/portal/curate`** as redirect only. |
| **Internal repair** | **`/internal/curator`** + gated APIs. |

## Freeze / deprecate / remove later

| Item | Suggestion |
|------|------------|
| **`/portal/curate`** | Already redirect — **keep** as frozen compatibility. |
| **`/discover`, `/viewer`** | **SUPERSEDED** — keep redirects; remove mentions from primary nav copy over time. |
| **`/internal/artwork`** | **Frozen** notice only. |
| **`albumRoute`-based album links** on high-traffic pages (`/albums`, `/random`) | **Deprecate** behavior — causes **404** against dossier route. |
| **`/portal-stage`** | **Deprecate** when v2 is final; or restrict to dev builds. |
| **`/retroverse_v3`, `/chart-inspector`** | **Labs** — gate or document as non-product. |

## Localize next (data / infra)

Priority candidates for **LOCAL-FIRST** or static export (independent of this doc’s implementation):

1. **`/albums` index** — drive from dossier index or runtime manifest instead of title slugs + Supabase row scan (or keep Supabase for sort/filter but link **RVAL**).
2. **Portal bootstrap** — optional snapshot of year-ranked ids (today: **Supabase** in `viewer-scope`).
3. **Era streams** — currently **Supabase**-hydrated like Discover; could mirror discover’s order cache pattern or static feeds.
4. **`/random`** — switch album branch to **RVAL** hrefs.

---

## Related files (for implementers)

| Concern | File(s) |
|---------|---------|
| RetroScope dataset | `lib/load-album-retroscope-dataset.ts`, `public/data/retroscope/*` |
| Dossiers | `lib/load-album-dossier.ts`, `public/data/albums/album-dossiers.json` |
| Portal bootstrap | `lib/viewer-scope.ts` |
| Discover hydration | `lib/discover-hydrate-rows.ts`, `lib/discover-order-cache.ts` |
| Cover URLs / R2 | `lib/canonical-cover-url.ts` |
| Slug routes helper | `lib/retroverse-routes.ts` |
| Nav / TOC copy | `lib/site-toc.ts` (known lag vs `/` → RetroScope) |
| Ops gate | `middleware.ts` |

---

*This document is the canonical **current-state** map. Update it when routes or dependency boundaries change.*
