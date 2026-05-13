# Retroverse Artwork Architecture

## Intent

Keep canonical album identity separate from contextual media.

## Canonical Layers

- **Master archive (source of truth):** `/Users/bobhopp/RETROVERSE_DATA/covers_master`
- **Deploy layer (app-served):** `public/retroverse/covers`

## Canonical Artwork Rules

- Album hero artwork must resolve from `retroverse_album_artwork.canonical_cover_path`.
- Canonical artwork paths should use `retroverse/covers/RVAL.../...` namespace.
- `retroverse_media_assets.thumbnail_path` is supplemental only; never album hero identity.
- If canonical cover is missing, page must show placeholder fallback.

## Pilot Notes

- Pilot album covers are stored under:
  - `public/retroverse/covers/RVAL000001/`
  - `public/retroverse/covers/RVAL000002/`
  - `public/retroverse/covers/RVAL000003/`
- Migration `20260506223000_stabilize_artwork_paths.sql` rewrites legacy `covers/...` DB paths.
