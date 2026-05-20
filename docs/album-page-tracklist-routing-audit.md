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

## Why MB sidecar was not winning

1. **`buildDossierTrackRows`** fell back to `curateTrackSignals(acoustic.tracks)` when no manual `canonical-album-sequences.json` entry.
2. **`dossier-musicbrainz-by-rval.json`** was not loaded by the web app (only used in Python materialize).
3. **`public/data/albums/album-dossiers.json`** was stale (pre-sidecar materialize); runtime bundle in `RETROVERSE_DATA` was newer but optional in deploy.

## Fix (smallest)

| File | Change |
|------|--------|
| `lib/load-dossier-musicbrainz-sidecar.ts` | Load sidecar from runtime or `public/data/albums/` |
| `lib/album-dossier-display-tracks.ts` | Priority: manual sequence → MB sidecar → dossier `musicbrainz.position` → acoustic fallback |
| `app/albums/[slug]/album-dossier-readout.tsx` | Chart Run → `/albums/[slug]/chart-run` |
| `app/albums/[slug]/chart-run/page.tsx` | Full chart run panel |
| `scripts/publish-album-dossiers.mjs` | Publish sidecar + dossiers to `public/` |
| `app/albums/album-dossier.css` | Album index one-wide column default |

## Album browsers

| UI | Layout | Status |
|----|--------|--------|
| `/albums` | One-wide cards (was 2-col mobile) | **Primary** — keep in `PRIMARY_NAV` |
| `/album-retroscope` | Map canvas | Exploration; not album list replacement |
| Discover feed client | Legacy; redirect | Not public entry |
