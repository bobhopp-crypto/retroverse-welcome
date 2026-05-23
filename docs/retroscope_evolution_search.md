# Retroscope evolution search (historical narrowing)

**Date:** 2026-05-21  
**Type:** Read-only git archaeology — no restores applied  
**Anchor commit:** `76205744` (*Refine Retroscope mobile layout and compact utility rails*, 2026-05-20 11:51)  
**Repo:** `retroverse-welcome` (canonical app)

---

## Executive finding

**There is no git commit after `76205744` that adds a denser, more complete Retroscope machine layout.**

The branch after `76205744` is:

```
76205744  (utility rails + orient band + structure-strip layouts)
    ↓ 7 minutes
439a4fcf  REVERT — removes rails, −594 lines
    ↓
8a71f3da   orphan utility-rail stub (arv-rail*, not wired)
    ↓
31ad4d44   transport-deck CSS hide only (3 lines)
```

The remembered “later, denser, more machine-like” version is almost certainly one of:

1. **`76205744` with `arv-structure-strip` active** (same commit; layouts used `arv-body-lock arv-structure-strip` — current working restore uses `arv-body-lock` only, which leaves beige plastic chrome, large portal gaps, and faint compact rails).
2. **`941a998e`** (*Rebuild Retroscope interaction hierarchy around time navigation*) — chronologically **before** `76205744` on the same branch, but a **different** denser UI: unified `arv-interaction-band`, large year/rank typography, mode strip in band — **no** 3+3 side rails.
3. **A never-committed merge** of `941a998e` interaction band + `76205744` utility rails (not in history).

---

## Search window definition

| Boundary | Commit / event |
|----------|----------------|
| **After** | `76205744` (2026-05-20 11:51) |
| **Before flattening** | `439a4fcf` revert (2026-05-20 11:58) and downstream reduction on `main` |
| **Related pre-rail density** | `941a998e` → `a3c6d7c0` (same morning, reverted before rails landed) |
| **Structure-strip foundation** | `d55fa945` (2026-05-20 11:20) |

---

# 1. Candidate commits

## 1A. Strictly after `76205744` (same day)

| Commit | Date | Message | Retroscope files | Role |
|--------|------|---------|------------------|------|
| **`439a4fcf`** | 2026-05-20 11:58 | Revert "Refine Retroscope mobile layout…" | client −212/+212, css −370, **deleted** `retroscope-utility-rail.tsx` | **Flattening** — removes `arv-hero-stage`, rails, mobile-instrument CSS |
| **`8a71f3da`** | 2026-05-20 20:29 | Checkpoint before track instrumentation strip refactor | `retroscope-utility-rail.tsx` +80 lines only | **Orphan stub** — `arv-rail` / `arv-rail-btn`; **not imported** in client |
| **`31ad4d44`** | 2026-05-21 09:38 | Consolidate Retroverse navigation into unified transport deck | `album-retroscope.css` +2/−1 | Hides `.rv-transport-deck` on Retroscope body — **not** instrument layout |

**Verdict:** No post-`76205744` commit increases density. Only revert + dead stub.

---

## 1B. Same-day branch immediately before / intertwined with `76205744`

| Commit | Date | Message | Key layout artifacts |
|--------|------|---------|----------------------|
| **`d55fa945`** | 11:20 | Strip Retroscope to core interaction structure | Adds `body.arv-structure-strip {…}` subtraction CSS (~241 lines); layouts → `arv-body-lock arv-structure-strip` |
| **`941a998e`** | 11:38 | Rebuild Retroscope interaction hierarchy around time navigation | **`arv-interaction-band`**: title, mode strip (`variant="band"`), giant year/rank, micro-context; grid year axis; **no** utility rails; structure-strip on |
| **`a3c6d7c0`** | 11:40 | Revert interaction hierarchy rebuild | Restores pre-941 sparse meta + strip + mode strip deck |
| **`76205744`** | 11:51 | Refine Retroscope mobile layout and compact utility rails | **`arv-hero-stage`** + **`RetroscopeUtilityRail`** (3+3); `arv-orient` meta band + year lane; legacy meta/strip hidden on mobile; structure-strip on |

Git graph (simplified):

```
d55fa945 → 941a998e → a3c6d7c0 → 76205744 → 439a4fcf → … → main
```

`941a998e` is an **ancestor** of `76205744`, but **`a3c6d7c0` reverted it** before rails were added. Rails were built on the **reverted sparse base**, not on top of the interaction band.

---

## 1C. Pre–May 20 instrument polish (context)

| Commit | Date | Message | Visual / layout notes |
|--------|------|---------|----------------------|
| **`77192f6f`** | 2026-05-19 | Rebuild Retroverse mobile immersion experience | Portal **50dvh** (was 44dvh), larger hero, mobile meta typography — **no** side rails |
| **`761d8f9b`** | 2026-05-17 | Fixed center playhead with scrolling coordinate field | Viewport interaction only |
| **`ea62e78c`** | 2026-05-16 | Ship RetroScope as primary surface | Full **plastic machine** (`arv-body-lock` only, ~2000 lines CSS); screws, bezel, glow — **no** structure-strip, **no** utility rails |
| **`f1c44b50`** | 2026-05-18 | Front door + orientation tour | Tour overlay (`div.arv-orient`) — conflicts with later `section.arv-orient` meta band naming |

---

## 1D. Non-candidates (no Retroscope layout change)

| Commit | Note |
|--------|------|
| `20c733b2` | Album dossier / track glyphs — **no** `app/album-retroscope/` diff |
| `8a56a35d`, `f40e07ff`, `84debe90` | Track instrumentation strip — track pages, not Retroscope |
| `dfa7c022`, `cb1d39c6`, etc. | Track/album page atmosphere — outside Retroscope client |

---

# 2. Visual evolution summary

## `76205744` (restored baseline)

| Aspect | Behavior |
|--------|----------|
| **Side controls** | 3+3 utility rails (`arv-utility-btn`, ~2.35rem min-height, 0.42rem labels) flanking cover |
| **Portal** | `arv-hero-stage` 3-column grid; cover in `arv-portal-bezel` |
| **Density** | **Low on mobile without structure-strip** — legacy meta/strip hidden; `section.arv-orient` only visible with `body.arv-structure-strip` |
| **Machine feel** | **Strong with structure-strip** — hides plastic chrome, tightens portal, shows orient band, square grid cells in strip mode |
| **Typography** | Orient band: year up to ~2.45rem; compact utility labels |
| **Coordinate bay** | Standard viewport; structure-strip tightens grid gap, reticle, cell borders |
| **Layouts** | `arv-body-lock arv-structure-strip` on all three Retroscope routes |

**Why current restore feels sparse:** working tree matches rail **markup/CSS** from `76205744` but layouts use **`arv-body-lock` only** (structure-strip removed per `docs/retroscope_visual_recovery.md`). That disables ~200 lines of `body.arv-structure-strip .arv-hero-stage`, `.arv-orient`, portal, and grid rules.

---

## `941a998e` (interaction band — reverted before rails)

| Aspect | Behavior |
|--------|----------|
| **Side controls** | **None** — modes in center `RetroscopeModeStrip` inside `arv-interaction-band` |
| **Portal** | Capped height `--arv-portal-max: min(42vw, 11.25rem)` — **smaller vertical portal**, more room for band |
| **Density** | **Higher** — single band min 9.5rem (10.5rem mobile); merged title + modes + time |
| **Machine feel** | Instrument hierarchy: large **year** (2.35–2.85rem), **rank** (1.85–2.35rem), chart context line |
| **Spacing** | Grid areas: `chrome / portal / band / viewport` (not meta+strip) |
| **Coordinate bay** | Year labels on `arv-grid-axis` above cells |
| **Layouts** | `arv-structure-strip` on |

**Tradeoff vs `76205744`:** denser readouts and hierarchy, but **no** flanking 3+3 rails.

---

## `439a4fcf` (flattening after rails)

| Aspect | Behavior |
|--------|----------|
| **Side controls** | Removed — back to `arv-back` + bottom `RetroscopeModeStrip` |
| **Density** | Drops to pre-rail sparse layout |
| **Machine feel** | Plastic chrome returns if structure-strip off; strip skeleton if on |

---

## `d55fa945` (structure-strip foundation)

| Aspect | Behavior |
|--------|----------|
| **Visual** | Subtraction-only CSS: hides screws, LED, portal glass, scan lines, hero atmosphere |
| **Density** | Increases **information density** by removing decorative beige/amber plastic |
| **Requires pairing** | Meaningless alone; pairs with `941a998e` or `76205744` client markup |

---

## `ea62e78c` (original shipped machine)

| Aspect | Behavior |
|--------|----------|
| **Machine feel** | **Maximum plastic** — full bezel, glow, device chrome |
| **Side controls** | `arv-back` + bottom strip / pad buttons (not 3+3 rails) |
| **Density** | Visually rich but **more empty bezel**; not the May 20 compact instrument |
| **Layouts** | `arv-body-lock` only |

---

## `8a71f3da` (checkpoint stub)

| Aspect | Behavior |
|--------|----------|
| **Side controls** | Alternate rail component (`arv-rail-btn`) — **never wired**, no CSS |
| **Evolution** | Abandoned direction; not a complete layout stage |

---

# 3. Most likely target version

## Primary hypothesis: `76205744` + `arv-structure-strip` (same commit, full activation)

| Evidence | Detail |
|----------|--------|
| Matches user rail spec | Exact 3+3 layout only exists here |
| Explains “too sparse / beige” | Plastic chrome rules apply when structure-strip **off** |
| Explains “controls faint/small” | Utility buttons designed for **compact strip mode** (0.42rem labels); strip CSS enlarges/tightens portal grid when on |
| No later commit | Nothing after `76205744` improves on it before revert |
| Layout proof | `git show 76205744:app/album-retroscope/layout.tsx` → `arv-body-lock arv-structure-strip` |

**Conclusion:** The “later” approved machine is likely **not a different hash** — it is **`76205744` rendered with structure-strip enabled**, plus mobile orient band visible.

---

## Secondary hypothesis: `941a998e` (if memory emphasizes typography/hierarchy over side rails)

| Evidence | Detail |
|----------|--------|
| Denser band | Largest year/rank type in the May 20 sequence |
| More integrated controls | Mode + time + title in one band |
| “More polished coordinate bay” | Year axis row above grid |
| Chronology confusion | Feels “later” but was **11 minutes before** rails and was **reverted** before `76205744` |

**Conclusion:** Choose this if the remembered UI had **big center year/rank** and **mode buttons under the title**, not **six flanking icon buttons**.

---

## Tertiary hypothesis: synthetic `941a998e` + `76205744` merge (not in git)

If memory requires **both** 3+3 rails **and** `arv-interaction-band` density — that combination **never landed on `main`**. Would require a manual merge, not a single `git checkout`.

---

# 4. Safe restore plan (do not execute yet)

## Option A — Activate full `76205744` presentation (recommended first trial)

| Step | Files | Risk |
|------|-------|------|
| 1 | Re-add `arv-structure-strip` to `app/album-retroscope/layout.tsx`, `app/artist-retroscope/layout.tsx`, `app/track-retroscope/layout.tsx` | Low — CSS already in repo |
| 2 | Keep current `76205744` client + `retroscope-utility-rail.tsx` + mobile-instrument CSS | None if already restored |
| 3 | Verify tour overlay: `section.arv-orient` vs `div.arv-orient` (tour uses div) | Medium — may need scoping (already partially done in working tree) |
| 4 | Keep playhead pan / square grid fixes from post-`76205744` work | Merge carefully — `76205744` used `viewportFocus`, not `playheadGrid` |

**Isolation:** Retroscope-only. No chart routes, DB, or global nav file changes required.

---

## Option B — Restore `941a998e` interaction band (if rails not required)

| Step | Files |
|------|-------|
| 1 | `git show 941a998e:app/album-retroscope/album-retroscope-client.tsx` (portal + band + viewport) |
| 2 | `git show 941a998e:app/album-retroscope/album-retroscope.css` (interaction-band block + structure-strip rules) |
| 3 | `git show 941a998e:app/album-retroscope/retroscope-mode-strip.tsx` (band variant) |
| 4 | Supporting: `lib/retroscope-persist-session.ts`, `lib/retroscope-bootstrap.ts` from same commit if band/grid behavior regresses |

**Tradeoff:** Loses 3+3 side rails. Gains dense typography band.

---

## Option C — Cherry-pick merge (highest effort)

| From | Bring |
|------|-------|
| `76205744` | `arv-hero-stage`, `RetroscopeUtilityRail`, `retroscope-utility-rail.tsx`, utility CSS |
| `941a998e` | `arv-interaction-band` markup/CSS; replace legacy meta/strip/orient |
| Current HEAD | `playheadGrid`, `panViewportToIncludeActive`, `arv-body-lock` split fix, square cells |

**Not a single commit restore** — requires conflict resolution and visual QA.

---

## What stays untouched (all options)

- Chart routes and chart UI
- Database / Supabase / ingest
- Global navigation / transport deck wiring (`31ad4d44` is orthogonal)
- Retroscope **route URLs** (`/album-retroscope`, `/artist-retroscope`, `/track-retroscope`)

---

## Suggested verification order (when approved to restore)

1. **Option A only** — toggle `arv-structure-strip` on layouts; compare to memory (fastest). **Applied 2026-05-21** — see `docs/retroscope_structure_strip_activation.md`.
2. If still wrong — inspect **`941a998e`** in isolation (Option B).
3. If still wrong — plan Option C merge or check **`ea62e78c`** for pre-strip plastic reference only.

---

## Reference commands (inspection)

```bash
# Commits after 76205744 touching Retroscope
git log --oneline 76205744..HEAD -- app/album-retroscope/

# Full 76205744 tree at commit time
git show 76205744 --stat -- app/album-retroscope/

# Interaction-band commit (pre-rail density)
git show 941a998e --stat -- app/album-retroscope/

# Layout body classes at 76205744
git show 76205744:app/album-retroscope/layout.tsx
```

---

## Related docs

- `docs/retroscope_side_controls_restore.md` — surgical `76205744` rail restore (structure-strip off)
- `docs/retroscope_visual_recovery.md` — why structure-strip was removed
- `docs/retroscope_recovery_audit.md` — full route/client map
