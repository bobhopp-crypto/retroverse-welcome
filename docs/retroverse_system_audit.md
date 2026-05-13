# Retroverse Traversal + Architecture Audit

Date: 2026-05-07  
Scope: operational map only (no fixes)

## 1) Route Inventory

| Route | Static / Dynamic | Primary Purpose | Actual Data Source | Current Status |
|---|---|---|---|---|
| `/` | Static | Landing + entry points | UI components + `welcome_interest` API integration | fully functional |
| `/welcome` | Static | Alias of `/` | re-export of `app/page.tsx` | fully functional |
| `/week` | Static | Curated "this week" narrative | hardcoded content | placeholder |
| `/eras` | Static | Era index | `data/eras.json` via `lib/eras.ts` | fully functional |
| `/eras/[slug]` | SSG (dynamic params) | Era archive detail | `data/eras.json` via `getEraBySlug()` | fully functional |
| `/eras/1974-1977` | Dynamic (`force-dynamic`) | Canonical era experience page | Supabase `retroverse_*` tables + featured constants | partial |
| `/artists` | Dynamic (`force-dynamic`) | Artist archive/search index | Supabase `retroverse_artists`, `retroverse_tracks`, `retroverse_album_artist_roles` | fallback-driven |
| `/artists/bee-gees` | Dynamic (`force-dynamic`) | Canonical artist detail | Supabase `retroverse_*` tables | fully functional |
| `/albums` | Dynamic (`force-dynamic`) | Album archive/search browser | Supabase `retroverse_albums`, `retroverse_artists`, `retroverse_eras`, `retroverse_album_editions`, `retroverse_album_artwork` | fallback-driven |
| `/albums/saturday-night-fever` | Dynamic (`force-dynamic`) | Canonical album detail | Supabase `retroverse_*` tables | fully functional |
| `/albums/rumours` | Dynamic (`force-dynamic`) | Canonical album detail | Supabase `retroverse_*` tables | fully functional |
| `/albums/eagles-their-greatest-hits-1971-1975` | Dynamic (`force-dynamic`) | Canonical album detail | Supabase `retroverse_*` tables | fully functional |
| `/tracks` | Dynamic (`force-dynamic`) | Track archive/search index | Supabase `retroverse_tracks` | fully functional |
| `/tracks/[id]` | Dynamic (`force-dynamic`) | Canonical track graph detail | Supabase `retroverse_*` + lineage/pathway utilities | partial |
| `/random` | Dynamic (`force-dynamic`) redirect | Weighted graph traversal jump | Supabase entity counts + routing helpers | fully functional |
| `/api/welcome-interest` | Dynamic API | Email/feedback ingest | Supabase `welcome_interest` insert | partial |

Notes:
- No confirmed hard-broken app routes in current sweep.
- Fallback-driven means destination quality depends on archive search results rather than dedicated entity pages.

## 2) Entity Resolution Map

### Artists
- Canonical identity in data layer: `retroverse_artist_id`.
- UI route resolution: `artistRoute(name)` in `lib/retroverse-routes.ts`.
  - featured: `"Bee Gees"` -> `/artists/bee-gees`
  - fallback: `/artists?q=<artist name>`
- 404 behavior:
  - `/artists/bee-gees`: only dedicated artist page.
  - Any other `/artists/<slug>` path: 404 (no dynamic artist route).
- Dead-end origin:
  - Not hard dead-end now; non-featured artists land in search index, but depth is limited vs dedicated page.

### Albums
- Canonical identity in data layer: `retroverse_album_id`.
- UI route resolution: `albumRoute(title)` in `lib/retroverse-routes.ts`.
  - featured: 3 mapped album pages.
  - fallback: `/albums?q=<album title>`.
- 404 behavior:
  - `/albums/<unmapped-slug>`: 404 (no dynamic album route).
  - Routed links avoid this by using search fallback.
- Dead-end origin:
  - Search fallback can be thin when no strong linked context exists beyond title match.

### Tracks
- Canonical identity: `retroverse_track_id`.
- `app/tracks/[id]/page.tsx` resolution chain:
  1. direct RVTR id regex (`RVTR######`)
  2. `retroverse_source_matches` suffix match
  3. slugified title scan from `retroverse_tracks` (range 0..5000)
- 404 behavior:
  - unresolved id/slug -> `notFound()`.
- Dead-end origin:
  - Sparse tracks can produce minimal connected context; sections are now conditionally hidden when empty.

### Eras
- Canonical archive era pages:
  - `/eras` + `/eras/[slug]` from `data/eras.json` (`lib/eras.ts`).
  - `/eras/[slug]` prebuilt via `generateStaticParams()`.
- Canonical graph era experience:
  - `/eras/1974-1977` is a separate dynamic page backed by Supabase.
- 404 behavior:
  - unknown `/eras/<slug>` not in `eras.json` -> 404.
- Dead-end origin:
  - Non-1974-1977 era pages are archival/context pages, not graph-dense entity pages.

## 3) Linkage Audit

### Route existence quality
- **Exists + deep surface**
  - Track detail by id, 3 featured album details, Bee Gees artist detail, era pages.
- **Exists but index/search surface**
  - Most artists and most albums (fallback route quality depends on search results).

### Major clickable entities
- **Artist links**
  - now consistently route via `artistRoute()`.
  - featured artist gets detail page; others get search fallback.
- **Album links**
  - now consistently route via `albumRoute()`.
  - featured albums get detail page; others get search fallback.
- **Track links**
  - route directly to `/tracks/<retroverse_track_id>` (strongest continuity layer).
- **Pathway links**
  - generated in `lib/retroverse-pathways.ts` and now use same route helpers for album/artist.
- **Archive objects**
  - albums and artists index objects are clickable with meaningful fallback paths.

### Inconsistencies still present
- Album detail pages contain rich sequencing rows but many track rows are still non-clickable text (continuity gap, not a route break).
- `/albums` and `/tracks` search pages do not provide explicit "no results" messaging (empty-state clarity gap).

## 4) Data Density Status

Current operational counts (queried from current Supabase):
- artists: **42**
- albums: **132**
- tracks: **183**
- chart rows: **141**
- charted tracks: **129**
- non-charted tracks: **54**
- tracks with reuse lineage (`>1` album membership): **15**
- albums with canonical artwork path: **3**

Coverage estimates:
- artwork coverage: **3 / 132 = 2.3%**
- artist profile coverage (dedicated pages): **1 / 42 = 2.4%**
- album detail coverage (dedicated pages): **3 / 132 = 2.3%**
- track detail coverage (route exists by canonical id): **~100% by id**, best-effort by slug/source-key

Data class split (current model):
- real canonical data:
  - artists/albums/tracks: mostly `canonicalized`
  - chart rows: mostly `verified`
- inferred/generated:
  - pathways, adjacency, carry-forward relations (`inferred`)
- editorial:
  - context and cultural role lines (`editorial`)
- sparse entities:
  - majority of albums/artists without dedicated detail surfaces
  - majority of albums without artwork

## 5) UI Surface Classification

### Archive/index surfaces
- `/albums`, `/artists`, `/tracks`, `/eras`
- State:
  - `/albums`: mostly complete, fallback-driven
  - `/artists`: functional but still thin for non-featured entities
  - `/tracks`: functional, text-list style
  - `/eras`: complete archival index

### Entity/detail surfaces
- `/tracks/[id]`, `/albums/{3 featured}`, `/artists/bee-gees`, `/eras/[slug]`, `/eras/1974-1977`
- State:
  - `/tracks/[id]`: partial (good structure, quality depends on entity density)
  - featured album pages: complete for those 3 nodes
  - `/artists/bee-gees`: complete for single artist
  - `/eras/[slug]`: complete archive context, not graph-dense entity detail
  - `/eras/1974-1977`: partial graph-era bridge

### Traversal surfaces
- `/random`, pathway blocks, related sections, archive object links
- State:
  - routing trust improved and coherent
  - still fallback-heavy outside featured entities

### Contextual/editorial surfaces
- track/album/artist/era narrative lines and summaries
- State:
  - generally coherent
  - can feel thin when underlying graph rows are sparse

## 6) Top Product Risks (Current Priority Order)

1. **Traversal trust (medium)**  
   Fallbacks now resolve, but many jumps land in index/search surfaces instead of dedicated entity pages.
2. **Routing integrity (low-medium)**  
   Core route breakage is low; risk remains in manual/direct slug access for unmapped albums/artists.
3. **Readability (medium)**  
   Some surfaces still expose sparse/empty-state behavior without explicit guidance (`/albums` + `/tracks` query misses).
4. **Entity continuity (medium-high)**  
   Limited dedicated artist/album page coverage makes continuity uneven outside featured nodes.
5. **Density gaps (high)**  
   Long-tail entities have shallow context and limited cross-surface richness.
6. **Artwork inconsistency (high data gap, low logic gap)**  
   Resolver logic is consistent, but source coverage is only ~2.3%.
7. **Dead-end exploration (low hard dead-end, medium soft dead-end)**  
   Hard 404 navigation is reduced; soft dead-ends persist where search/index pages are shallow.

## 7) Recommended Next 3 Refinement Passes

1. **Entity Surface Expansion Pass (no schema/backend changes)**  
   Add lightweight dynamic artist/album detail templates (shared components) so fallback search is not the primary destination for most entities.

2. **Traversal Quality Threshold Pass**  
   Suppress low-signal pathway/related items and add strict clickability gating per section to avoid weak loops and shallow circular navigation.

3. **Archive Search Intent Pass**  
   Improve `/albums`, `/artists`, `/tracks` query-result behavior with explicit empty states and richer per-row context so fallback routes feel intentional, not recovery-like.

## Operational Summary

Retroverse is currently **route-stable and navigable**, but still **detail-sparse outside featured entities**.  
Trust is no longer primarily blocked by 404s; it is now blocked by **surface depth asymmetry** (few deep entities, many fallback surfaces).
