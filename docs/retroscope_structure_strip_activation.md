# Retroscope structure-strip activation (Option A)

**Date:** 2026-05-21  
**Source:** `76205744` full presentation (rails + structure-strip CSS)

## What changed

| File | Change |
|------|--------|
| `app/album-retroscope/layout.tsx` | `arv-body-lock arv-structure-strip` |
| `app/artist-retroscope/layout.tsx` | same |
| `app/track-retroscope/layout.tsx` | same |
| `app/album-retroscope/album-retroscope.css` | Restored `76205744` `body.arv-structure-strip` rules for hero-stage, utility rails, orient band (`section.arv-orient`), coordinate bay, mobile grid |

## Effect

- Strips beige plastic chrome (screws, portal glass, scan lines)
- Tightens portal + 3+3 utility rails
- Side rails **stretch to cover height** — three equal `flex: 1` buttons per column (`align-items: stretch` on `arv-hero-stage`)
- Shows mobile orient band (title, year/rank readout, year lane) in `meta` grid area
- Denser coordinate bay (7×5 aspect grid, square cells)

## Preserved

- `76205744` utility rail component + `arv-hero-stage` client wiring
- Playhead pan + square grid client logic (current HEAD)
- Tour overlay: `section.arv-orient` for meta band; `div.arv-orient` for tour unchanged

## Verification

| Route | HTTP |
|-------|------|
| `/album-retroscope` | 200 |
| `/artist-retroscope` | 200 |
| `/track-retroscope` | 200 |

Body class in page: `arv-body-lock arv-structure-strip`

## If still not the remembered UI

Next trial: **`941a998e`** interaction band (no side rails) — see `docs/retroscope_evolution_search.md`.
