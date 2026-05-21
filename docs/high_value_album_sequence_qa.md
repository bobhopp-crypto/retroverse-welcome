# High-value album sequence QA

Generated: 2026-05-21  
Pipeline: QA scan → targeted overrides → export (`merge_hot100_gaps`) → load

## Summary

| Metric | Count |
|--------|------:|
| High-value albums checked | 21,670 |
| Albums flagged | 15,346 |
| Repair candidates (dry-run) | ~879 |
| **Overrides written** | **1** (Adele *21* full LP) |
| Export Hot 100 gap merge | **433** albums |
| Albums needing manual review | ~2,928 |
| `canonical_album_tracks` before QA reload | 197,942 |
| `canonical_album_tracks` after QA reload | **198,568** |

High-value = Billboard 200 and/or Hot 100–linked tracks and/or VDJ-linked artist catalog.

## Checks

1. Sequence count &lt; 6 or zero rows  
2. Hot 100 singles on album missing from `canonical_album_tracks`  
3. MusicBrainz cache `track_count` &gt; parsed `top_tracks` (truncation)  
4. Duplicate normalized titles on same album  
5. Variant/remaster pollution in titles  

## Repairs applied

### Adele — 21 (`RVAL182738`)

| | Tracks |
|---|--------|
| **Before** | 10 — MB cache omitted **Someone Like You** |
| **After** | **11** — full standard LP via `qa_high_value_override` |

1. Rolling in the Deep (`RVTR672189`)  
2. Rumour Has It  
3. Turning Tables  
4. Don't You Remember  
5. Set Fire to the Rain  
6. He Won't Go  
7. Take It All  
8. I'll Be Waiting  
9. One and Only  
10. Lovesong  
11. **Someone Like You** (`RVTR165509`)  

### Export-level gap merge

`export_canonical_album_tracks_staging.py` appends missing Hot 100 singles when `track_count` &gt; sequence length (**433** albums this run). Does not reorder LP — only fills omissions.

## Flag breakdown (top)

| Issue | Albums |
|-------|-------:|
| `mb_cache_underfill` | 12,054 |
| `mb_top_tracks_truncated` | 12,054 |
| `no_sequence` | 2,749 |
| `missing_hot100_track` | 1,101 |
| `duplicate_normalized_title` | 375 |
| `variant_pollution` | 168 |
| `short_sequence` | 25 |

## Top 50 unresolved (sample)

Albums still flagged after override + gap merge — often compilations, MB truncation with many non–Hot 100 album tracks, or no clean acoustic LP.

See `reports/high_value_album_sequence_qa.json` for machine-readable list.

Examples: Travis Scott *ASTROWORLD*, Taylor Swift *1989*, Beyoncé *4*, compilation greatest-hits rows with 38+ polluted positions.

## Commands

```bash
npm run graph:qa-album-sequences          # --apply writes overrides (Adele 21)
npm run graph:canonical-tracks:export:fast
npm run graph:canonical-album-tracks:load
```

## Verify

- Album **21** page: 11-track LP, no remaster tails  
- **Rolling in the Deep** → album 21, `canonical_track_key` RVTR672189  
- **Someone Like You** on album sequence position 11  
