# Retroverse Provenance Model

This model defines trust levels for canonical records and derived relationships.

## Provenance Levels

- `verified`
  - Directly supported by high-confidence source records or manually confirmed archival facts.
  - Use for chart rows and other facts with clear external evidence.

- `canonicalized`
  - Accepted as canonical identity inside Retroverse after deterministic reconciliation.
  - Use for stable entities (albums/tracks/artists) mapped from curated import sources.

- `inferred`
  - Deterministic relationship derived from known facts (no AI generation).
  - Use for structural inferences like reuse adjacency, pathway continuity signals, and some cross-context links.

- `editorial`
  - Human-phrased interpretive framing built on canonical/inferred facts.
  - Use only in narrative summaries and cultural interpretation text.

- `placeholder`
  - Temporary record used to preserve graph continuity while awaiting stronger evidence.
  - Must be reviewable and expected to be upgraded later.

## Classification Guidance for Ingestion

When importing new records:

- Albums/tracks:
  - default `canonicalized`
  - promote to `verified` only when directly supported by strong external matching and/or manual verification.
- Chart rows:
  - default `verified` when sourced from explicit chart entries.
- Never classify a generated relationship as `verified` unless source evidence exists.

## Inferred vs Verified

- `verified` = explicit factual evidence exists in source material.
- `inferred` = deterministic relationship produced from verified/canonicalized facts (e.g., chronology bridges, adjacency continuity).

Inference should remain:

- deterministic
- explainable
- reversible

## Editorial Boundary

Editorial interpretation is allowed in:

- era summary lines
- cultural role/context lines
- pathway narrative labels/summaries

Editorial interpretation must:

- not fabricate facts
- stay anchored to canonical/inferred signals
- avoid changing entity identity or factual chronology

## Current Implementation Targets

Provenance is currently attached to:

- `retroverse_albums.provenance_level`
- `retroverse_tracks.provenance_level`
- `retroverse_chart_appearances.provenance_level`

And used internally (non-UI) for:

- pathway generation provenance tagging
- editorial provenance hooks
