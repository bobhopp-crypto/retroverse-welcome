# Retroverse Artwork Acquisition Strategy

Date: 2026-05-07  
Phase: Artwork sourcing and curator-guided intake

## 1) Current Source Audit

- Canonical deploy layer (currently used by app): `public/retroverse/covers`
- Legacy duplicate layer (non-canonical, avoid for new intake): `public/covers`
- Declared master source-of-truth path: `/Users/bobhopp/RETROVERSE_DATA/covers_master` (currently empty)
- Supplemental track thumbnails (not canonical album identity): `public/media-thumbnails`

Current path expectation:

- Database column: `retroverse_album_artwork.canonical_cover_path`
- Path format expected by current audits/rendering:
  - `public/retroverse/covers/<RVAL...>/<filename>.jpg`
- Runtime image rendering converts stored path to site-relative path in `CompactArtworkThumb`.

Observed bottleneck:

- Queue targets are valid, but most top-ranked albums have no local source image to assign.
- Assignment logic and rendering are functioning; intake supply is the blocker.

## 2) Recommended Acquisition Hierarchy (High Confidence First)

Use this source order per album:

1. Existing in your own archive exports / known trusted dump.
2. Official label/artist release artwork mirrors (high-confidence).
3. Discogs/Wikipedia/manual web source only with human verification.

Rules:

- Prefer first-release front cover unless canonical album identity requires alternate.
- Avoid fan edits, remastered sticker overlays, collages, montage posters.
- Keep curator verification required for every accepted image.

## 3) Lightweight Intake Workflow

### Step A — Export acquisition batch

```bash
npm run artwork:intake:export -- --batch-size 25
```

This creates:

- `.../artwork-intake/batches/batch_<timestamp>/staging`
- `.../artwork-intake/batches/batch_<timestamp>/exports/artwork_intake_targets.csv`
- `.../artwork-intake/batches/batch_<timestamp>/exports/artwork_intake_targets.json`

### Step B — Curator gathers images

- Put candidate files into batch `staging/`.
- Use provided `staging_filename` convention:
  - `<RVAL...>__<artist-slug>__<album-slug>.jpg`

### Step C — Validate intake

```bash
npm run artwork:intake:validate -- --batch "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/batches/batch_<timestamp>"
```

Outputs:

- validation report JSON/MD
- duplicate hash groups
- apply-ready candidate list (`artwork_apply_candidates.json`)

### Step D — Apply canonical assignments

- Only for `ready` rows after visual verification.
- Copy approved files to `public/retroverse/covers/<RVAL...>/`.
- Update `retroverse_album_artwork.canonical_cover_path` for the chosen artwork row.
- Re-run:
  - `npm run audit:archive-integrity`
  - `npm run queue:archive-enrichment`

## 4) Prioritization Policy (Highest UX Impact)

Use queue order and keep top-heavy intake:

- Tier A first:
  - high charted track count
  - high connected track count
  - high enrichment score
- Focus culturally recognizable releases first (major catalog anchors).
- Do not spend a cycle on low-visibility long-tail first.

## 5) Curator Control Boundaries

Safe to automate:

- missing-cover batch exports
- filename templating
- file presence checks
- duplicate hash detection

Human-only decisions:

- cover authenticity
- release/version choice
- replacement conflicts where multiple candidates exist

## 6) Batch size and cadence

Recommended defaults:

- Intake batch: 25 albums (current proven safe size)
- Apply batch: 15-25 verified covers
- Cadence: 3 cycles/week

Expected practical speed:

- Conservative: 15 covers/cycle x 3 cycles/week = ~45 covers/week
- Current baseline: 3 canonical of 132 (~2.3%)
- 50% target: 66 canonical covers
- Net needed from current: 63 additional covers
- Time to 50%:
  - ~1.5 weeks at 45/week
  - ~2-3 weeks with curator-only slower throughput

## 7) Remaining bottlenecks after sourcing starts

- Source availability for obscure or region-specific editions
- Version ambiguity (same title, multiple release covers)
- Duplicate source key collisions on final assignment rows
- Human review time (not technical limits)
