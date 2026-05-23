# Retroscope side controls restore

## Source commit

`76205744` — *Refine Retroscope mobile layout and compact utility rails* (2026-05-20)

Approved layout:

```
[Back][Curator][Map] | LARGE COVER | [Albums][Artists][Charts]
```

## Files changed

| File | Action |
|------|--------|
| `app/album-retroscope/retroscope-utility-rail.tsx` | Restored from `76205744` (`arv-utility-*`, SVG icons, left/right rails) |
| `app/album-retroscope/album-retroscope-client.tsx` | Portal `arv-hero-stage` + dual `RetroscopeUtilityRail`; legacy meta/strip; orient band + year lane from commit |
| `app/album-retroscope/album-retroscope.css` | Inserted mobile-instrument block (hero stage, utility rails, orient/year-lane rules); mobile hide for `arv-meta--legacy` / `arv-strip--legacy`; bootstrapping/orienting selectors updated to `--legacy` |

## What was restored

- **`retroscope-utility-rail.tsx`** — exact file from `76205744`
- **Portal structure** — `arv-hero-stage` grid: left rail → `arv-portal-bezel` (centered cover) → right rail
- **Side controls** — Exit/Curator/Map (left), Albums/Artists/Charts (right); removed standalone `arv-back` Exit link and `RetroscopeModeStrip` from the strip (modes live on the right rail again)
- **CSS** — `.arv-hero-stage`, `.arv-utility-rail`, `.arv-utility-btn`, `.arv-utility-label`, modifiers, and orient/year-lane rules from the commit’s mobile-instrument block
- **Supporting client** — `retroscopeChartLabel()`, `arv-meta--legacy`, `arv-strip--legacy`, `section.arv-orient` markup (year lane nudges)

## Preserved (not reverted)

- **`arv-body-lock` only** on album/artist/track Retroscope layouts — `arv-structure-strip` not reintroduced
- **Playhead / viewport pan** — `playheadGrid` + `panViewportToIncludeActive` unchanged
- **Square grid cells** — recent `aspect-ratio` / reticle-in-grid work kept
- **`body-class-name.tsx`** — `classList.add/remove(...split(" "))` (no DOMTokenList `InvalidCharacterError`)
- **Orientation tour overlay** — meta band CSS uses `section.arv-orient { display: none }` instead of `.arv-orient` so the tour’s `div.arv-orient` fixed overlay is not hidden

## What was not touched

- Charts routes, chart data, or chart UI
- Database / Supabase / ingest scripts
- Global navigation (`lib/retroverse-nav.ts`, transport, site TOC)
- Retroscope route files (`app/album-retroscope/page.tsx`, etc.) — same URLs
- `body.arv-structure-strip { … }` block left in CSS but inactive (no layout applies it)
- `retroscope-mode-strip.tsx` — file remains; no longer wired in the Retroscope client

## Verification (local, `npm run dev` on port 3000)

| Check | Result |
|-------|--------|
| `GET /album-retroscope` | **200** |
| `GET /artist-retroscope` | **200** |
| `GET /track-retroscope` | **200** |
| HTML contains `arv-hero-stage` | yes |
| HTML contains `arv-utility-rail` / `arv-utility-btn` | yes (6 side buttons + 2 rails) |
| Body class on Retroscope pages | `arv-body-lock` only (no `arv-structure-strip`) |
| DOMTokenList / body class split | safe (`BodyClassName` splits on spaces) |
| Chart route files | unchanged in this restore |

## Note on mobile meta band

In `76205744`, the compact `section.arv-orient` meta band was shown on mobile only when `body.arv-structure-strip` was present. With structure-strip intentionally off, mobile shows portal (with 3+3 rails) + viewport; legacy meta/strip stay hidden via existing `@media (max-width: 767px)` rules. Re-enable the orient band on mobile later only if structure-strip returns or equivalent unscoped rules are approved.
