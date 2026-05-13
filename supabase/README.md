# Retroverse Canonical Graph (Pilot)

This folder defines the first canonical Retroverse identity layer in Supabase.

## Files

- `migrations/20260506195500_retroverse_canonical_graph.sql`  
  Creates canonical tables, permanent-ID validation checks, foreign keys, and indexes.
- `migrations/20260506202000_expand_album_graph.sql`  
  Expands the pilot into a complete album graph (editions, ordered tracklists, album artist roles, artwork linkage, and era inheritance support).
- `migrations/20260506214500_album_artwork_primary_flag.sql`  
  Adds explicit primary artwork flag support with uniqueness constraints for canonical cover selection.
- `migrations/20260506220500_retroverse_media_assets.sql`  
  Adds minimal canonical media linkage for track-to-local media relationships (video/audio/image).
- `migrations/20260506223000_stabilize_artwork_paths.sql`  
  Rewrites legacy artwork paths from `covers/...` to `retroverse/covers/...` for stable deploy-layer resolution.
- `seed.sql`  
  Seeds a culturally diverse pilot library (`Saturday Night Fever`, `Eagles Their Greatest Hits (1971-1975)`, and `Rumours`) with artwork, sequencing, source matches, chart rows, and pilot media links.
- `ARTWORK_ARCHITECTURE.md`  
  Defines canonical artwork source/deploy folders and strict separation between album artwork and media thumbnails.
- `validation/retroverse_validation_suite.sql`  
  Read-only SQL checks for artists, albums, tracks, source matches, charts, eras, album graph ordering, artwork, and overall integrity.
- `editorial/retroverse_editorial_query_suite.sql`  
  Reusable editorial/exploration queries for chart significance, soundtrack sequencing, source variance, artist relationships, era intelligence, deep cuts, and album narrative output.
- `reset_retroverse_pilot.sql`  
  Drops only `retroverse_*` pilot tables to cleanly rebuild after partial migration runs.

## Design Principles

- Retroverse IDs are permanent and source-independent.
- Canonical metadata is separate from source metadata.
- Chart history is normalized into its own table.
- Source matching is extensible and keeps original source naming.
