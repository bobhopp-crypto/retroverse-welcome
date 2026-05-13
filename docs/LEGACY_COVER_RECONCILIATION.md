# Legacy cover archive reconciliation

Run id: `legacy_cover_recon_2026-05-10T00-53-11-621Z`
- Legacy roots: `/Users/bobhopp/Sites/retroverse/apps/web/public/covers`
- Mode: **APPLY (DB + public copy)**

## Step 1 — Legacy inventory

| Metric | Value |
|--------|-------|
| Total image files | 50011 |
| Files with RVAL parent folder or RVAL-prefixed name | 0 |

### Filename / folder patterns

| Pattern | Count |
|---------|-------|
| artist_-_album | 50010 |
| artist_-_album_space | 1 |

### Extensions

| Ext | Count |
|-----|-------|
| jpg | 50011 |

### Resolver conventions (this repo)

- Nested folder name `RVAL######` (canonical album id)
- Filename `RVAL######__slugified-artist__slugified-album.ext`
- Flat files: `Artist_-_Album.ext` or `Artist - Album.ext`

## Step 2 — Matching passes

| Pass | Meaning |
|------|---------|
| M | CSV mapping: `RETROVERSE_COVER_LEGACY_MAPPING` (use `rootLabel::relative` when multiple roots) |
| Id | Legacy path embeds same `RVAL` id as canonical album (folder or filename) |
| A | Exact normalized artist + album keys |
| B | Fuzzy keys (parentheticals, edition words, punctuation noise) |
| C | Token overlap / Jaccard on normalized artist + album tokens |
| C2 | Strong artist + partial album tokens |
| D | Loose staging fallback (shared tokens; favors matches over gaps) |

## Step 3 — Apply rules

- Skipped **curator / workbench** primaries: `workbench:`, `itunes_canonical_pass`, notes with `living-archive action=`, `curator_approved`, `manual_cover`.
- Skipped albums that already have a **local** `canonical_cover_path` (non-HTTP).
- **Id / A / M** → `artwork_status` **verified**; **B / C / C2 / D** → **pending** (staging: visible density; refine later).
- `cover_source` set to `legacy_sites_web_covers` (notes include `staging_pass=` A–D and technical `pass=`).

## Step 4 — Results

| Metric | Value |
|--------|-------|
| Eligible albums (missing local cover, not curator-locked) | 41064 |
| Planned matches (this run) | 37748 |
| Applied writes | 37748 |
| Unmatched legacy files | 12263 |
| Ambiguous tie warnings | 29840 |

### By pass

| Pass | Count |
|------|-------|
| A | 16690 |
| D | 11581 |
| C | 9042 |
| C2 | 357 |
| B | 78 |

### Discover corpus coverage (`computeDiscoverCoverageReport`)

| | Before | After |
|---|-----|-------|
| Usable albums | 41352 | 41352 |
| With any canonical_cover_path | 288 | 38036 |
| Without cover path | 41064 | 3316 |
| % covered | 0.7% | 92.0% |

## Artifacts

- Full JSON: `data/generated/legacy_cover_recon/legacy_cover_recon_2026-05-10T00-53-11-621Z.json`
- Resolver map: `data/generated/legacy_cover_recon/legacy_cover_recon_2026-05-10T00-53-11-621Z_resolver_map.json`

## Sample planned matches (first 30)

| Album | Pass | Legacy file |
|-------|------|-------------|
| RVAL000059 | D | `covers::album_covers/tory_lanez_-_i_told_you.jpg` |
| RVAL000173 | D | `covers::album_covers/soundtrack_orchestra_-_i_see_you_avatar_avatar_soundtrack.jpg` |
| RVAL000324 | D | `covers::album_covers/the_san_sebastian_strings_-_home_to_the_sea.jpg` |
| RVAL000392 | C | `covers::album_covers/ralph_tresvant_-_ralph_tresvant.jpg` |
| RVAL000698 | A | `covers::album_covers/joni_mitchell_-_mingus.jpg` |
| RVAL000763 | C | `covers::album_covers/various_artists_-_just_tell_me_that_you_want_me_a_tribute_to_fleetwood_mac.jpg` |
| RVAL000804 | D | `covers::album_covers/the_ws_-_fourth_from_the_last.jpg` |
| RVAL000891 | C | `covers::album_covers/meat_loaf_-_playlist_the_very_best_of_meat_loaf.jpg` |
| RVAL000935 | D | `covers::album_covers/the_cult_-_electric.jpg` |
| RVAL001020 | D | `covers::album_covers/robert_goulet_-_sincerely_yours.jpg` |
| RVAL001039 | C | `covers::album_covers/various_artists_-_the_buzz.jpg` |
| RVAL001199 | D | `covers::album_covers/the_hollies_-_evolution.jpg` |
| RVAL001279 | D | `covers::album_covers/tech_n9ne_-_ebah.jpg` |
| RVAL001341 | D | `covers::album_covers/chris_brown_-_fortune.jpg` |
| RVAL001388 | D | `covers::album_covers/the_pointer_sisters_-_energy.jpg` |
| RVAL001442 | C | `covers::album_covers/the_stylistics_-_cover_with_the_stylistics.jpg` |
| RVAL001822 | C | `covers::album_covers/various_artists_-_music_for_little_hipsters.jpg` |
| RVAL001937 | C | `covers::album_covers/the_airborne_toxic_event_-_the_airborne_toxic_event.jpg` |
| RVAL001996 | D | `covers::album_covers/david_phelps_-_classic.jpg` |
| RVAL002015 | D | `covers::album_covers/rod_stewart_-_rod_stewart.jpg` |
| RVAL002035 | C | `covers::album_covers/dick_hyman_his_orchestra_-_electrodynamics.jpg` |
| RVAL002119 | A | `covers::album_covers/yes_-_yessongs.jpg` |
| RVAL002199 | C | `covers::album_covers/lenny_williams_-_spark_of_love.jpg` |
| RVAL002210 | C | `covers::album_covers/grateful_dead_-_in_the_dark.jpg` |
| RVAL002220 | A | `covers::album_covers/cartel_-_cycles.jpg` |
| RVAL002272 | C | `covers::album_covers/the_five_stairsteps_-_stairsteps.jpg` |
| RVAL002278 | C | `covers::album_covers/various_artists_-_bad_boy_greatest_hits_volume_1.jpg` |
| RVAL002393 | D | `covers::album_covers/sublime_with_rome_-_yours_truly.jpg` |
| RVAL002442 | C | `covers::album_covers/various_artists_-_california_jam_2.jpg` |
| RVAL002524 | C | `covers::album_covers/kings_x_-_kings_x.jpg` |
