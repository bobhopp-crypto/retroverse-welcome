# Retroverse Enrichment Operations

Date: 2026-05-07  
Phase: Archive Operations (human-guided enrichment)

## Purpose

Retroverse operations now prioritize archive authority over interface refinement.

This workflow is designed to:

- increase canonical artwork coverage quickly and safely,
- reduce unresolved era references conservatively,
- reduce slug/canonical fragmentation without risky bulk edits,
- measure confidence changes after every enrichment cycle.

## Core Operational Loop

Run this loop every enrichment cycle:

1. Generate current integrity baseline.
2. Generate prioritized enrichment queues.
3. Review queue slices (human gate).
4. Apply constrained batch fixes.
5. Re-run integrity + queues.
6. Compare deltas and record confidence movement.

## Commands (Repeatable)

Assumes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in shell.

```bash
# 1) Baseline integrity snapshot
npm run audit:archive-integrity

# 2) Build prioritized enrichment queues
npm run queue:archive-enrichment

# 3) Summarize trend vs previous snapshots
npm run ops:enrichment-progress

# 4) Verify app/tooling health
npm run lint
```

Checkpoint:

- You should see JSON/MD output paths for all three scripts.
- You should see updated queue sizes and delta values in the progress summary.

## Batch Strategy (Conservative Defaults)

Use small, reversible batches:

- `artwork`: 25-40 albums per batch
  - prioritize queue top slice by enrichment score.
  - stop batch if broken-path rate increases.
- `slug cleanup`: 20-30 source match rows per batch
  - apply only deterministic suffix corrections from queue output.
- `era reference cleanup`: 15-25 references per batch
  - only accept high-confidence normalization suggestions.

## Human Review Boundaries

### Safe to automate

- Queue generation from canonical tables.
- Deterministic coverage counting and percentage deltas.
- Deterministic slug suffix mismatch detection.
- Deterministic file-path existence checks for local canonical artwork paths.

### Human-reviewed before apply

- Artwork target acceptance (especially non-obvious or multi-version covers).
- Era reference normalizations where confidence is < 1.0.
- Slug corrections touching high-traffic entities.
- Any candidate involving ambiguous album-track relationships.

### Never auto-merge

- Duplicate-like entity merges.
- Ambiguous track-to-multiple-album conflict resolution.
- Era reference rewrites driven by fuzzy match only.
- Canonical reassignment affecting IDs (`RVAR/RVAL/RVTR`) without manual verification.

## Confidence Tracking (What to Monitor)

Track these metrics each cycle:

- `artwork_integrity.canonical.pct` (primary target)
- `artwork_integrity.missing + broken` (burn-down)
- `canonical_confidence.weak_slug_matches.count`
- `canonical_confidence.unresolved_era_references.*`
- traversal integrity percentages:
  - artists with connected albums
  - albums with connected tracks
  - tracks with connected eras

Target direction:

- artwork canonical % up
- missing/broken down
- weak slug count down
- unresolved era refs down
- traversal metrics stable or improving

## Suggested Cadence

- 3 enrichment cycles per week (small batches)
- 1 consolidation cycle per week (cleanup + confidence review)
- 1 ship-readiness checkpoint every 2 weeks

## Operational Artifacts

Primary output roots:

- Integrity snapshots: `/Users/bobhopp/RETROVERSE_DATA/logs/archive-integrity`
- Enrichment queues: `/Users/bobhopp/RETROVERSE_DATA/logs/archive-enrichment`

Recommended retention:

- Keep all JSON snapshots.
- Keep latest 10 markdown summaries pinned for quick trend review.

## Release Gate (Archive-First)

Before any major public push:

1. integrity report generated in same session,
2. queue report generated in same session,
3. progress summary shows non-regressive trend for:
   - artwork missing/broken,
   - weak slugs,
   - unresolved era references.

If any trend regresses, pause batch expansion and review last applied changes.
