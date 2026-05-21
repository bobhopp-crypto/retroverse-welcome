# Canonical album sequence recovery

Data-only pipeline to recover believable original LP track order for albums with RVAL keys.

## Problem

`canonical_album_tracks` previously depended on:

1. Manual `canonical-album-sequences.json`
2. Dossier MusicBrainz sidecar (retroscope coordinates only)
3. Acoustic fallback (≥6 `ok`/`pending` candidates only)

Gaps: albums like **Adele — 21** had RVAL + chart links but **0** sequence rows because 21 was not in the sidecar and acoustic fallback did not meet the 6-stem `ok` gate.

## Solution

### Table: `canonical_album_sequence_candidates`

Schema: `integrity_console/sql/1105_canonical_album_sequence_candidates_schema.sql`

Stores **all** recovery attempts per album (audit + tiering), not only the winner.

### Build: `scripts/build_canonical_album_sequence_recovery.py`

```bash
npm run graph:sequence-recovery:build
```

| Source | Confidence | Notes |
|--------|------------|--------|
| `existing_canonical_album_tracks` | 0.95 | Copy current graph sequences |
| `musicbrainz_cache` | 0.88 | `source_musicbrainz_album_cache.json` by artist+album norm key |
| `lineage_acoustic` | 0.74 | `album_track_lineage` + acoustic hash titles |
| `acoustic_consensus` | 0.70 | Cluster `staging_acoustic_tracks`; suppress remaster/live/bonus variants |
| `billboard_chart_anchor` | 0.62 | Hot 100 singles on album + lineage fill-ins |
| `acoustic_fallback_order` | 0.55 | Stable acoustic id order (last resort) |

Pollution filters (shared with export): remaster, live, interview, bonus, deluxe, commentary, remix, demo, etc.

### Export priority: `scripts/export_canonical_album_tracks_staging.py`

Per RVAL, first source with **≥6** tracks wins:

1. Manual canonical sequences  
2. MusicBrainz dossier sidecar  
3. **MusicBrainz album cache** (direct artist+album match — fixes dossier gaps)  
4. Recovery candidates (`existing_canonical_album_tracks`, then ordered recovery sources)  

Then load:

```bash
npm run graph:canonical-album-tracks:load
```

Includes `1104_backfill_canonical_album_track_rvtr_keys.sql` for `canonical_track_key` linkage.

## Latest run (local `retroverse`)

| Metric | Before recovery | After recovery |
|--------|----------------:|---------------:|
| `canonical_album_tracks` rows | 56,226 | **197,942** |
| Distinct albums with sequences | 5,744 | **18,921** |
| Staging export rows | 55,935 | **197,828** |
| Albums in export | 6,672 | **19,853** |
| Candidate audit rows | — | 754,696 |
| RVTR-linked `cat` rows | 10,308 | **24,142** |

### Recovery source coverage (albums with ≥1 candidate source)

| Source | Albums |
|--------|-------:|
| `musicbrainz_cache` | 16,375 |
| `lineage_acoustic` | 14,623 |
| `acoustic_consensus` | 13,135 |
| `existing_canonical_album_tracks` | 5,711 |
| `billboard_chart_anchor` | 712 |

### Export winners (this run)

| Source | Albums |
|--------|-------:|
| `musicbrainz_cache` | 10,701 |
| `musicbrainz_sidecar` | 6,628 |
| `lineage_acoustic` | 2,504 |
| `manual` | 5 |
| `existing_canonical_album_tracks` | 15 |

~**1,800** RVAL albums still without a ≥6-track sequence (no MB match, insufficient clean acoustics).

## Adele — 21 (validation)

| Field | Value |
|-------|--------|
| RVAL | RVAL182738 |
| Recovery source | `musicbrainz_cache` |
| `canonical_album_tracks` | **10** rows (`musicbrainz_cache`) |
| Rolling in the Deep | position **1**, `canonical_track_key` **RVTR672189** |

Exported LP order (from MB cache `top_tracks`):

1. Rolling in the Deep  
2. Rumour Has It  
3. Turning Tables  
4. Don't You Remember  
5. Set Fire to the Rain  
6. He Won't Go  
7. Take It All  
8. I'll Be Waiting  
9. One and Only  
10. Lovesong  

Note: MB cache `top_tracks` for this release lists 10 pipe-separated titles (`track_count` metadata says 11; **Someone Like You** is not in the cache string). Full 11-track LP would need sidecar/cache refresh or manual sequence.

## Rolling in the Deep

- Primary album: **21** via `canonical_track_album_links` and `canonical_album_tracks`  
- `canonical_track_key`: **RVTR672189** on track 1  
- Cover: graph `album_artwork_links` / Supabase when available (21 may still lack artwork row)

## Commands

```bash
npm run graph:sequence-recovery:build
npm run graph:canonical-album-tracks:export   # includes recovery build
npm run graph:canonical-album-tracks:load
```

Reports:

- `reports/album_sequence_recovery_summary.json`
- `exports/graph/canonical_album_sequence_candidates.csv` (gitignored)

## Quality gates

- Minimum **6** tracks for export (unchanged).  
- Variant/supplement stems suppressed in consensus builder.  
- `review_required` flag on lineage/consensus/fallback exports where confidence &lt; 0.88.  
- MB cache matches require `match_status = matched`.
