# Retroverse Canonical Graph Overview

This document describes the current Retroverse canonical graph represented in `retroverse_*` tables.

## Core entity flow

Canonical flow is anchored as:

1. `retroverse_artists` defines stable artist identity.
2. `retroverse_albums` defines album identity and top-level ownership (`retroverse_artist_id`).
3. `retroverse_tracks` defines track identity, with optional default album/era anchors.
4. `retroverse_album_editions` captures release variants for each album.
5. `retroverse_album_tracks` places tracks into edition-specific sequence context.

From there, context expands through:

- `retroverse_chart_appearances` (timeline performance for tracks)
- `retroverse_media_assets` (playback/display assets for tracks)
- `retroverse_album_artwork` (canonical cover/art references for albums/editions)
- `retroverse_album_artist_roles` (credit/billing nuance beyond one primary artist)
- `retroverse_source_matches` (mapping external source rows to canonical IDs)
- `retroverse_eras` (period clustering for albums, editions, tracks)

## Canonical identity strategy

Retroverse uses stable, prefixed text IDs as first-class keys:

- artists: `RVAR######`
- albums: `RVAL######`
- tracks: `RVTR######`
- album editions: `RVED######`
- album track rows: `RVAT######`
- album artwork: `RVAW######`
- album artist roles: `RVRL######`
- chart rows: `RVCH######`
- media assets: `RVMA######`
- source match rows: `RVSM######`
- eras: `RVER######`

These IDs are internal canonical anchors and do not depend on external platform IDs.

## Reuse and lineage model

Reuse is modeled structurally, not by duplicating track entities.

- A track exists once in `retroverse_tracks`.
- Every appearance is contextualized in `retroverse_album_tracks` via:
  - `retroverse_album_edition_id`
  - sequence coordinates (`disc_number`, `track_number`, optional side fields)
  - context flags (`soundtrack_exclusive`, etc.)
- Since an edition points to an album, one canonical track can appear across:
  - original studio context
  - compilations
  - soundtrack contexts
  - later variants/reissues

That is the lineage backbone used for chronological "first appearance -> later reuse" traversal.

## Why `retroverse_album_tracks` is contextual (not duplicative)

`retroverse_album_tracks` is the join layer that stores **placement metadata**, not identity metadata.

- Identity stays in `retroverse_tracks`.
- Context (where, when, and how a track is sequenced) lives in `retroverse_album_tracks`.

This separation allows:

- one track identity to participate in many album/edition contexts
- deterministic ordering within each edition
- lineage analysis without cloning track rows

## How chart appearances connect to tracks

`retroverse_chart_appearances` links directly to `retroverse_tracks` by `retroverse_track_id`.

This creates a chronological chart timeline per canonical track:

- `chart_date`
- `chart_name`
- `chart_position`
- `weeks_on_chart`

Because charts attach to canonical track identity, chart history remains coherent even when the track is reused across multiple albums.

## Why `retroverse_source_matches` exists

`retroverse_source_matches` is the reconciliation layer between external catalogs and Retroverse canonical IDs.

It stores:

- source system identity (`source`, `source_key`)
- mapped canonical target (`retroverse_entity_type`, `retroverse_entity_id`)
- confidence and override metadata (`confidence_score`, `manual_override`, `verified_by`)

This table is polymorphic by design (artist/album/track/chart/era), which is why `retroverse_entity_id` is not a direct FK.

## Why media assets are separated from canonical artwork

Artwork and media serve different concerns and are intentionally split:

- `retroverse_album_artwork` = canonical visual identity for albums/editions (cover system).
- `retroverse_media_assets` = concrete playable/viewable files tied to tracks (video/audio/image assets, local paths, thumbnails, runtime dimensions).

This keeps canonical release identity independent from operational media ingestion and playback details.

## Notes

- This overview is documentation-only and does not modify schema.
- DBML export is in `docs/retroverse_schema.dbml`.
