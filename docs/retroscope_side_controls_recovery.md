# Retroscope Side Controls Recovery (Forensic)

**Date:** 2026-05-21  
**Type:** Inspection only — no code changes applied  
**Reference:** `docs/retroscope_recovery_audit.md`, `docs/retroscope_visual_recovery.md`

---

## Executive summary

| Question | Answer |
|----------|--------|
| Does the 3+3 side-button layout exist in **current** wired code? | **No** — component file exists but is **orphaned**; portal uses bezel-only layout |
| Which commit had the approved layout? | **`76205744`** — *Refine Retroscope mobile layout and compact utility rails* (2026-05-20) |
| Was it reverted? | **Yes** — `439a4fcf` reverted and deleted wiring + CSS; never fully re-applied |
| Recoverable without rebuild? | **Yes** — restore 3 files/sections from `76205744` into current tree |
| Affects charts / routes / nav? | **No** route or global nav changes; internal links inside rails match that commit |

---

# 1. Does the side-button version still exist in current files?

## 1.1 Wired in current UI — **NO**

Current `/album-retroscope` portal block (`album-retroscope-client.tsx`):

```text
arv-portal
  └── arv-portal-bezel (single column)
        ├── arv-operator-glyph
        ├── arv-portal-rim
        └── arv-hero (cover — swipe to move)
```

**Missing:**

- `arv-hero-stage` wrapper
- `RetroscopeUtilityRail` left × 3
- `RetroscopeUtilityRail` right × 3

Current controls live in **`arv-strip--secondary`** below meta:

- Year / rank readouts
- `RetroscopeModeStrip` (Albums / Artists / Tracks / Map) — **center strip**, not flanking cover

## 1.2 Orphan component on disk — **PARTIAL / MISMATCHED**

| File | Status |
|------|--------|
| `app/album-retroscope/retroscope-utility-rail.tsx` | **Exists (80 lines)** but **not imported** anywhere |
| CSS classes used | `arv-rail`, `arv-rail-btn`, `arv-rail-lbl` |
| CSS rules in `album-retroscope.css` for `arv-rail*` | **None** — grep returns zero matches |

This file is a **truncated stub** (from checkpoint `8a71f3da`), not the full approved implementation.

## 1.3 CSS still present for a **different** control pattern — **NOT side-of-cover**

`album-retroscope.css` still defines:

- `.arv-controls`, `.arv-pad-btn`, `.arv-pad-btn--lr` (tactile D-pad buttons)

**But** `album-retroscope-client.tsx` does **not** render `.arv-controls` (only referenced in touch-scroll allowlist). This was the **older** layout: ← ↑↓ → in the **bottom strip**, not 3+3 flanking the hero.

---

# 2. Git commit that contains the approved layout

## 2.1 Primary commit (matches user description)

| Field | Value |
|-------|-------|
| **Hash** | `762057442282c0d2e0b6c9bc1b0125fc9407ec00` |
| **Short** | `76205744` |
| **Date** | 2026-05-20 11:51:36 -0500 |
| **Message** | Refine Retroscope mobile layout and compact utility rails |
| **Files changed** | `album-retroscope-client.tsx`, `album-retroscope.css`, `retroscope-utility-rail.tsx` (+594 / −115 lines) |

## 2.2 Revert commit (removed it from main line)

| Field | Value |
|-------|-------|
| **Hash** | `439a4fcf` |
| **Message** | Revert "Refine Retroscope mobile layout and compact utility rails" |
| **Effect** | Removed `arv-hero-stage`, utility rail wiring, ~370 lines CSS; **deleted** `retroscope-utility-rail.tsx` |

## 2.3 Partial file resurrection (not wired)

| Field | Value |
|-------|-------|
| **Hash** | `8a71f3da` |
| **Message** | Checkpoint before track instrumentation strip refactor |
| **Effect** | Re-added shortened `retroscope-utility-rail.tsx` (`arv-rail*` classes); **did not** re-wire client or restore CSS |

## 2.4 Related but **not** the 3+3 side layout

| Commit | What it had |
|--------|-------------|
| `59cfd5e9` | Restyle as handheld hardware — **D-pad** in strip (← ↑↓ →), not flanking rails |
| `ea62e78c` | Ship RetroScope P0 — mode strip + portal; no utility rails |
| `e09feb76` | Dossier / analog refresh — earlier hero, no side rails |

---

# 3. Approved layout structure (commit `76205744`)

## 3.1 Portal / cover / side controls

```text
arv-portal
  └── arv-hero-stage                    ← 3-column grid
        ├── RetroscopeUtilityRail (left)
        │     ├── Back
        │     ├── Curator
        │     └── Map
        ├── arv-portal-bezel
        │     └── arv-hero (large square cover, swipe)
        └── RetroscopeUtilityRail (right)
              ├── Albums
              ├── Artists
              └── Charts  → /track-deck
```

- **Large centered cover:** `.arv-hero` with `aspect-ratio: 1`, up to `44dvh` (same sizing rules still in current CSS for `.arv-hero`)
- **Six physical side buttons:** `.arv-utility-btn` with SVG icons + `.arv-utility-label`
- **Exit** moved to left rail Back (top-level `arv-back` link removed in that commit)

## 3.2 Component: `retroscope-utility-rail.tsx` (127 lines at `76205744`)

- Classes: `arv-utility-rail`, `arv-utility-btn`, `arv-utility-label`
- Icons: `RailIcon` SVG set (exit, curator, map, albums, artists, charts)
- Left / right via `side` prop

## 3.3 CSS block (at `76205744`, section ~line 2570+)

Key rules **not in current** `album-retroscope.css`:

| Rule | Purpose |
|------|---------|
| `.arv-hero-stage` | `grid-template-columns: rail \| hero \| rail` |
| `.arv-utility-rail` | Vertical flex column of 3 buttons |
| `.arv-utility-btn` | Tactile side button chrome |
| `.arv-utility-btn--on` / `--disabled` | States |
| `.arv-orient` (meta band) | Artist/album titles + year lane |
| `.arv-year-lane` / `.arv-year-lane-nudge` | Horizontal year scrub under meta |
| Mobile `@media` overrides for hero-stage | Instrument fit on small screens |

## 3.4 Strip at `76205744`

- `RetroscopeModeStrip` **removed** from client import (layer switcher moved to **right rail**)
- `arv-strip--legacy` — year + rank readouts only (no center mode strip)
- Separate `arv-orient` section for title + year lane (grid area `meta`)

**Current tree differs:** mode strip returned to center of `arv-strip--secondary`.

---

# 4. Exact files needed to restore

## 4.1 Required (minimum)

| File | Action |
|------|--------|
| `app/album-retroscope/album-retroscope-client.tsx` | Restore portal `arv-hero-stage` + dual `RetroscopeUtilityRail`; adjust meta/strip/orient per `76205744` diff |
| `app/album-retroscope/retroscope-utility-rail.tsx` | Replace with **`76205744` version** (127 lines, `arv-utility-*` + SVG icons) |
| `app/album-retroscope/album-retroscope.css` | Re-merge **mobile instrument** CSS block from `76205744` (~370 lines removed by revert) |

**Git extract commands (for implementer, not run in this audit):**

```bash
git show 76205744:app/album-retroscope/retroscope-utility-rail.tsx
git show 76205744:app/album-retroscope/album-retroscope-client.tsx
git show 76205744:app/album-retroscope/album-retroscope.css
```

## 4.2 Unchanged (scope)

| Area | Touch? |
|------|--------|
| Routes (`app/*/page.tsx`, layouts paths) | **No** |
| `lib/load-*-retroscope-dataset.ts` | **No** |
| `lib/retroscope-persist-session.ts` | **No** (may keep current playhead pan vs center-lock from `76205744` — separate decision) |
| `lib/transport-nav.ts`, root `app/layout.tsx` | **No** |
| `/track-deck`, charts | **No** |
| `app/artist-retroscope`, `app/track-retroscope` pages | **No** — same client auto-inherits |

## 4.3 Optional / follow-up (not required for side rails)

| Item | Note |
|------|------|
| `arv-orient` meta band + year lane | Part of `76205744` mobile UX; not strictly 3+3 buttons but same commit |
| Remove duplicate `RetroscopeModeStrip` | Avoid 6 controls doing same job as right rail |
| Delete orphan `arv-rail*` stub | Superseded by `arv-utility-*` restore |
| `arv-pad-btn` CSS | Orphaned; can stay or clean later |

---

# 5. Impact on charts / nav / routes

| System | Impact if restoring `76205744` UI only |
|--------|----------------------------------------|
| **App routes** | None — still `/album-retroscope`, `/artist-retroscope`, `/track-retroscope` |
| **Redirects** | None |
| **Global transport deck** | None — still hidden via `arv-body-lock` |
| **Global top chrome** | None |
| **`lib/transport-nav.ts`** | None |
| **Charts / track-deck** | None — right rail “Charts” button links to `/track-deck` (same as in `76205744`; internal to Retroscope UI) |
| **Database / datasets** | None |
| **Portal v2 curator** | Left rail “Curator” still uses existing `curatorHref` logic |

**Caveat:** Restoring right rail replaces center `RetroscopeModeStrip` for mode switching — **product UI change inside Retroscope only**, not site navigation architecture.

---

# 6. Safest restoration plan (recommended order)

## Phase 1 — CSS + component (low risk)

1. Replace `retroscope-utility-rail.tsx` with `76205744` version.
2. Append/merge `76205744` CSS: `.arv-hero-stage`, `.arv-utility-*`, mobile hero-stage media queries, `.arv-orient` meta band (if desired).
3. Keep `arv-structure-strip` **off** layouts (already done in visual recovery).

**Checkpoint:** Import component in isolation — buttons render with correct chrome in Storybook-less smoke test (temporary dev import) OR proceed to Phase 2.

## Phase 2 — Wire portal only (targeted client patch)

1. In `album-retroscope-client.tsx`:
   - Import `RetroscopeUtilityRail` from `./retroscope-utility-rail`
   - Wrap portal bezel in `arv-hero-stage`
   - Insert `<RetroscopeUtilityRail side="left" … />` and `side="right" … />`
2. Remove duplicate `RetroscopeModeStrip` from strip **if** matching `76205744` (avoid twin layer switchers).

**Checkpoint:** `/album-retroscope` — large cover with 3 buttons per side; swipe on cover still moves; no console errors.

## Phase 3 — Meta / orient band (optional, same commit)

1. Restore `arv-orient` section + `arv-year-lane` from `76205744` client/CSS if year scrub under title is part of approved feel.
2. Or keep current `arv-meta` + readout strip and only do Phase 1–2 (minimal side-rail recovery).

**Checkpoint:** Compare screenshot to approved reference; artist/track routes inherit automatically.

## Phase 4 — Do NOT (per scope)

- Redesign grid, playhead, or square-cell CSS (separate tasks)
- Change routing or transport nav
- Touch charts or Supabase loaders

## Rollback

```bash
git checkout HEAD -- app/album-retroscope/album-retroscope-client.tsx \
  app/album-retroscope/retroscope-utility-rail.tsx \
  app/album-retroscope/album-retroscope.css
```

---

# 7. Why bezel/glass recovery was not enough

| Recovery | What it restored |
|----------|------------------|
| Remove `arv-structure-strip` | Full **plastic shell** (bezel, glass, screws, thumbs) |
| **Still missing** | **Control topology** — side rails were reverted in `439a4fcf`, not suppressed by structure-strip |

Structure-strip hid chrome; revert removed **layout composition** (hero-stage + utility rails + orient band).

---

# 8. Comparison table

| Feature | Current HEAD | `76205744` (approved candidate) | `59cfd5e9` (D-pad era) |
|---------|--------------|----------------------------------|------------------------|
| Cover centered | Yes | Yes | Yes |
| 3 buttons left of cover | No | **Yes** (Back, Curator, Map) | No |
| 3 buttons right of cover | No | **Yes** (Albums, Artists, Charts) | No |
| D-pad in bottom strip | No (mode strip) | No (readouts only) | **Yes** (← ↑↓ →) |
| Mode strip center | Yes | No (on right rail) | No |
| `arv-hero-stage` | No | **Yes** | No |
| Utility rail CSS | No | **Yes** (`arv-utility-*`) | No |
| Wired `retroscope-utility-rail` | No | **Yes** | N/A |

---

# 9. Conclusion

1. **The approved 3+3 side-control Retroscope is not in the active render tree** — only an orphaned, mismatched rail stub remains.
2. **It is fully recoverable from git commit `76205744`** without a redesign or new routes.
3. **Restore three artifacts:** utility rail component (full), portal section in client, mobile instrument CSS block.
4. **Safest path:** Phase 1 CSS + component, Phase 2 portal wiring only; optional Phase 3 orient band.
5. **No impact** on charts, database, or global navigation; artist/track Retroscope routes pick up changes via shared client.

---

*Forensic recovery only. No fixes applied in this pass.*
