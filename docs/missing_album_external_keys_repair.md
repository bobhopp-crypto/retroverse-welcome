# Missing album external keys repair

Generated: 2026-05-21  
Pipeline: `npm run graph:repair-album-external-keys` → export → load → RVTR backfill

## Summary

| Metric | Value |
|--------|------:|
| Albums missing RVAL before | 14,623 |
| Candidates evaluated | 14,623 |
| RVAL assigned | 14,618 |
| Skipped / review | 5 |
| Albums missing RVAL after | 5 |
| `canonical_album_tracks` rows before repair | 56,150 |
| `canonical_album_tracks` rows after export+load | 56,226 |
| Albums with sequences (export) | 6,672 |
| Staging export rows | 55,935 |
| `canonical_album_tracks` with `canonical_track_key` | 10,308 |

## Skipped albums (5)

Duplicate artist+title where a sibling album already holds `album_external_keys`, or duplicate-title loser (e.g. second Eagles *Hotel California* row).

## Priority albums

| Artist | Album | RVAL | `canonical_album_tracks` |
|--------|-------|------|--------------------------:|
| Adele | 21 | **RVAL182738** (new) | **0** |
| Santana | Supernatural | RVAL244547 | 10 |
| Michael Jackson | Thriller | RVAL586982 | 9 |
| Fleetwood Mac | Rumours | RVAL000003 | 11 |
| Eagles | Hotel California | RVAL281995 (id=1) | 9 |

## Adele — 21

| Field | Value |
|-------|-------|
| PG `albums.id` | 31803 |
| `release_year` | 2011 |
| `album_external_keys` | **RVAL182738** (`deterministic_hash`, confidence 80) |
| Billboard 200 | yes |
| `canonical_track_album_links` | yes (Rolling in the Deep) |
| Acoustic candidates | 11 (5 `ok`, 6 `review_required`) |
| Staging export rows | **0** (not in MusicBrainz sidecar / manual sequences) |
| `1102` acoustic fallback | **not run** — requires ≥6 `ok`/`pending` stems; only 5 `ok` |

### Why `canonical_album_tracks` is still empty for 21

1. **Export** (`export_canonical_album_tracks_staging.py`) only emits sequences from `canonical-album-sequences.json` or `dossier-musicbrainz-by-rval.json` — Adele *21* is in neither.
2. **Staging import** had nothing to load for `RVAL182738`.
3. **Acoustic fallback** in `1102` did not qualify (5 `ok` stems, gate is 6). Quality gate intentionally not relaxed.

**Track-page primary album** still resolves via `canonical_track_album_links` → album **21** + **RVAL182738**. Cover uses graph `album_artwork_links` / overrides when present.

## Rolling in the Deep (RVTR672189)

| Resolver path | Album | RVAL | `canonical_track_key` |
|---------------|-------|------|------------------------|
| `canonical_album_tracks` | — | — | not linked |
| `canonical_track_album_links` | 21 | RVAL182738 | — |

After `1104_backfill_canonical_album_track_rvtr_keys.sql`: still no `cat` row until sequences exist.

## Assignment log

`exports/graph/album_external_keys_repair.csv` — one row per candidate with `skip_reason` when not assigned.

## Tooling added

| Artifact | Role |
|----------|------|
| `scripts/repair_missing_album_external_keys.ts` | Audit + deterministic RVAL assign |
| `integrity_console/sql/1104_repair_missing_album_external_keys.sql` | Optional CSV reload |
| `integrity_console/sql/1104_backfill_canonical_album_track_rvtr_keys.sql` | RVTR keys on `cat` rows |
| `1102` dedupe + `TRUNCATE staging` before `\copy` | Fixes duplicate-position load failures |

## Commands

```bash
npm run graph:repair-album-external-keys
npm run graph:canonical-album-tracks:export
npm run graph:canonical-album-tracks:load   # includes RVTR backfill
```

## Follow-up (data, not UI)

- Add Adele *21* to MusicBrainz sidecar or `canonical-album-sequences.json`, **or**
- Promote 1+ acoustic candidate from `review_required` → `ok` and re-run `1102` (keeps ≥6 gate)
