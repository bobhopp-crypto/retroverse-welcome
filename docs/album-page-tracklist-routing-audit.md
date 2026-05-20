# Album page tracklist routing audit

**Date:** 2026-05-20

## Route map

| Route | Component | Public | Tracklist source | Notes |
|-------|-----------|--------|------------------|-------|
| `/albums` | `app/albums/page.tsx` | Yes | N/A (index only) | **Preferred** public album browser; one-wide grid |
| `/albums/[slug]` | `app/albums/[slug]/page.tsx` | Yes | `buildDossierTrackRows(albumId, acoustic.tracks)` | **Live album dossier page** (Thriller screenshot) |
| `/albums/[slug]/chart-run` | `app/albums/[slug]/chart-run/page.tsx` | Yes | N/A | Billboard 200 week-by-week panel |
| `/album-retroscope` | `app/album-retroscope/page.tsx` | Yes | N/A | Spatial map; links out to `/albums/RVAL…` |
| `/discover` | `app/discover/page.tsx` | Redirect | — | Redirects to `/album-retroscope` (legacy) |
| `/tracks`, `/tracks/[id]` | track pages | Yes | Graph / search | Not album tracklist |

No second public album **detail** route. Polluted Thriller list came from **`/albums/RVAL586982`** using acoustic curation, not Retroscope.

## Why MB sidecar was not winning (root causes)

1. **`buildDossierTrackRows`** fell back to `curateTrackSignals(acoustic.tracks)` when sidecar failed to load.
2. Sidecar loader tried `RETROVERSE_DATA` before `public/` — empty on Vercel → silent miss.
3. **`loadAttempted` cached null** after first failed read (no retry).
4. **`public/data/albums/album-dossiers.json`** was stale until `npm run dossiers:publish`.
5. Chart Run page used Supabase only → empty weeks → looked “blank”.

## Fix (smallest)

| File | Change |
|------|--------|
| `lib/load-dossier-musicbrainz-sidecar.ts` | Load sidecar from runtime or `public/data/albums/` |
| `lib/load-dossier-musicbrainz-sidecar.ts` | Public bundle first; no sticky failed cache |
| `lib/album-dossier-display-tracks.ts` | MB sidecar defines rows only; acoustic = enrichment; clean fallback |
| `app/albums/[slug]/page.tsx` | Preloads sidecar, passes into `buildDossierTrackRows` |
| `lib/load-album-chart-run.ts` | Supabase → Billboard SQLite fallback by artist+album |
| `app/albums/[slug]/chart-run/page.tsx` | Full chart run panel |
| `scripts/publish-album-dossiers.mjs` | Publish sidecar + dossiers to `public/` |

## Album browsers

| UI | Layout | Status |
|----|--------|--------|
| `/albums` | One-wide cards (was 2-col mobile) | **Primary** — keep in `PRIMARY_NAV` |
| `/album-retroscope` | Map canvas | Exploration; not album list replacement |
| Discover feed client | Legacy; redirect | Not public entry |
