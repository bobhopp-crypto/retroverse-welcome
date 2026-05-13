# Retroverse data pipeline audit

## 1. What powered Discover (before this change)

- **Source:** `retroverse_source_matches` filtered by `source = billboard_200_sqlite` and `retroverse_entity_type = album`, then join to `retroverse_albums` for those IDs only.
- **Effect:** Discover was a **subset** of the canonical graph, not the full `retroverse_albums` table.

## 2. What powered Search

- **Source:** `retroverse_albums` and `retroverse_artists` directly (`ilike` on canonical title / artist name).
- **Failure mode:** “Rumors” vs “Rumours” did not match UK spelling; search was always full-table but spelling variants were not tried.

## 3. Where the full canonical corpus lives

- **Albums:** `public.retroverse_albums`
- **Tracks:** `public.retroverse_tracks` (optional `retroverse_album_id`), sequence on editions via `public.retroverse_album_tracks` → `public.retroverse_album_editions`
- **Artwork:** `public.retroverse_album_artwork` (canonical path per album/edition rules in app code)
- **Billboard linkage (metadata only):** `public.retroverse_source_matches` (subset indicator + notes such as chart week on album `notes`)

## 4. Why the full corpus was not connected everywhere

- Discover was intentionally wired to **Billboard 200 import matches** only, while Search and album pages used the wider graph. That split caused “Discover feels small” vs “search should find famous albums” confusion when titles/spelling differed or albums sat outside the match table.

## 5. Are canonical tracks already available?

- Yes, in **`retroverse_album_tracks` + `retroverse_tracks`** and **`retroverse_tracks.retroverse_album_id`**. Album detail pages already load both paths (edition sequence, then direct album membership). Empty tracklists indicate **missing rows in those tables**, not a separate “feed” limitation.

## 6. Unified behavior (after change)

- **Discover:** Loads **all** `retroverse_albums` (paginated reads), sorts with Billboard-noted albums first (when `notes` contain chart week), then other albums by year.
- **Search:** Same table; adds **spelling variants** (e.g. Rumors/Rumours) via multiple `ilike` passes merged and deduped.
- **Coverage report (`/index`):** Counts reflect the **full usable corpus**, plus distinct Billboard import IDs and **track-link coverage** (direct + edition paths).

Exact live numbers: open **`/index`** against your Supabase-backed deployment.
