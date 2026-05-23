# Retroverse Structural Audit

**Audit date:** 2026-05-21  
**Scope:** `/Users/bobhopp/RETROVERSE_v2` (read-only inspection)  
**Auditor:** Cursor agent (automated filesystem + git + config scan)  
**Rule:** No application code, routes, packages, or folders were modified.

---

## Executive summary

| Finding | Detail |
|---------|--------|
| App folders under `apps/` | **4** (`retroverse-welcome`, `retroverse-welcome-clean`, `retroverse-welcome-clean2`, `retroverse_welcome`) |
| Naming note | There is **no** `retroverse__welcome` (double underscore). The stub folder is `retroverse_welcome` (single underscore). |
| Monorepo | **No.** `/Users/bobhopp/RETROVERSE_v2` has no root `package.json`, no `turbo.json`, no `pnpm-workspace.yaml`. |
| Canonical dev app | **`/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome`** |
| Localhost (observed) | `retroverse-welcome` → `npm run dev` → **port 3000** (Next.js default) |
| Vercel project (all linked clones) | `retroverse-welcome` (`prj_oxhn595udDtufp6wudx4D2NaePyA`) |
| Production GitHub remote | `https://github.com/bobhopp-crypto/retroverse-welcome.git` |
| Stale deploy snapshots | `retroverse-welcome-clean`, `retroverse-welcome-clean2` (frozen **2026-05-11**) |
| Empty stub | `retroverse_welcome` (not runnable) |

---

# 1. APP INVENTORY

Base path: `/Users/bobhopp/RETROVERSE_v2/apps/`

## 1.1 `retroverse-welcome` — **ACTIVE / CANONICAL**

| Attribute | Value |
|-----------|-------|
| **Exact folder** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` |
| **package.json** | Yes — `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/package.json` |
| **npm name** | `retroverse-welcome` |
| **Next.js** | Yes — `16.2.4` (`next.config.ts` at project root) |
| **App Router** | Yes — `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/app/` |
| **Pages Router** | **No** — `pages/` does not exist |
| **Git root** | **Yes** — `.git` at this path |
| **Git remote** | `origin` → `https://github.com/bobhopp-crypto/retroverse-welcome.git` |
| **Latest commit** | `0c41e47c` — 2026-05-21 10:06:05 — *Replace generic track relatedness with editorial continuity rails.* |
| **Folder mtime** | 2026-05-20 16:08 |
| **Disk size** | ~11 GB (includes `node_modules`, `.next`, `data/`, cover assets) |
| **Tracked files (excl. node_modules/.next/.git)** | ~40,632 |
| **Estimated purpose** | Primary Retroverse web app — active development, full route surface, VDJ ingest, track-deck, retroscope, integrity console, graph tooling |
| **Active vs stale** | **Active** — commits today; 38+ `app/` files touched in last 24h at audit time |

**Key config paths:**

- `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/next.config.ts`
- `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/middleware.ts`
- `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/.vercel/project.json`
- `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/tsconfig.json`

**Dev scripts (no explicit port):**

```json
"dev": "next dev",
"build": "next build",
"start": "next start"
```

---

## 1.2 `retroverse-welcome-clean` — **STALE SNAPSHOT**

| Attribute | Value |
|-----------|-------|
| **Exact folder** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean` |
| **package.json** | Yes (same npm name `retroverse-welcome`, same script block as main at audit) |
| **Next.js** | Yes — `next.config.ts` |
| **App Router** | Yes |
| **Pages Router** | **No** |
| **Git root** | **Yes** — separate repo, **no remote** |
| **Latest commit** | `24af069e` — 2026-05-11 21:07:44 — *clean deployment repo* |
| **Folder mtime** | 2026-05-11 21:02 |
| **Disk size** | ~8.3 GB (still has `node_modules`, `.next`, heavy `data/`) |
| **Tracked files (excl. node_modules/.next/.git)** | ~39,675 |
| **Estimated purpose** | May-11 “clean deployment” copy of welcome; same Vercel project link; **missing 14+ routes** added to main since then |
| **Active vs stale** | **Stale** — no commits since May 11; bloated local artifacts |

---

## 1.3 `retroverse-welcome-clean2` — **STALE SLIM DEPLOY CLONE**

| Attribute | Value |
|-----------|-------|
| **Exact folder** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean2` |
| **package.json** | Yes (identical name/scripts/deps to clean) |
| **Next.js** | Yes |
| **App Router** | Yes — **identical route tree to clean** (`diff -rq` on `app/` and `lib/` → no differences) |
| **Pages Router** | **No** |
| **Git root** | **Yes** |
| **Git remote** | `origin` → `https://github.com/bobhopp-crypto/retroverse-welcome-clean2.git` |
| **Latest commit** | `cbdecfc` — 2026-05-11 21:11:30 — *chore: clean deployment baseline (no history bloat)* |
| **Folder mtime** | 2026-05-11 21:11 |
| **Disk size** | ~85 MB |
| **Tracked files (excl. node_modules/.next/.git)** | ~1,542 |
| **Estimated purpose** | GitHub-pushed slim deploy baseline from same day as clean; **not** the live feature tree |
| **Active vs stale** | **Stale** — intentionally frozen; useful only as historical deploy reference |

---

## 1.4 `retroverse_welcome` — **EMPTY STUB (NOT AN APP)**

| Attribute | Value |
|-----------|-------|
| **Exact folder** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse_welcome` |
| **Note on naming** | User-reported `retroverse__welcome` does **not** exist on disk. This folder uses a **single** underscore. |
| **package.json** | **No** |
| **Next.js** | **Not runnable** — no `next.config.*` |
| **App Router** | Partial — one file only |
| **Pages Router** | **No** |
| **Git** | **No** `.git` |
| **Folder mtime** | 2026-05-15 19:37 |
| **Only file** | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse_welcome/app/dev-index/page.tsx` (0 bytes) |
| **Route if served** | `/dev-index` only (cannot run without parent Next project) |
| **Active vs stale** | **Accidental stub** — ignore or delete later; real `/dev-index` lives in `retroverse-welcome` |

---

## 1.5 Parent container `RETROVERSE_v2`

| Path | Contents at audit |
|------|-------------------|
| `/Users/bobhopp/RETROVERSE_v2/deploy/` | **Empty** (directory only, mtime 2026-05-06) |
| `/Users/bobhopp/RETROVERSE_v2/docs/` | **Empty** |
| `/Users/bobhopp/RETROVERSE_v2/scripts/` | `convert_chart_to_csv.py` only |
| `/Users/bobhopp/RETROVERSE_v2/temp/` | Empty |
| `/Users/bobhopp/RETROVERSE_v2/tools/` | Empty |
| Root `package.json` | **Does not exist** |

**Implication:** `RETROVERSE_v2` is a **filesystem grouping folder**, not a workspace/monorepo. Each app under `apps/` is an independent project with its own git root (except the stub).

---

# 2. VERCEL DEPLOYMENT TARGET

## 2.1 `vercel.json`

| Location | Present |
|----------|---------|
| `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/vercel.json` | **No** |
| `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean/vercel.json` | **No** |
| `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean2/vercel.json` | **No** |
| `/Users/bobhopp/RETROVERSE_v2/deploy/` | **No files** |

Vercel uses framework defaults + linked project metadata (no custom `vercel.json` overrides found).

## 2.2 `.vercel/project.json` (all three real apps)

**Identical across main, clean, and clean2:**

```json
{
  "projectId": "prj_oxhn595udDtufp6wudx4D2NaePyA",
  "orgId": "team_X3CWFSJ08xforht4Xu0iOzRy",
  "projectName": "retroverse-welcome"
}
```

| App folder | `.vercel` path |
|------------|----------------|
| Main | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/.vercel/project.json` |
| Clean | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean/.vercel/project.json` |
| Clean2 | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome-clean2/.vercel/project.json` |

**Critical implication:** Running `vercel deploy` from **any** of these three folders targets the **same** Vercel project. Whichever folder you deploy from becomes the build root **at deploy time**. This is a primary source of “ghost routes” and styling drift if deploys alternate between folders.

## 2.3 Build root / output root (inferred)

| Setting | Value |
|---------|-------|
| **Framework** | Next.js (auto-detected) |
| **Build command** | `next build` (from `package.json`) |
| **Output** | Next.js default (`.next` + serverless functions) |
| **Root directory** | The directory where Vercel/Git integration points — **expected:** repo root of `bobhopp-crypto/retroverse-welcome` |
| **outputFileTracingExcludes** | Defined in main `next.config.ts` — excludes `data/raw`, `data/exports`, `scripts/`, etc. from serverless bundles |

## 2.4 GitHub ↔ Vercel relationship

| Repo | Role |
|------|------|
| `bobhopp-crypto/retroverse-welcome` | **Production source of truth** (active commits, Cursor workspace) |
| `bobhopp-crypto/retroverse-welcome-clean2` | Historical slim baseline (May 11); **not** feature-complete vs main |
| `retroverse-welcome-clean` | Local-only git (no remote) |

**Branch configuration:** Not visible in local files. Confirm in Vercel dashboard: Project `retroverse-welcome` → Git → Production Branch (typically `main`).

## 2.5 Which folder Vercel is **actually** deploying

| Evidence | Conclusion |
|----------|------------|
| GitHub `gh repo view` from main app cwd | `retroverse-welcome` |
| Active development & latest commits | `retroverse-welcome` |
| clean/clean2 frozen May 11 with fewer routes | **Should not** be production if Git integration points at main repo |
| All three folders share same Vercel project ID | Manual CLI deploys from `clean` or `clean2` would **overwrite** production with stale code |

**Authoritative production app (expected):** `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome`  
**Risk:** CLI deploy from `retroverse-welcome-clean` or `retroverse-welcome-clean2` without changing project link.

---

# 3. LOCALHOST TARGET

## 3.1 Workspace / Turborepo

| File | Present at `/Users/bobhopp/RETROVERSE_v2` |
|------|------------------------------------------|
| `package.json` (root) | **No** |
| `turbo.json` | **No** |
| `pnpm-workspace.yaml` | **No** |

No workspace orchestration. Each app runs independently.

## 3.2 `npm run dev` behavior

| App | `npm run dev` | Default port |
|-----|---------------|--------------|
| `retroverse-welcome` | `next dev` | **3000** (Next default; no `-p` in script) |
| `retroverse-welcome-clean` | `next dev` | 3000 if run (would conflict) |
| `retroverse-welcome-clean2` | `next dev` | 3000 if run (would conflict) |
| `retroverse_welcome` | N/A | N/A |

## 3.3 Observed localhost at audit time

| Signal | Value |
|--------|-------|
| Terminal cwd (multiple sessions) | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` |
| Command | `npm run dev` → `next dev` |
| Port 3000 listener | `node` PID 39909 — `next-server (v16.2.4)` |
| Next version in terminal output | `▲ Next.js 16.2.4 (Turbopack)` |

**Conclusion:** Localhost is serving **`retroverse-welcome`**, not clean/clean2.

## 3.4 Multiple apps simultaneously

| Risk | Detail |
|------|--------|
| Port collision | All Next apps default to **3000** |
| Observed terminal history | Explicit `lsof -ti:3000,3001 | xargs kill -9` before restarts |
| Current state | One `next-server` on 3000 |

Only one app should run at a time unless ports are overridden manually.

## 3.5 Cursor workspace vs disk

| Item | Path |
|------|------|
| Cursor workspace (this session) | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome` |
| Parent `RETROVERSE_v2` | Container only; not opened as unified workspace |

---

# 4. ROUTE TREE

Convention: routes derived from `app/**/page.tsx` and `app/api/**/route.ts`.

## 4.1 `retroverse-welcome` — page routes (43)

| Route | Page file | Layout chain |
|-------|-----------|--------------|
| `/` | `app/page.tsx` | `app/layout.tsx` |
| `/welcome` | `app/welcome/page.tsx` | root |
| `/week` | `app/week/page.tsx` | root |
| `/search` | `app/search/page.tsx` | root |
| `/random` | `app/random/page.tsx` | root (server redirect) |
| `/site-index` | `app/site-index/page.tsx` | root |
| `/toc` | `app/toc/page.tsx` | root |
| `/dev-index` | `app/dev-index/page.tsx` | root |
| `/discover` | `app/discover/page.tsx` | root → **redirects to** `/album-retroscope` |
| `/viewer` | `app/viewer/page.tsx` | root → **redirects to** `/album-retroscope` |
| `/tracks` | `app/tracks/page.tsx` | root → **redirects to** `/track-deck` |
| `/tracks/[id]` | `app/tracks/[id]/page.tsx` | root |
| `/track-deck` | `app/track-deck/page.tsx` | `app/track-deck/layout.tsx` |
| `/track-curator` | `app/track-curator/page.tsx` | root (transport hidden) |
| `/track-retroscope` | `app/track-retroscope/page.tsx` | `app/track-retroscope/layout.tsx` |
| `/album-retroscope` | `app/album-retroscope/page.tsx` | `app/album-retroscope/layout.tsx` |
| `/artist-retroscope` | `app/artist-retroscope/page.tsx` | `app/artist-retroscope/layout.tsx` |
| `/albums` | `app/albums/page.tsx` | root |
| `/albums/[slug]` | `app/albums/[slug]/page.tsx` | root |
| `/albums/[slug]/chart-run` | `app/albums/[slug]/chart-run/page.tsx` | root |
| `/artists` | `app/artists/page.tsx` | root |
| `/artists/[slug]` | `app/artists/[slug]/page.tsx` | root |
| `/eras` | `app/eras/page.tsx` | root |
| `/eras/[slug]` | `app/eras/[slug]/page.tsx` | root |
| `/eras/1974-1977` | `app/eras/1974-1977/page.tsx` | root |
| `/chart-inspector` | `app/chart-inspector/page.tsx` | root (transport hidden) |
| `/relationship-workspace` | `app/relationship-workspace/page.tsx` | root (transport hidden) |
| `/retroverse-archive` | `app/retroverse-archive/page.tsx` | root |
| `/retroverse-sites` | `app/retroverse-sites/page.tsx` | root |
| `/retroverse_v3` | `app/retroverse_v3/page.tsx` | `app/retroverse_v3/layout.tsx` |
| `/portal` | `app/portal/page.tsx` | `app/portal/layout.tsx` |
| `/portal/curate` | `app/portal/curate/page.tsx` | portal layout → redirect logic |
| `/portal-v2` | `app/portal-v2/page.tsx` | `app/portal-v2/layout.tsx` |
| `/portal-v2/curate` | `app/portal-v2/curate/page.tsx` | portal-v2 layout |
| `/portal-stage` | `app/portal-stage/page.tsx` | `app/portal-stage/layout.tsx` |
| `/integrity` | `app/integrity/page.tsx` | `app/integrity/layout.tsx` |
| `/integrity/reports` | `app/integrity/reports/page.tsx` | integrity layout |
| `/internal/ops-pin` | `app/internal/ops-pin/page.tsx` | root |
| `/internal/curator` | `app/internal/curator/page.tsx` | root |
| `/internal/artwork` | `app/internal/artwork/page.tsx` | root |
| `/ops/review` | `app/ops/review/page.tsx` | root (+ middleware gate) |
| `/ops/itunes-album-review` | `app/ops/itunes-album-review/page.tsx` | root (+ middleware gate) |
| `/artwork-workbench` | `app/artwork-workbench/page.tsx` | root → redirect to `/internal/curator` |

### Root layout controls all public pages

`/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/app/layout.tsx`:

- `RetroverseRouteTuner` (internal route transition overlay)
- `RetroverseTopChrome` (wordmark + contextual back)
- `<main>{children}</main>`
- `RetroverseTransportDeck` (bottom nav — hidden on excluded prefixes)

**Global CSS:** `app/globals.css`, `app/retroverse-public.css`

### `next.config.ts` redirect

| Source | Destination |
|--------|-------------|
| `/index` | `/site-index` |

### Middleware (`middleware.ts`) — ops gate

Matcher paths (redirect to `/internal/ops-pin` when unauthenticated):

- `/ops/:path*`
- `/internal/curator/:path*`
- `/internal/artwork/:path*`
- `/artwork-workbench/:path*`
- `/api/ops/:path*`
- `/api/artwork-workbench/:path*` (except public candidate endpoints)
- `/api/discover/review-state`

---

### `retroverse-welcome` — API routes (30)

```
/api/artwork-workbench/candidates
/api/artwork-workbench/decision
/api/artwork-workbench/image
/api/artwork-workbench/living-action
/api/artwork-workbench/resolve-discogs-url
/api/discover/feed
/api/discover/review-state
/api/home-search
/api/internal/ops-auth
/api/ops/itunes-album-review/calibration-action
/api/ops/itunes-album-review/candidate-details
/api/ops/itunes-album-review/decision
/api/ops/itunes-album-review/discogs-recovery
/api/ops/itunes-album-review/rerun
/api/ops/review/raw
/api/playback/resolve
/api/relationship-workspace
/api/relationship-workspace/action
/api/retroverse-archive/raw
/api/retroverse-archive/screenshot
/api/retroverse-sites/entries
/api/retroverse-sites/image
/api/retroverse-sites/meta
/api/track-curator/action
/api/track-deck/week
/api/track-deck/weeks
/api/track-links/accept
/api/viewer/hydrate
/api/viewer/year-albums
/api/welcome-interest
```

---

## 4.2 `retroverse-welcome-clean` / `clean2` — page routes (29 each)

Identical between clean and clean2:

```
/
/albums
/albums/[slug]
/artists
/artists/[slug]
/artwork-workbench
/discover
/eras
/eras/1974-1977
/eras/[slug]
/index
/internal/artwork
/internal/curator
/internal/ops-pin
/ops/itunes-album-review
/ops/review
/portal
/portal-stage
/portal-v2
/portal-v2/curate
/portal/curate
/random
/search
/toc
/tracks
/tracks/[id]
/viewer
/week
/welcome
```

**API routes (17):** artwork-workbench (4), discover (2), internal/ops-auth, ops/itunes (5), ops/review/raw, viewer (2), welcome-interest.

**Layouts (4 only):** root, `portal`, `portal-v2`, `portal-stage` — no retroscope/track-deck/integrity layouts.

---

## 4.3 Routes in MAIN only (not in clean/clean2)

```
/album-retroscope
/albums/[slug]/chart-run
/artist-retroscope
/chart-inspector
/dev-index
/integrity
/integrity/reports
/relationship-workspace
/retroverse-archive
/retroverse-sites
/retroverse_v3
/site-index
/track-curator
/track-deck
/track-retroscope
```

Plus **13 API routes** only in main (home-search, playback/resolve, track-deck/*, track-curator, retroverse-archive, retroverse-sites, relationship-workspace, track-links, etc.).

---

## 4.4 Route in CLEAN only (not in main)

```
/index
```

Main uses `/site-index` with `next.config.ts` redirect `/index` → `/site-index`.

---

## 4.5 Stale / duplicate route systems (within main)

| Route(s) | Status |
|----------|--------|
| `/discover`, `/viewer` | Legacy entry points → redirect to `/album-retroscope` |
| `/tracks` (index) | Legacy → redirect to `/track-deck` |
| `/portal`, `/portal-v2`, `/portal-stage` | Three parallel portal shells |
| `/retroverse_v3` | Experimental chamber (own layout) |
| `app/discover/discover-feed-client.legacy.tsx` | Legacy client still in tree |
| `lib/retroverse-nav.ts` `PRIMARY_NAV` | Marked `@deprecated`; docs in `retroverse-route-map.md` still reference it as header source (**doc drift**) |

**Authoritative route index in app:** `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/app/dev-index/page.tsx`  
**Authoritative TOC:** `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/lib/site-toc.ts` → `/toc`, `/site-index`

---

# 5. NAVIGATION AUDIT

## 5.1 Primary public navigation (current)

| System | Path | Role |
|--------|------|------|
| **Transport deck (bottom)** | `lib/transport-nav.ts` + `app/components/retroverse-transport-deck.tsx` | Canonical public nav: Albums, Artists, Charts (`/track-deck`), Retroscope (`/album-retroscope`), Eras |
| **Top chrome** | `app/components/retroverse-top-chrome.tsx` | Wordmark → `/`; contextual back via `backAffordanceForPath()` |
| **Route tuner overlay** | `app/retroverse-route-tuner.tsx` | Internal/lab transition label (not a link nav) |

**Transport excluded prefixes** (`lib/transport-nav.ts`):

```
/portal-v2, /portal, /portal-stage, /integrity, /relationship-workspace,
/track-curator, /dev-index, /chart-inspector
```

Note: `/track-deck` and `/album-retroscope` are **not** excluded (deck still shows on those routes per route-tuner internal list).

## 5.2 Deprecated / secondary nav config

| System | Path | Status |
|--------|------|--------|
| `PRIMARY_NAV` | `lib/retroverse-nav.ts` | `@deprecated` — kept for entity strips |
| `CHARTS_HREF` | `lib/transport-nav.ts` → `/track-deck` | Canonical charts surface |

## 5.3 Site index / TOC navigation

| System | Path | Used by |
|--------|------|---------|
| `site-toc.ts` | `lib/site-toc.ts` | `/toc`, `/site-index` |
| Sections | `indexRetroscopeNav`, `indexPrimaryNav`, `indexSecondaryNav`, `indexToolsNav`, `siteTocStaticPages` | Human-readable full route table |

## 5.4 Entity-level / contextual navigation

| Component / module | Path |
|--------------------|------|
| `retroverse-entity-nav.tsx` | `app/components/retroverse-entity-nav.tsx` |
| `year-timeline-nav.tsx` | `app/albums/year-timeline-nav.tsx` |
| `artist-year-ranking-nav.ts` | `lib/artist-year-ranking-nav.ts` |
| `history-back-button.tsx` | `app/history-back-button.tsx` |
| `load-album-track-routes.ts` | `lib/load-album-track-routes.ts` |
| `retroverse-routes.ts` | `lib/retroverse-routes.ts` (href builders for RVAL/RVAR/RVTR) |

## 5.5 Portal-specific navigation (legacy shells)

| Nav | Path | Layout |
|-----|------|--------|
| `portal-loft-nav.tsx` | `app/portal/portal-loft-nav.tsx` | `app/portal/layout.tsx` |
| Portal v2 client chrome | `app/portal-v2/portal-v2-client.tsx` | `app/portal-v2/layout.tsx` |
| Portal stage client | `app/portal-stage/portal-stage-client.tsx` | `app/portal-stage/layout.tsx` |

Portal layouts use **separate fonts/CSS** — not `retroverse-public.css` surface.

## 5.6 Ops / internal navigation

| System | Path |
|--------|------|
| `ops-header-tabs.tsx` | `app/components/ops-header-tabs.tsx` |
| Integrity explorer | `app/integrity/integrity-explorer.tsx` |
| Dev index grouped links | `app/dev-index/page.tsx` |

## 5.7 Hidden / non-transport routes still linked from TOC or dev-index

Examples from `site-toc.ts` `indexToolsNav`:

- `/track-curator`
- `/relationship-workspace`
- `/internal/curator`
- `/portal-v2/curate`
- `/dev-index`
- `/retroverse-archive`
- `/chart-inspector`

## 5.8 What does NOT exist

| Expected pattern | Found |
|------------------|-------|
| `bottom-nav` filename | **No files** |
| Root `components/` directory | **No** — UI under `app/components/` |
| Global header link row in `app/layout.tsx` | **No** — only top chrome + transport deck |

---

# 6. DUPLICATE STRUCTURE REPORT

## 6.1 Duplicated apps (full trees)

| Pair | Relationship |
|------|--------------|
| `retroverse-welcome-clean` ↔ `retroverse-welcome-clean2` | **Identical** `app/` and `lib/` at audit (`diff -rq` → no diffs) |
| `retroverse-welcome` ↔ clean/clean2 | **Fork drift** — main has 14+ routes and 13+ APIs added since May 11 |
| `retroverse_welcome` | **Not a duplicate** — empty stub |

## 6.2 Duplicated portal systems (main app)

| Route prefix | Files | Purpose overlap |
|--------------|-------|-----------------|
| `/portal` | `app/portal/*` (7+ files) | Original immersive portal |
| `/portal-v2` | `app/portal-v2/*` (10+ files) | Second portal generation + curate |
| `/portal-stage` | `app/portal-stage/*` | Staging shell |

All three: separate layouts, fonts, nav — **not unified**.

## 6.3 Duplicated retroscope systems (main app)

| Route | Layout CSS | Mode |
|-------|------------|------|
| `/album-retroscope` | `album-retroscope.css` + overlays | Primary product |
| `/artist-retroscope` | `artist-retroscope/layout.tsx` | Artist year × rank |
| `/track-retroscope` | `track-retroscope/layout.tsx` | Hot 100 stub |
| `/retroverse_v3` | `retroverse_v3/layout.tsx` | Experimental machine |

Plus **redirect aliases:** `/discover`, `/viewer` → album retroscope.

## 6.4 Duplicated chart / track browse

| Surface | Path |
|---------|------|
| Track Deck (canonical) | `/track-deck` |
| Legacy tracks index | `/tracks` → redirects to track-deck |
| Chart inspector (internal) | `/chart-inspector` |
| Chart-run on album | `/albums/[slug]/chart-run` |

## 6.5 Duplicated discover feed code

| File | Status |
|------|--------|
| `app/discover/discover-feed-client.tsx` | Active shell path |
| `app/discover/discover-feed-client.legacy.tsx` | Legacy duplicate |
| `app/discover/discover-feed-shell.tsx` | Wrapper |

## 6.6 Duplicated styles / layout surfaces

| Surface | CSS entry |
|---------|-----------|
| Public product | `app/globals.css`, `app/retroverse-public.css` |
| Album retroscope | `app/album-retroscope/album-retroscope.css` |
| Portal | `app/portal/*` + portal fonts |
| Portal v2 | `app/portal-v2/v2.css` |
| Portal stage | `app/portal-stage/portal-stage.css` |
| Integrity | `app/integrity/explorer.css` |
| Album dossier | `app/albums/album-dossier.css` |

## 6.7 Duplicated Vercel project links

Three folders → one `prj_oxhn595udDtufp6wudx4D2NaePyA`. Deploying from wrong folder = duplicate deployment target confusion.

## 6.8 Duplicated documentation (pre-existing)

Multiple audits in `docs/` overlap this report:

- `docs/retroverse-route-map.md` (partially stale on header nav)
- `docs/retroverse_system_audit.md`
- `docs/retroverse_system_architecture_audit.md`
- `docs/retroverse_consistency_audit.md`

This file is the **structural multi-app** authority; older docs remain valid for subsystem detail.

---

# 7. RECOMMENDED CANONICAL APP

## 7.1 Single surviving app

**`/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome`**

| Criterion | Why |
|-----------|-----|
| Active development | Commits 2026-05-21; track-deck, VDJ ingest, retroscope |
| GitHub production repo | `bobhopp-crypto/retroverse-welcome` |
| Localhost | `npm run dev` runs here |
| Route completeness | 43 pages, 30 APIs vs 29/17 in clean |
| Navigation source of truth | `transport-nav.ts`, `site-toc.ts` |
| Cursor workspace | Opened here |

## 7.2 Archival / stale — do not use for dev or deploy

| Folder | Action |
|--------|--------|
| `retroverse-welcome-clean` | **Archive** — local May-11 snapshot; remove from deploy workflow; keep untouched until explicit delete |
| `retroverse-welcome-clean2` | **Archive** — GitHub baseline only; do not link Vercel CLI here |
| `retroverse_welcome` | **Delete candidate** — empty stub; zero value |

## 7.3 Temporary untouched

| Item | Reason |
|------|--------|
| clean / clean2 on disk | Historical reference until Bob confirms delete |
| Legacy routes (`/discover`, `/viewer`, `/tracks`) | Redirects prevent breakage; remove in phased rebuild |
| Portal triple (`/portal`, `/portal-v2`, `/portal-stage`) | Ops/curator may still depend — freeze, don't expand |

## 7.4 Do NOT treat as canonical

- Any deploy from `retroverse-welcome-clean*` (stale route tree)
- `retroverse_welcome` stub
- `RETROVERSE_v2/docs/` or `deploy/` (empty — not app docs; real docs live in app `docs/`)

---

# 8. SAFE STABILIZATION PLAN

## Phase 0 — Freeze (no code moves)

1. **Declare canonical path** (team rule): all dev + Git push + Vercel Git deploys = `apps/retroverse-welcome` only.
2. **Unlink stale Vercel CLI folders:** remove or ignore `.vercel/` in `retroverse-welcome-clean` and `retroverse-welcome-clean2` (or delete those folders from disk after backup).
3. **Verify Vercel dashboard:** Project `retroverse-welcome` → Git repository = `bobhopp-crypto/retroverse-welcome`, root directory = `.` (repo root).
4. **Single dev server:** always `cd apps/retroverse-welcome && npm run dev`; kill port 3000 before switching experiments.

**Checkpoint:** `lsof -i :3000` shows one `next-server`; `http://localhost:3000/dev-index` lists all current routes.

## Phase 1 — Deployment stabilization

1. Never run `vercel deploy` from `clean` or `clean2`.
2. Add a one-line `DEPLOY.md` at repo root stating canonical folder (documentation only — optional).
3. Confirm production URL serves routes only in main (e.g. `/track-deck`, `/album-retroscope` return 200; if 404, wrong deploy root).

**Checkpoint:** Production has `/track-deck` and `/album-retroscope`; clean lacks these routes.

## Phase 2 — Routing stabilization (page-by-page rebuild prep)

1. Use **`/dev-index`** and **`/toc`** as live inventories (already maintained in main).
2. **Redirect map** — treat as frozen contract:
   - `/tracks` → `/track-deck`
   - `/discover`, `/viewer` → `/album-retroscope`
   - `/index` → `/site-index`
3. **Mark deprecated in dev-index only** (no route deletes yet): `PRIMARY_NAV`, portal v1, `discover-feed-client.legacy.tsx`.
4. **Navigation rule:** new pages must register in `lib/transport-nav.ts` OR `TRANSPORT_EXCLUDED_PREFIXES` — no third nav system.

**Checkpoint:** No new routes added without TOC/dev-index entry.

## Phase 3 — Architecture freeze for rebuild

1. **One transport layer:** `RetroverseTransportDeck` + `transport-nav.ts`.
2. **One retroscope product path:** `/album-retroscope` (artist/track modes as sub-chambers, not new top-level brands).
3. **One charts path:** `/track-deck` only.
4. **Portal:** pick **portal-v2** as sole curate shell; freeze v1/stage.
5. **Page-by-page rebuild order (suggested):**
   - `/` home search
   - `/track-deck`
   - `/albums/[slug]`
   - `/album-retroscope`
   - `/artists/[slug]`
   - then ops/internal

## Phase 4 — Cleanup (only after Phases 0–3 stable)

| Target | When |
|--------|------|
| Delete `apps/retroverse_welcome` | Immediately safe (stub) |
| Archive `retroverse-welcome-clean*` to external disk or tag in git | After 2 weeks no accidental deploy |
| Remove legacy redirects | After replacement pages ship |
| Consolidate portal trees | After curator flows migrated to portal-v2 |

---

## Appendix A — Config file index (main app)

| File | Path |
|------|------|
| package.json | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/package.json` |
| next.config.ts | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/next.config.ts` |
| middleware.ts | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/middleware.ts` |
| tsconfig.json | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/tsconfig.json` |
| eslint | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/eslint.config.mjs` |
| env (local, not committed) | `.env.local` expected at project root |
| Supabase migrations | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/supabase/migrations/` |
| Integrity SQL | `/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/integrity_console/sql/` |

## Appendix B — Git remotes summary

| Folder | Remote |
|--------|--------|
| retroverse-welcome | `https://github.com/bobhopp-crypto/retroverse-welcome.git` |
| retroverse-welcome-clean | *(none)* |
| retroverse-welcome-clean2 | `https://github.com/bobhopp-crypto/retroverse-welcome-clean2.git` |
| retroverse_welcome | *(none)* |

## Appendix C — Audit methodology

- Filesystem listing: `ls`, `find`, `stat`, `du`
- Route extraction: `find app -name page.tsx`
- Route diff: `comm` on sorted route lists
- Git: `git remote -v`, `git log -1`
- Config: read `.vercel/project.json`, `package.json`, `next.config.ts`, `middleware.ts`
- Process: `lsof -i :3000`, terminal session metadata
- Subagent read-only scans of each app tree
- **No** file modifications except this report

---

*End of structural audit.*
