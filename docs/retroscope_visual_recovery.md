# Retroscope Visual Recovery

**Date:** 2026-05-21  
**Type:** Safe visual recovery (layout body class only)  
**Reference:** `docs/retroscope_recovery_audit.md`

---

## Summary

Removed `arv-structure-strip` from all three Retroscope route layouts. Kept `arv-body-lock`. No CSS, routing, navigation, data, playhead, or grid logic changes.

**Effect:** Full instrument styling in `album-retroscope.css` (bezel, plastic, portal glass, screws, cover thumbs, viewport glow) is active again.

---

## Changes

| File | Before | After |
|------|--------|-------|
| `app/album-retroscope/layout.tsx` | `arv-body-lock arv-structure-strip` | `arv-body-lock` |
| `app/artist-retroscope/layout.tsx` | `arv-body-lock arv-structure-strip` | `arv-body-lock` |
| `app/track-retroscope/layout.tsx` | `arv-body-lock arv-structure-strip` | `arv-body-lock` |

**Mechanism:** `BodyClassName` → `document.body.classList.add(...className.split(" "))` (fixed earlier).

**Untouched (per scope):**

- `app/album-retroscope/album-retroscope.css` — no edits; structure-strip rules remain but are inactive without body class
- `app/tracks/track-page-body.tsx` — still lists `arv-structure-strip` (track **detail** page, not Retroscope routes)
- All routes, nav, charts, client logic, playhead, grid sizing

---

## Verification

| Check | Result |
|-------|--------|
| `/album-retroscope` HTTP | **200** |
| `/artist-retroscope` HTTP | **200** |
| `/track-retroscope` HTTP | **200** |
| Routing changed | **No** |
| Navigation / transport config | **No** |
| `album-retroscope.css` edited | **No** |
| Body class runtime (`InvalidCharacterError`) | **N/A** — single class `arv-body-lock` only |

**Visual checkpoint (browser):** Reload `/album-retroscope` — expect plastic device face, portal rim/glass, amber viewport, album thumbs in grid cells (not flat `#121110` skeleton).

---

## Rollback

Re-add `arv-structure-strip` to the three layout `BodyClassName` `className` strings to return to stripped skeleton mode.

---

*Recovery pass complete.*
