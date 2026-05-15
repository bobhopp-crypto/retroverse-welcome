# Billboard 200 album chart — source SQLite forensics

**Phase:** inspection only (no Supabase or SQLite mutations).  
**DB inspected:** `/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db`  
**File:** ~123 MB, modified **2019-10-21**.  
**Alternate path:** `/Users/bobhopp/Sites/retroverse/raw-data/billboard-200-albums-charts.db` is **empty** (0 bytes); use `data/raw/charts/` copy only.

Repo references: `scripts/build_master_dataset.ts`, `apps/music-browser/scripts/export_album_charts_by_year.py`, `docs/DATA_LINEAGE.md` (Sites/retroverse).

---

## 1. Table inventory

| Table               | Role                                      | Row count |
|---------------------|-------------------------------------------|-----------|
| `albums`            | **Weekly chart positions** (one row = one album listing on one chart date) | **573,947** |
| `acoustic_features` | Per-track (or track-like) Spotify-style audio metrics; **not** the chart spine | **339,855** |

No separate “chart run”, “appearance”, or “week” table: chart history is **fully denormalized** in `albums`.

---

## 2. Schema summary

### `albums`

```sql
CREATE TABLE albums (
  id integer primary key,
  date text,
  artist text,
  album text,
  rank text,
  length integer,
  track_length real
);
```

- **Primary key:** `id` (surrogate integer only).  
- **Logical chart row:** `(date, rank)` *should* be unique for a Billboard 200 week; `(date, artist, album)` should appear at most once per week for a given catalog title (exceptions below).  
- **`rank`:** stored as **TEXT**; in practice **573,946 / 573,947** rows cast cleanly to integers **1–500** range (effectively 1–200 for modern era).  
- **`length`:** integer (often track count or album length proxy — **not** used as a lineage key; see Ray Charles case).  
- **`track_length`:** real; frequently NULL.  
- **No columns for:** chart lineage id, mono/stereo, catalog number, label, re-entry flag, source URL, import timestamp, issue id.

**Indexes:** none on `albums` (only PK).  
**Null/empty spot checks:** `date` empty **1** row; `artist` empty **65**; `album` empty **1**; `rank` empty **1**.

**Date span:** `1963-01-05` → `2019-01-19` (weekly `YYYY-MM-DD` strings).

### `acoustic_features`

```sql
CREATE TABLE acoustic_features (
  id text primary key,
  song text, album text, artist text,
  acousticness … valence float,
  album_id text, date text
);
```

- **Primary key:** `id` (text — external/id string, not FK to `albums.id`).  
- **`album_id`:** high-cardinality opaque ids (e.g. base62-style), **257,780** distinct among 339,855 rows — **join to chart is name/date-ish, not relational**.  
- **Purpose:** acoustic / production features for ML or enrichment — **orthogonal** to canonical weekly rank spine.

---

## 3. Candidate keys (theoretical)

| Grain                         | Unique in clean data? | In this file |
|------------------------------|------------------------|--------------|
| `(id)`                       | Yes                    | Yes          |
| `(date, rank)`               | Yes for Billboard 200  | **Violated** (see §5) |
| `(date, artist, album, rank)` | Often assumed         | **Violated** by exact duplicate rows (see §4) |
| `(date, artist, album)`      | One position / week    | **Violated** (multi-rank; see §5) |

---

## 4. Duplicate weekly album entries (A)

### 4a Exact duplicate rows (same chart fact repeated)

Grouped by **full tuple**  
`(date, artist, album, rank, length, track_length)`:

- **78** groups with `COUNT(*) > 1`.  
- **216** excess rows (`SUM(c-1)` over those groups).  
- Affected **42** distinct `date` values (clustered; classic example **Ray Charles** / **Modern Sounds…** weeks with **4×** identical rows per `(date,rank)`).

Example (`1963-08-31`, rank **68**): four rows, **same** artist/album/rank/length — only `id` differs (`568757`–`568760`).

**Conclusion:** **True duplicate rows exist in the source SQLite** before any Supabase import. This is **not** only a downstream merge issue.

### 4b Same `(date, artist, album)` multiple rows (any rank)

- **93** `(date, artist, album)` groups with `COUNT(*) > 1` on raw table (includes the quadruplication above).

After **`SELECT DISTINCT date, artist, album, rank, length, track_length`**:

- **573,731** rows (**216** duplicates removed).

---

## 5. Conflicting weekly positions (B)

### 5a Same album *string* + same week + **different** ranks

On **deduped** chart rows (`DISTINCT` as above):

- **87** `(date, artist, album)` keys with **`COUNT(DISTINCT rank) > 1`**.  
- **378** physical rows participate in those groups.

Dominant pattern: **Ray Charles — *Modern Sounds In Country And Western Music*** appears on **58** distinct weeks with **two ranks the same week** (e.g. `1963-01-05` ranks **48** and **59**). **`length` and `track_length` are identical** across both ranks — the schema **does not** encode Volume I vs Volume II; both volumes historically charted under the **same title**, so the raw DB is **ambiguous** rather than randomly corrupt.

Other titles with multi-rank same week (smaller counts): Jane Fonda workout, Eurythmics *Touch*, Intocable *La Historia*, Zac Brown *The Foundation*, comps, “Best of” sets, Hendrix anthology — plausible **multi-disc / multi-SKU / reissue** collisions or **listing variants** without a catalog key.

### 5b Same `(date, rank)` — **different** albums (impossible on a strict 200 chart)

After the same `DISTINCT` dedupe:

- **11** `(date, rank)` slots where **two or more distinct** `(artist, album)` rows share the same week + rank.

Examples:

| date       | rank | artists / albums |
|-----------|------|------------------|
| 1964-03-28 | 58  | *My Fair Lady* vs *The Sound Of Music* (both “Original Cast”) |
| 1981-01-31 | 64  | Beatles **1962–1966** vs **1967–1970** (same rank same week) |

**Conclusion:** These are **hard data conflicts** in the source (scraping error, mis-assigned rank, or merged sources). They are **not** explained by dual-volume same title.

---

## 6. Pre-import corruption vs import-time duplication

| Issue | Evidence in source SQLite? |
|-------|-----------------------------|
| Exact row duplication | **Yes** — 216 redundant rows, quadruplication pattern on some 1963 weeks. |
| Same title two ranks same week | **Yes** — remains after dedupe; historically plausible for **Vol I / II** where Billboard used one title; schema cannot disambiguate. |
| Same rank two albums same week | **Yes** — 11 cases after dedupe; **not** Billboard-valid without a tie rule; treat as **errors** for canonical spine. |
| Supabase-only duplication | **Cannot be concluded from this file**; this audit only proves **upstream** issues already exist. |

---

## 7. Recommended canonicalization strategy (design only)

**Target:** `canonical_album_chart_runs` — one album identity × one chart week × one rank, deterministic.

1. **Dedupe pass (deterministic):** collapse rows with identical `(date, artist, album, rank, length, track_length)`; keep `MIN(id)` (or arbitrary stable pick).

2. **Repair `(date, rank)` collisions:** build a **quarantine list** of 11 facts; resolve using **second primary source** (Billboard PDF/issue, official API, or hand-curated patch table). Do not guess from neighbors alone.

3. **Resolve `(date, artist, album)` multi-rank:**  
   - Prefer **external catalog key** (not present today): UPC, LPN, `catalog_no`, “volume” token in title if ever normalized.  
   - Interim heuristics (documented, versioned): e.g. median filter across adjacent weeks, or split into **two chart identities** only when a trusted mapping exists.  
   - Ray Charles–class cases: treat as **two concurrent SKUs** under one display title until catalog metadata exists.

4. **Stable album key:** derive `retroverse_album_id` (or equivalent) **outside** this SQLite via alignment to your canonical album table; do not use `albums.id` as product album id.

5. **Acoustic features:** keep **out of** the chart spine; join later for enrichment via `(album_id)` / fuzzy `(artist, album, era)` as today.

6. **Versioning:** stamp `source_file_sha256`, `dedupe_rule_version`, and `conflict_resolution_version` on any derived table for auditability.

---

## 8. Quick SQL reference (read-only)

```sql
-- Table counts
SELECT 'albums', COUNT(*) FROM albums
UNION ALL SELECT 'acoustic_features', COUNT(*) FROM acoustic_features;

-- Exact duplicate tuples
SELECT date, artist, album, rank, length, track_length, COUNT(*) c
FROM albums
GROUP BY 1,2,3,4,5,6
HAVING c > 1;

-- Multi-rank same title same week (after dedupe)
WITH d AS (
  SELECT DISTINCT date, artist, album, rank, length, track_length FROM albums
)
SELECT date, artist, album, COUNT(DISTINCT rank) ranks
FROM d
GROUP BY 1,2,3
HAVING ranks > 1;

-- Impossible: two albums same date+rank (after dedupe)
WITH d AS (
  SELECT DISTINCT date, artist, album, rank, length, track_length FROM albums
)
SELECT date, rank, COUNT(*) c
FROM d
GROUP BY 1,2
HAVING c > 1;
```

---

*Generated from live `sqlite3` inspection of the file above; no writes performed.*
