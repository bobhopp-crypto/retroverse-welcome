# Retroscope Recovery Audit

**Date:** 2026-05-21  
**Scope:** `apps/retroverse-welcome` (canonical app only)  
**Type:** Read-only forensic inspection — no code changes, no deploys

**Related audits:** `docs/retroverse_structural_audit.md`, `docs/phase0_stabilization_check.md`, `docs/retroverse-route-map.md`

---

## Executive summary

| Question | Finding |
|----------|---------|
| How many Retroscope implementations? | **3 active routes** share **1 client**; **1 parallel experiment** (`/retroverse_v3`); **2 legacy redirects**; **1 archived Discover feed** (not Retroscope) |
| What renders today for “Retroscope” nav? | **`/album-retroscope`** (transport deck + mode strip default) |
| Wrong redirect? | **No** — `/discover` and `/viewer` correctly land on `/album-retroscope`. Docs claiming `/` → Retroscope are **stale**. |
| Why it looks different from “approved”? | **`arv-structure-strip` body class** (May 20) strips the plastic instrument chrome; plus interaction changes (center-lock → moving playhead, square grid sizing, mode-strip deck variant) |
| Original intact? | **Yes** — full styling still exists in `album-retroscope.css` under default `.arv-*` rules; suppressed by `body.arv-structure-strip` |
| Recoverable without rebuild? | **Likely yes** — toggle layout body class and/or CSS scope; client logic and data pipeline are intact |

---

# 1. ALL RETROSCOPE ROUTES

## 1.1 Primary Retroscope product (shared client)

| Route | Folder | Page | Layout | Client | Status |
|-------|--------|------|--------|--------|--------|
| `/album-retroscope` | `app/album-retroscope/` | `page.tsx` | `layout.tsx` | `album-retroscope-client.tsx` (`mode="album"`) | **ACTIVE — canonical album layer** |
| `/artist-retroscope` | `app/artist-retroscope/` | `page.tsx` | `layout.tsx` | Same client (`mode="artist"`) | **ACTIVE** |
| `/track-retroscope` | `app/track-retroscope/` | `page.tsx` | `layout.tsx` | Same client (`mode="track"`) | **ACTIVE — stub/placeholder corpus** |

**Route helpers:** `lib/retroscope-mode.ts` → `retroscopeRouteForMode()`

## 1.2 Redirects into album Retroscope

| Route | File | Target | Status |
|-------|------|--------|--------|
| `/discover` | `app/discover/page.tsx` | `redirect("/album-retroscope")` | **LEGACY alias — correct** |
| `/viewer` | `app/viewer/page.tsx` | `redirect("/album-retroscope")` | **LEGACY alias — correct** |
| `/random` | `app/random/page.tsx` | Weighted jump; fallback `"/album-retroscope"` | **ACTIVE** (partial redirect) |

## 1.3 Parallel / experimental (separate implementation)

| Route | Folder | Implementation | Status |
|-------|--------|----------------|--------|
| `/retroverse_v3` | `app/retroverse_v3/` | `retroverse-v3-machine.tsx` + `retroverse-v3.css` | **EXPERIMENTAL** — different grid model (5×6 depth bands, trails/occupancy) |

## 1.4 NOT Retroscope (often confused)

| Route | Why listed | Status |
|-------|------------|--------|
| `/` | Home = `ask-retroverse-client.tsx` search front door | **NOT Retroscope** (docs `retroverse_system_map.md` incorrectly say redirect → Retroscope) |
| `/eras/[slug]` | Uses `discover-feed-shell.tsx` / Discover feed | **Separate UI** |
| `/portal`, `/portal-v2`, `/portal-stage` | Year×album portal shells | **Separate UI** (links to curator, not grid) |
| `/track-deck` | Hot 100 charts | **Separate UI** (transport label “Charts”) |

## 1.5 Archived / dead code (on disk, not routed)

| Path | Status |
|------|--------|
| `app/discover/discover-feed-client.legacy.tsx` | **ARCHIVED** — comment: not imported |
| `app/album-retroscope/retroscope-utility-rail.tsx` | **DEAD** — exported, **never imported** (orphan from reverted mobile-rail work) |

---

# 2. ACTIVE RENDER CHAIN

## 2.1 Default public entry: `/album-retroscope`

```
app/layout.tsx                          (root — always wraps all pages)
├── globals.css
├── retroverse-public.css
├── RetroverseRouteTuner                (client overlay; labels /album-retroscope as "Retroscope")
├── RetroverseTopChrome                 (hidden when body.arv-body-lock)
├── <main>
│   └── app/album-retroscope/layout.tsx
│       ├── BodyClassName               → body classes: arv-body-lock arv-structure-strip
│       ├── album-retroscope.css        (import)
│       └── arv-route-shell
│           └── app/album-retroscope/page.tsx (RSC, force-dynamic)
│               ├── loadAlbumRetroscopeDataset()  ← lib/load-album-retroscope-dataset.ts
│               └── arv-root
│                   └── AlbumRetroscopeClient   ← album-retroscope-client.tsx (default export RetroscopeClient)
│                       ├── retroscope-mode-strip.tsx
│                       ├── retroscope-hero.tsx (HeroAlbumFocus | HeroArtistSignal | HeroTrackStub)
│                       ├── retroscope-map-overlay.tsx (conditional)
│                       ├── retroscope-orientation-overlay.tsx (conditional)
│                       └── arv-machine DOM (portal, meta, D-pad, viewport grid)
└── RetroverseTransportDeck             (hidden when body.arv-body-lock)
```

## 2.2 Artist / track chains

Identical to album except:

| Step | Album | Artist | Track |
|------|-------|--------|-------|
| Dataset loader | `lib/load-album-retroscope-dataset.ts` | `lib/load-artist-retroscope-dataset.ts` | `lib/load-track-retroscope-dataset.ts` |
| CSS import path | `./album-retroscope.css` | `../album-retroscope/album-retroscope.css` | same |
| Body classes | `arv-body-lock arv-structure-strip` | same | same |
| Client `mode` | `"album"` | `"artist"` | `"track"` |

## 2.3 Data / session utilities (render support)

| Module | Role |
|--------|------|
| `lib/album-retroscope-constants.ts` | Grid bounds, cell keys |
| `lib/album-retroscope-data.ts` | Re-exports |
| `lib/album-retroscope-seed.ts` | Seed schema |
| `lib/retroscope-coordinates-schema.ts` | Coordinates JSON shape |
| `lib/retroscope-bootstrap.ts` | Initial coordinate + viewport bootstrap |
| `lib/retroscope-persist-session.ts` | localStorage session, explored keys, viewport pan |
| `lib/retroscope-orientation.ts` | First-run tour dismiss |
| `lib/retroscope-mode-persist.ts` | Preferred mode (album/artist/track) |
| `lib/canonical-artwork-overrides.ts` | Cover overrides in cells |
| `public/data/retroscope/retroscope-coordinates.json` | Bundled corpus |
| `public/data/retroscope/retroscope-universe.json` | Universe metadata |
| `data/album-retroscope-seed.json` | Fallback seed |
| `scripts/publish-retroscope-runtime.mjs` | Publish pipeline (ops) |

## 2.4 `/retroverse_v3` chain (separate)

```
app/layout.tsx
└── app/retroverse_v3/layout.tsx
    └── retroverse-v3.css
    └── page.tsx → loadOccupancyBundle() → RetroverseV3Machine
```

No shared components with `album-retroscope-client.tsx`.

---

# 3. STYLE / WRAPPER CHANGES

## 3.1 Body classes (highest impact)

| Class | Applied by | Effect |
|-------|------------|--------|
| `arv-body-lock` | All three Retroscope `layout.tsx` via `BodyClassName` | `position: fixed` body; hides scroll; **hides** `.rv-top-chrome` and `.rv-transport-deck`; zeros main padding |
| `arv-structure-strip` | Same layouts (added **2026-05-20** commit `d55fa945`) | Activates ~240 lines of **subtraction CSS** — strips plastic device, portal glass, screws, LED, scan lines, hero atmosphere |

**Before `d55fa945`:** layouts used `arv-body-lock` only.  
**After `d55fa945`:** `arv-body-lock arv-structure-strip` — **this is the largest visual delta vs “full instrument” design.**

## 3.2 Layout wrappers

| Wrapper | Path | Role |
|---------|------|------|
| `arv-route-shell` | Retroscope layouts | Fixed full-viewport shell |
| `arv-root` | `page.tsx` | Plastic / dark surface container |
| `arv-machine` | Client | Grid areas: chrome, portal, meta, strip, viewport |

## 3.3 Global CSS inheritance

| Stylesheet | Loaded by | Affects Retroscope? |
|------------|-----------|-------------------|
| `app/globals.css` | Root layout | Base tokens |
| `app/retroverse-public.css` | Root layout | Public surface vars (`--bg-main`, etc.) |
| `app/album-retroscope/album-retroscope.css` | Retroscope layout | **Primary** — 2800+ lines |
| `app/styles/retroverse-mobile-immersion.css` | **Imported at top of** `album-retroscope.css` | Mobile tweaks (shared patterns) |

Retroscope does **not** use `album-dossier.css` or portal CSS.

## 3.4 Navigation overlays

| Component | Visible on Retroscope? |
|-----------|------------------------|
| `RetroverseTransportDeck` | **No** (CSS `display: none` under `arv-body-lock`) — still mounted in DOM |
| `RetroverseTopChrome` | **No** (same) |
| `RetroverseRouteTuner` | **Yes** — brief “Retroscope” chamber label on route change (internal overlay) |
| `RetroscopeModeStrip` | **Yes** — in-machine layer switcher (Albums / Artists / Tracks / Map) |
| `RetroscopeOrientationOverlay` | **Yes** — first-run tour (`f1c44b50`) |

## 3.5 Structure-strip: what it removes (specific)

From `album-retroscope.css` § `STRUCTURE STRIP` (~line 2585+):

- Device plastic gradients, screws, vents, LED
- Portal rim, glass, scan animation
- Viewport label “Coordinate Bay”, meta/strip plate labels
- Hero bloom/glyph/atmo effects
- Cell cover thumbnails on active cell (structure mode uses flat `#121110` cells)
- D-pad plastic styling → flat buttons

**The approved “solid-state handheld” look lives in the default `.arv-*` rules above this block; structure-strip overrides it.**

## 3.6 Recent interaction/CSS changes (session, not in git snapshot)

Per current tree (may post-date last commit):

- **Playhead:** `panViewportToIncludeActive` — playhead moves cell-to-cell; viewport pans at edges (replaces center-lock-only behavior from `761d8f9b`)
- **Grid cells:** `aspect-ratio: 1` + container-query sizing — square tiles; reticle moved inside `.arv-grid`
- **`body-class-name.tsx`:** `classList.add(...split(' '))` — fixes `arv-body-lock arv-structure-strip` application

---

# 4. VISUAL DIFFERENCE ANALYSIS

## Why current Retroscope does not match the previously approved version

### A. Structure-strip mode is ON by default (primary cause)

All Retroscope layouts apply **`arv-structure-strip`**. That was introduced explicitly to “strip Retroscope to core interaction structure” (`d55fa945`, 2026-05-20). The approved design (commits `ea62e78c`, `e09feb76`, earlier May work) assumed the **full plastic instrument** presentation: bezel, portal glass, screws, amber/electric glow, cover thumbs in grid.

**Today:** flat dark skeleton (`#0e0c0a`, `#121110` cells), minimal portal, no glass — by design of structure-strip, not data loss.

### B. Center-lock playhead era vs moving playhead

Commit `761d8f9b` (2026-05-19) locked the reticle to the grid center and scrolled world coordinates underneath. That changed how navigation **felt** vs a moving selection cursor. Current code uses **edge-pan + moving active cell** (post-audit fix). Either mode differs from early prototypes.

### C. Reverted but attempted refactors

Git shows **reverted** branches that still explain drift:

| Commit | Intent | Status |
|--------|--------|--------|
| `941a998e` | Rebuild interaction hierarchy around time navigation | **Reverted** |
| `76205744` | Refine mobile layout and compact utility rails | **Reverted** |

Orphan `retroscope-utility-rail.tsx` remains from that line of work.

### D. Square grid constraint (recent)

Grid no longer stretches cells to fill viewport height (`gridTemplateRows: 1fr` removed). Square cells + centered grid change proportions vs stretched rectangular cells in the approved mock.

### E. Navigation consolidation

`31ad4d44` — unified transport deck; Retroscope uses bottom nav href `/album-retroscope` but hides deck on route. Not a visual bug, but product framing shifted (home is search, not Retroscope).

### F. Redirects are NOT the problem

| Entry | Actual behavior | Wrong? |
|-------|-----------------|--------|
| Transport “Retroscope” | `/album-retroscope` | No |
| `/discover` | `/album-retroscope` | No |
| `/viewer` | `/album-retroscope` | No |
| `/` | `/` home search | No (stale docs only) |

Users hitting `/discover` or `/viewer` **do** reach the canonical Retroscope client.

### G. Documentation drift (confusion, not routing)

- `docs/retroverse_system_map.md` says `/` and `/discover` redirect to Retroscope — **false** vs current `app/page.tsx` and `app/discover/page.tsx`.
- `docs/retroverse-route-map.md` still references `PRIMARY_NAV` in root layout — **stale** (transport deck replaced header nav).

---

# 5. MOST LIKELY ORIGINAL / APPROVED VERSION

## 5.1 Candidate: pre–structure-strip album Retroscope

| Attribute | Value |
|-----------|-------|
| **Route** | `/album-retroscope` (same as today) |
| **Component** | `album-retroscope-client.tsx` (same file, evolved) |
| **CSS** | `album-retroscope.css` **without** `body.arv-structure-strip` active |
| **Layout** | `BodyClassName className="arv-body-lock"` only (parent of `d55fa945`) |
| **Git anchor** | `ea62e78c` — “Ship RetroScope as primary surface with P0 stabilization” (2026-05-16) |
| **Intact?** | **Yes** — full rules still in CSS file, conditionally disabled |
| **Recoverable?** | **Yes, low risk** — remove `arv-structure-strip` from three layout.tsx body classes (inspection-only note: do not do in this audit) |

This is the **same route and client** as today; recovery is **visual mode toggle**, not archeology of a deleted app.

## 5.2 Secondary candidate: `/retroverse_v3`

| Attribute | Value |
|-----------|-------|
| **Nature** | Separate experiment — trails, occupancy, 5-column temporal grid |
| **Relation to approved album Retroscope** | **Different product metaphor** — not the handheld 7×N album grid |
| **Status** | Still routable; not linked from transport deck |

Unlikely to be the “approved” Retroscope Bob refers to unless approval predated the album-retroscope ship.

## 5.3 Not the approved Retroscope

| Artifact | Why |
|----------|-----|
| `discover-feed-client.legacy.tsx` | Magazine-style discover feed |
| Portal v1/v2 viewer | Album carousel / year navigation |
| `retroverse-welcome-clean*` stale apps | May lack Retroscope routes entirely (May 11 snapshot) |

## 5.4 Recovery options (forensic only — not executed)

| Option | Effort | Outcome |
|--------|--------|---------|
| Remove `arv-structure-strip` from layouts | Minimal | Restores full plastic instrument CSS |
| Feature flag body class | Minimal | A/B full vs strip |
| `git checkout d55fa945^ -- app/album-retroscope/layout.tsx` | Low | Same as above for layouts only |
| Revert client to `761d8f9b` center-lock | Medium | Old navigation feel; may conflict with square grid |
| Rebuild from clean app folder | High | **Not needed** — canonical app has full history |

---

# 6. FILE INVENTORY (canonical app)

## Routes & pages

- `app/album-retroscope/page.tsx`
- `app/artist-retroscope/page.tsx`
- `app/track-retroscope/page.tsx`
- `app/discover/page.tsx` (redirect)
- `app/viewer/page.tsx` (redirect)
- `app/retroverse_v3/page.tsx`

## Layouts

- `app/album-retroscope/layout.tsx`
- `app/artist-retroscope/layout.tsx`
- `app/track-retroscope/layout.tsx`
- `app/retroverse_v3/layout.tsx`
- `app/layout.tsx` (root wrapper)

## Components

- `app/album-retroscope/album-retroscope-client.tsx` (**single machine**)
- `app/album-retroscope/retroscope-hero.tsx`
- `app/album-retroscope/retroscope-mode-strip.tsx`
- `app/album-retroscope/retroscope-map-overlay.tsx`
- `app/album-retroscope/retroscope-orientation-overlay.tsx`
- `app/album-retroscope/retroscope-utility-rail.tsx` (**orphan**)
- `app/retroverse_v3/retroverse-v3-machine.tsx`
- `app/components/body-class-name.tsx`

## Stylesheets

- `app/album-retroscope/album-retroscope.css` (**2832 lines**)
- `app/retroverse_v3/retroverse-v3.css`
- `app/styles/retroverse-mobile-immersion.css` (imported)

## Lib utilities

- `lib/retroscope-mode.ts`
- `lib/retroscope-mode-persist.ts`
- `lib/retroscope-bootstrap.ts`
- `lib/retroscope-persist-session.ts`
- `lib/retroscope-orientation.ts`
- `lib/retroscope-coordinates-schema.ts`
- `lib/load-album-retroscope-dataset.ts`
- `lib/load-artist-retroscope-dataset.ts`
- `lib/load-track-retroscope-dataset.ts`
- `lib/album-retroscope-constants.ts`
- `lib/album-retroscope-seed.ts`
- `lib/album-retroscope-data.ts`

## Redirect / nav references

- `lib/transport-nav.ts` → `/album-retroscope`
- `lib/retroverse-nav.ts` → `/album-retroscope` (deprecated PRIMARY_NAV)
- `lib/site-toc.ts` → retroscope entries
- `app/dev-index/page.tsx` → route checklist

---

# 7. GIT TIMELINE (Retroscope-relevant)

| Date (approx) | Commit | Summary |
|---------------|--------|---------|
| 2026-05-16 | `ea62e78c` | Ship RetroScope primary + album/artist/track modes |
| 2026-05-19 | `761d8f9b` | Fixed center playhead, scrolling field |
| 2026-05-20 | `d55fa945` | **Add `arv-structure-strip`** — strip chrome |
| 2026-05-20 | `941a998e` / revert | Interaction hierarchy experiment (reverted) |
| 2026-05-20 | `76205744` / revert | Mobile utility rails (reverted) |
| 2026-05-21 | `31ad4d44` | Unified transport deck |

---

# 8. CONCLUSIONS

1. **One true Retroscope UI** lives at `/album-retroscope` (+ artist/track mode routes), implemented by `album-retroscope-client.tsx`.
2. **Redirects are correct** for legacy `/discover` and `/viewer`; they are not sending users to the wrong implementation.
3. **The approved visual design is almost certainly still in the repo**, suppressed by **`arv-structure-strip`**, not deleted.
4. **`/retroverse_v3`** is a separate experiment and should not be treated as the production Retroscope recovery target unless explicitly intended.
5. **Recovery without rebuild:** toggle off structure-strip first, then evaluate playhead/grid tweaks against approval reference.

---

*Forensic audit only. No fixes applied.*
