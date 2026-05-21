# Retroverse graph integrity audit

**Pass:** canonical continuity repair (not UI redesign).  
**Date:** 2026-05-20

## 1. Integrity audit summary

| Layer | Status | Notes |
|-------|--------|-------|
| `canonical_tracks` (RVTR) | Active | Hot 100 + VDJ eligibility; see `1202_canonical_track_graph_report.sql` |
| `canonical_track_versions` | Active | Graph / acoustic / VDJ rows; orphan acoustic counted in 1202 |
| `canonical_album_tracks` | Partial | RVTR keys backfilled via 1203; gaps remain for sequence-less albums |
| `canonical_track_album_links` | Active | Family-level links; populated by 703 |
| `retroverse_tracks` (Supabase) | Active | Public routes; `retroverse_album_id` often null on chart-only rows |
| Hero album resolution | **Fixed in app** | `resolvePrimaryTrackAlbumFromGraph` + `mergeTrackAlbumLinks` |
| Continuity rails | **Replaced** | “Related tracks” deprecated → editorial sections |

### Rhinestone Cowboy (example failure)

- **Symptom:** “No linked albums yet” + unrelated same-artist list.
- **Cause A:** Hot 100 trajectory path used `canonical-album-sequences.json` only — Glen Campbell album not in that bundle.
- **Cause B:** Trajectory `relatedTracks` was a **same-artist Hot 100 popularity query** (top 8 by peak), not continuity.
- **Cause C:** Supabase `sameEra` query pulled **all tracks in shared `era_id`**, not artist-scoped chronology.
- **Fix:** Graph primary album wins for hero; album links merged into support panel; continuity sections replace generic related list.

## 2. Orphan conditions discovered

| Condition | Detection | Surface impact |
|-----------|-----------|----------------|
| Tracks without album graph rows | `1204` `tracks_without_any_album_link` | Empty album panel; hero void |
| Hot 100 without album link | `1204` `hot100_tracks_without_album_link` | Chart-only entity |
| Missing `canonical-album-sequences` entry | No JSON sequence for RVAL | Trajectory album list empty until graph hero resolves |
| `retroverse_album_id` null | Supabase track row | Fallback to lineage / graph |
| Duplicate RVTR per artist+stem | `1202` / `1204` dup_entities | Wrong route / split continuity |
| Compilation-only attachment | `1204` compilation_only | Wrong hero sleeve |
| Orphan acoustic staging | `1202` orphan_acoustic | Version not wired |
| Same-era bucket (unscoped) | **Removed** — was any track sharing `era_id` | Generic same-artist feel |

## 3. Previous “Related tracks” source

| Route | Source | Algorithm |
|-------|--------|-----------|
| `/tracks/hot100-*` (SQLite) | `load-track-trajectory.ts` | `WHERE artist = ? ORDER BY peak LIMIT 8` — **deprecated** |
| `/tracks/RVTR*` (Supabase) | `page.tsx` `loadTrackGraph` | Union of: album edition mates, **all tracks in `era_id`**, compilation reuse editions — ranked by reason count + peak |

No Spotify-style recommender; the failure mode was **broad SQL filters** presented as “related.”

## 4. Canonical album resolution rules (deterministic)

Implemented in `lib/resolve-primary-track-album.ts` (`pickPrimaryAlbumCandidate`):

1. Load candidates from `canonical_album_tracks` (RVTR key + family) and `canonical_track_album_links`.
2. Filter to artist-matching albums.
3. Score albums — penalize: greatest hits, compilations, soundtracks, deluxe/reissue, live; reward: studio sequence rows, RVTR key match.
4. Prefer lowest score, then earliest `release_year`, then track `position`, then stable `pg_album_id`.
5. Hero resolver order: **graph primary → lineage candidates → `retroverse_album_id`**.

## 5. Replacing “Related tracks”

| Old | New section | Source |
|-----|-------------|--------|
| Related tracks | **From this album** | Album edition tracklist / sequence mates |
| (none) | **Chart neighbors** | Same `chart_date`, rank ±10 |
| Same-era dump | **From this era** | Same `era_id` **and** same `retroverse_artist_id` |
| Reuse editions | **Later reuse** | `later_compilation_reuse` / soundtrack reuse paths |

Code: `lib/track-continuity.ts`, `assembleContinuitySections`, UI labels in track page support panel.

## 6. Safe migration / refactor strategy

1. **App-only (done):** continuity builder + UI copy; no schema migration required.
2. **Data (ops):** run `1204_track_continuity_integrity_audit.sql` after graph load; fix Rhinestone via `canonical_album_tracks` RVTR key + RVAL external key.
3. **Sequences (optional):** add Glen Campbell / Rhinestone Cowboy to `canonical-album-sequences.json` for Hot 100 slug routes without Postgres.
4. **Removed** generic `relatedTracks` / `relatedRows` at track page call sites; continuity types live in `lib/track-continuity.ts`.

## 7. Fallback logic cleanup

| Behavior | Action |
|----------|--------|
| Same-artist Hot 100 top-N | **Removed** |
| Unscoped same-era | **Scoped to artist** |
| “No linked albums” when hero resolves | **Merged hero album into album list** |
| Generic “Related tracks” label | **Removed** |

## 8. Run diagnostics

```bash
psql -h localhost -U bobhopp -d retroverse -f integrity_console/sql/1202_canonical_track_graph_report.sql
psql -h localhost -U bobhopp -d retroverse -f integrity_console/sql/1204_track_continuity_integrity_audit.sql
```

## Final principle

Relationships must read as **editorial history** (album → era → chart week → reuse), not ranked popularity.
