# Retroverse route & entity map

Internal reference for navigation coherence. Not user-facing.

## Primary routes

| Route | Role |
|-------|------|
| `/` | **Home / Ask Retroverse** — search front door |
| `/album-retroscope` | **Retroscope** — year × rank spatial archive |
| `/track-deck` | **Charts / Track Deck** — Hot 100 week browser |
| `/relationship-workspace` | **Link** — chart track ↔ VDJ video ↔ R2 |
| `/artists`, `/artists/[slug]` | Artist index + dossier |
| `/albums`, `/albums/[slug]` | Album index + dossier (RVAL or slug) |
| `/tracks`, `/tracks/[id]` | Track index + canonical track (RVTR) |
| `/portal`, `/portal-v2` | Portal shells (legacy browse; not home) |

## Entity flow

### Track (canonical `RVTR` or chart title)

→ **Album** (`/albums/RVAL…` or slug)  
→ **Artist** (`/artists/RVAR…` or slug)  
→ **Link workspace** (`/relationship-workspace?artist=&title=`)  
→ **Charts** (`/track-deck` or `?date=` for a week)  
→ **Retroscope** (`/album-retroscope`)  
→ **Home search** (`/?q=`)

### Album (`RVAL` dossier)

→ **Artist** (dossier identity)  
→ **Tracks** (`/tracks?q=` or dossier track list)  
→ **Retroscope** (spatial archive)  
→ **Charts** (Track Deck)  
→ **Home**

### Artist (`RVAR` dossier)

→ **Albums** (dossier + `/albums`)  
→ **Tracks** (`/tracks?q=` or artist-scoped browse)  
→ **Charts** (Track Deck)  
→ **Retroscope**  
→ **Home**

### Chart week (Hot 100)

→ **Track Deck** (`/track-deck?date=YYYY-MM-DD`)  
→ **Track** (row → relationship workspace or RVTR)  
→ **Link workspace** (per-track query)  
→ **Home search**

## Search routing rules

| Result type | Destination |
|-------------|-------------|
| Track | `/tracks/RVTR…` (corpus) or `/tracks?q=` (Hot 100 fallback) |
| Album | `/albums/RVAL…` |
| Artist | `/artists/RVAR…` |
| Chart year query | `/track-deck?date=` (week rows only when year in query) |

Never route search clicks to “latest chart week” for an entity name.

## Global header

Defined in `lib/retroverse-nav.ts` → `PRIMARY_NAV`, rendered in `app/layout.tsx`.
