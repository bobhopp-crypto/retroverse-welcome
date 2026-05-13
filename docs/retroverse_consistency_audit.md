# Retroverse Consistency Audit

Date: 2026-05-07  
Scope: coherence and traversal refinement (no schema/migration/ingestion changes)

## Inconsistencies Fixed

### 1) Artwork resolution consistency

- Added shared artwork resolver: `lib/retroverse-artwork.ts`
  - `loadAlbumArtworkRows()`
  - `selectCanonicalArtwork()`
- Standardized artwork logic across:
  - `app/albums/saturday-night-fever/page.tsx`
  - `app/albums/rumours/page.tsx`
  - `app/albums/eagles-their-greatest-hits-1971-1975/page.tsx`
  - `app/artists/bee-gees/page.tsx`
  - `app/eras/1974-1977/page.tsx`
  - `app/tracks/[id]/page.tsx`
- Resolution behavior is now consistent:
  - prefer `is_primary = true`
  - fallback to `artwork_role = 'primary'`
  - prioritize rows with a non-null `canonical_cover_path`
  - respect edition-specific artwork when available
  - gracefully fallback for environments missing `is_primary` column

### 2) Saturday Night Fever cover issue on era page

- Root cause addressed by unifying artwork selection and replacing manual era-card cover rendering with `ArtworkFrame`.
- `app/eras/1974-1977/page.tsx` now uses the same canonical cover-path normalization behavior as album/artist/track views.

### 3) Traversal continuity

- Added non-empty fallback traversal movement in "Continue Through..." sections:
  - when pathways are empty, link to `/random` with editorial fallback text.
- Ensured breadcrumb trails exist on:
  - track detail page
  - canonical album pages
  - artist page
  - canonical era page
  - static era detail pages

### 4) Metadata compression

- Reduced repeated metadata badges in album sequencing rows:
  - removed extra `Charted` badges where `Peak #` already conveys chart state.
  - kept `Album cut` and context-specific labels (e.g., `Historical reuse`) for signal clarity.

### 5) Random traversal QA

- Refined `/random` to avoid weak destinations when richer nodes exist:
  - chooses rich pools first (weight > 1), then falls back to full pool only if needed.
  - keeps type selection balanced across artist/album/track/era.
  - weights per-entity by relationship richness (chart rows, membership depth, era connectivity, role depth).

## Remaining Weak Spots

1. Artist deep links are still sparse: only canonical artist detail route currently implemented is `/artists/bee-gees`; index routes for other artists are list-only (no entity page yet).
2. Album deep links are currently strongest for the three canonical album experience pages; other albums resolve as archive listing entries without dedicated pages.
3. Pathway href fallback for unknown canonical album routes still lands on broader archive context rather than album-specific detail pages when those pages do not exist.

## Dead-End Traversal Areas (Current)

- Soft dead ends (not hard 404):
  - non-featured artists in `/artists` index (display-only rows)
  - non-featured albums in `/albums` index (display-only rows)
- Hard dead-end risk was reduced by:
  - fallback to `/random` in empty pathway states
  - preserving global archive nav for immediate movement.

## Duplicate/Noisy Metadata Areas (Current)

- Improved:
  - repeated chart-state badges in album sequence lists reduced.
- Still somewhat repetitive by design:
  - album header metadata + context section can repeat semantic cues (era/type/release framing), though this remains within readable range.

## Future Cleanup Recommendations

1. Add canonical dynamic entity routes for artists/albums beyond current featured set to remove soft dead ends in index traversal.
2. Introduce a shared route-mapping helper for entity links (artist/album/era) to avoid per-page drift and fallback mismatch.
3. Move breadcrumb derivation into a small shared traversal utility to guarantee consistent label/order logic across all surfaces.
4. Optionally add lightweight pathway quality thresholds (minimum score) to suppress low-signal pathway lines on sparse entities.

## Verification

- `npm run lint` passed
- `npm run build` passed
