# Retroverse Artwork Architecture Stabilization

This document freezes the artwork architecture so resolver, workbench, and curator flows remain predictable.

## 1) Canonical Album Identity Rules

Canonical identity is editorial and stable. Resolver identity is operational and derived.

### Canonical classes

- `soundtrack`: title includes soundtrack/motion-picture signals, or artist is `Various Artists`.
- `greatest_hits`: title includes greatest-hits/best-of/anthology patterns.
- `compilation`: title includes collection/compilation patterns.
- `self_titled`: normalized album title equals normalized artist name.
- `studio_or_live`: everything else.

### Soundtrack ownership rules

- `various_artists` mode: canonical owner remains `Various Artists`; do not force ownership onto contributors.
- `dominant_contributor` mode: soundtrack owned by an artist stays artist-owned, but resolver still allows soundtrack-form matches.
- `not_soundtrack` mode: standard artist-title resolution.

Implementation reference: `lib/artwork-resolver-identity.ts`.

## 2) Canonical Identity vs Resolver Identity

Canonical identity fields (display/archive):

- `canonical_album_title`
- canonical artist assignment (existing artist graph)

Resolver identity fields (search/ranking only):

- `artwork_search_query`
- `normalized_search_tokens`
- `resolver_notes`
- `album_kind`
- `soundtrack_owner_mode`

Resolver fields are derived and may change over time without mutating canonical display text.

Implementation references:

- `lib/artwork-resolver-identity.ts`
- `scripts/run_itunes_canonical_acquisition.ts`
- `scripts/refine_unresolved_itunes_candidates.ts`
- `scripts/debug_resolver_sanity_set.ts`

## 3) Artwork Source-of-Truth Model

### Canonical master

- Master artwork source: `RETROVERSE_DATA/covers_master`
- This is the only canonical mastered file location.

### Staging

- Candidate staging root: `RETROVERSE_DATA/artwork-intake/itunes-pass/.../staging`

### Runtime deploy

- Runtime serves deployed copies from: `public/retroverse/covers`
- Deploy is a cache/serving layer, not master truth.

### Flow

1. Candidate arrives in staging.
2. Candidate is copied into master (`covers_master`).
3. Runtime copy is deployed from master into `public/retroverse/covers`.
4. DB row stores deployed runtime path; notes/provenance carry master-relative trace.

Implementation reference: `lib/artwork-storage-model.ts`.

## 4) Resolver Architecture Stages

Resolver logic is separated into explicit stages:

1. **Normalization layer**
   - Unicode/accent cleanup, punctuation normalization, title core shaping.
2. **Query builder**
   - Builds artwork query variants from resolver identity.
3. **Candidate retrieval**
   - iTunes search fetch + candidate pooling.
4. **Candidate scoring**
   - artist/title/year agreement and penalties (soundtrack/compilation/etc).
5. **Confidence classification**
   - `high | medium | unresolved` thresholds.

Stage boundaries:

- soundtrack/greatest-hits/self-titled semantics belong in resolver identity + scoring.
- canonical text remains untouched.

## 5) Frozen Artwork State Model

State vocabulary is frozen to:

- `canonical_verified`
- `needs_review`
- `provisional`
- `low_confidence`
- `unresolved`
- `manually_corrected`

No additional overlapping states should be added without architecture update.

State implementation reference: `lib/artwork-living-archive.ts`.

## 6) Artwork Lifecycle (Operational)

1. Acquire candidates into staging (`high|medium|unresolved` tiering).
2. Apply high-confidence only when trusted (`canonical_verified`) or hold as `provisional`.
3. Apply medium as `needs_review`.
4. Keep low-trust visible as `provisional`/`low_confidence` for curator correction.
5. Curator actions mutate state and retain provenance/history snapshots.

## 7) Curator Workflow Boundaries

Workbench is responsible for:

- visual review, explicit trust visibility, and fast correction
- state changes (`approve/reject/clear/replace/mark`)
- provenance and rollback trail updates

Workbench is not responsible for:

- broad acquisition strategy
- canonical entity ontology rewrites
- large-scale data imports

## 8) Future Change Boundaries

Place new logic in one layer only:

- Canonical identity behavior: `lib/artwork-resolver-identity.ts`
- Resolver stages/scoring: resolver scripts only
- Storage topology: `lib/artwork-storage-model.ts`
- State transitions/history: `lib/artwork-living-archive.ts`

If a change spans multiple layers, update this architecture document first.
