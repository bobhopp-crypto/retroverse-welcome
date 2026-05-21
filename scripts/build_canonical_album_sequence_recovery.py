#!/usr/bin/env python3
"""
Build canonical_album_sequence_candidates from recovery sources.

Sources (stored per row; export picks by priority):
  existing_canonical_album_tracks, musicbrainz_cache, lineage_acoustic,
  acoustic_consensus, billboard_chart_anchor, acoustic_fallback_order

Run:
  python3 scripts/build_canonical_album_sequence_recovery.py
  npm run graph:canonical-album-tracks:export
  npm run graph:canonical-album-tracks:load
"""

from __future__ import annotations

import csv
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[1]
MB_CACHE = Path(
    "/Users/bobhopp/Sites/retroverse/data/derived/albums/source_musicbrainz_album_cache.json"
)
OUT_REPORT = WORKSPACE / "reports/album_sequence_recovery_summary.json"
OUT_CSV = WORKSPACE / "exports/graph/canonical_album_sequence_candidates.csv"

POLLUTED = re.compile(
    r"\b(2008|25th|anniversary|interview|voice[- ]?over|excerpt|karaoke|quincy|"
    r"carousel|for all time|bonus|deluxe|rough|outtake|sessions?|alternate|"
    r"underground|home demo|remix|reprise|commentary|unplugged)\b",
    re.I,
)
VARIANT_TAIL = re.compile(
    r"\b(live|remaster(?:ed)?|mono|stereo|demo|session|rough|outtake|alternate|"
    r"version|edit|mix|acoustic|instrumental|karaoke|reprise|single version)\b",
    re.I,
)

SOURCE_PRIORITY = {
    "existing_canonical_album_tracks": 3,
    "musicbrainz_cache": 2,
    "lineage_acoustic": 4,
    "acoustic_consensus": 5,
    "billboard_chart_anchor": 6,
    "acoustic_fallback_order": 7,
}


def norm_key(*parts: str) -> str:
    blob = " ".join(p for p in parts if p).strip().lower()
    blob = re.sub(r"[^\w\s]", " ", blob)
    return re.sub(r"\s+", " ", blob).strip()


def norm_title(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("–", "-")
        .replace("—", "-")
    )


def canonical_stem(raw: str) -> str:
    t = raw.strip()
    idx = t.find(" - ")
    if idx == -1:
        return t
    head, tail = t[:idx].strip(), t[idx + 3 :].strip()
    if VARIANT_TAIL.search(tail) or POLLUTED.search(tail):
        return head
    return t


def is_polluted(song: str) -> bool:
    return bool(POLLUTED.search(song) or VARIANT_TAIL.search(song))


def psql_copy(sql: str, host: str, database: str, user: str) -> str:
    return subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )


def load_albums(host: str, database: str, user: str) -> list[dict]:
    sql = """
      COPY (
        SELECT
          al.id::text,
          upper(trim(aek.external_key)),
          ar.canonical_name,
          al.title,
          al.release_year,
          (SELECT count(*)::int FROM canonical_album_tracks cat WHERE cat.album_id = al.id),
          EXISTS (SELECT 1 FROM chart_appearances ca
                  WHERE ca.album_id = al.id AND ca.chart_name = 'Billboard 200'),
          (SELECT count(*)::int FROM canonical_track_album_links ctal WHERE ctal.album_id = al.id)
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        JOIN album_external_keys aek ON aek.album_id = al.id
        WHERE aek.external_key ~* '^RVAL[0-9]{6}$'
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    rows: list[dict] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 8:
            continue
        rows.append(
            {
                "album_id": int(p[0]),
                "rval": p[1],
                "artist": p[2],
                "title": p[3],
                "release_year": int(p[4]) if p[4] else None,
                "cat_count": int(p[5]),
                "has_bb200": p[6] == "t",
                "ctal_count": int(p[7]),
            }
        )
    return rows


def load_mb_index() -> dict[str, dict]:
    if not MB_CACHE.is_file():
        return {}
    cache = json.loads(MB_CACHE.read_text(encoding="utf-8"))
    by_norm: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for key, entry in cache.items():
        if entry.get("match_status") != "matched":
            continue
        nk = norm_key(entry.get("matched_artist", ""), entry.get("matched_album", ""))
        if nk:
            by_norm[nk].append((key, entry))
    out: dict[str, dict] = {}
    for nk, items in by_norm.items():
        items.sort(key=lambda x: -(x[1].get("match_score") or 0))
        out[nk] = items[0][1]
    return out


def parse_top_tracks(raw: str) -> list[str]:
    return [t.strip() for t in (raw or "").split("|") if t.strip()]


def load_existing_cat(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT cat.album_id::text, cat.position, cat.title, cat.acoustic_source_id::text
        FROM canonical_album_tracks cat
        ORDER BY cat.album_id, cat.position
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    out: dict[int, list[dict]] = defaultdict(list)
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 3:
            continue
        aid = int(p[0])
        out[aid].append(
            {
                "position": int(p[1]),
                "title": p[2].strip(),
                "acoustic_id": int(p[3]) if len(p) > 3 and p[3] else None,
            }
        )
    return out


def load_lineage(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT
          atl.album_id::text,
          atl.sequence_index,
          atl.track_number,
          coalesce(sat.source_song, t.title, '') AS title,
          sat.id::text
        FROM album_track_lineage atl
        LEFT JOIN staging_acoustic_tracks sat
          ON atl.source_provenance = 'acoustics'
         AND sat.content_hash = regexp_replace(atl.source_row_hash, '^acoustic:', '')
        LEFT JOIN tracks t ON t.id = atl.track_id
        WHERE atl.album_id IS NOT NULL
        ORDER BY atl.album_id, atl.sequence_index
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    out: dict[int, list[dict]] = defaultdict(list)
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 4:
            continue
        title = canonical_stem(p[3].strip())
        if not title or is_polluted(title):
            continue
        out[int(p[0])].append(
            {
                "position": int(p[1]) if p[1] else int(p[2] or 0),
                "title": title,
                "acoustic_id": int(p[4]) if len(p) > 4 and p[4] else None,
            }
        )
    return out


def load_acoustic_pool(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT al.id::text, sat.id::text, sat.source_song, sat.source_release_year
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        JOIN staging_acoustic_tracks sat
          ON lower(trim(sat.source_album)) = lower(trim(al.title))
         AND lower(trim(sat.source_artist)) = lower(trim(ar.canonical_name))
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    out: dict[int, list[dict]] = defaultdict(list)
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 3:
            continue
        song = p[2].strip()
        if is_polluted(song):
            continue
        out[int(p[0])].append(
            {
                "id": int(p[1]),
                "song": song,
                "stem": canonical_stem(song),
                "year": int(p[3]) if len(p) > 3 and p[3] else None,
            }
        )
    return out


def load_chart_anchor_order(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT
          ctal.album_id::text,
          ct.canonical_title,
          ct.first_chart_date::text,
          ct.peak_hot100_position
        FROM canonical_track_album_links ctal
        JOIN canonical_tracks ct ON ct.track_family_id = ctal.track_family_id
        WHERE ct.has_hot100 AND ct.first_chart_date IS NOT NULL
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    by_album: dict[int, list[dict]] = defaultdict(list)
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 4:
            continue
        by_album[int(p[0])].append(
            {
                "title": p[1].strip(),
                "first_chart": p[2],
                "peak": int(p[3]) if p[3] else 999,
            }
        )
    out: dict[int, list[dict]] = {}
    for aid, tracks in by_album.items():
        tracks.sort(key=lambda x: (x["first_chart"], x["peak"]))
        out[aid] = [
            {"position": i + 1, "title": t["title"], "acoustic_id": None}
            for i, t in enumerate(tracks)
        ]
    return out


def cluster_acoustic(rows: list[dict]) -> list[dict]:
    clusters: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        key = norm_key(row["stem"])
        if key:
            clusters[key].append(row)
    picked: list[dict] = []
    for key, items in clusters.items():
        items.sort(
            key=lambda r: (
                1 if POLLUTED.search(r["song"]) else 0,
                r["year"] or 9999,
                len(r["song"]),
                r["id"],
            )
        )
        best = items[0]
        picked.append(
            {
                "cluster": key,
                "title": best["stem"],
                "acoustic_id": best["id"],
                "year": best["year"],
            }
        )
    return picked


def merge_chart_anchor_with_lineage(
    chart_seq: list[dict],
    lineage_seq: list[dict],
    acoustic_clusters: list[dict],
) -> list[dict]:
    """Interleave non-chart lineage titles after chart-anchored singles (heuristic)."""
    if not chart_seq:
        return []
    chart_titles = {norm_title(t["title"]) for t in chart_seq}
    extras = [
        t
        for t in lineage_seq
        if norm_title(t["title"]) not in chart_titles
    ]
    if not extras and acoustic_clusters:
        extra_keys = {c["cluster"] for c in acoustic_clusters} - {
            norm_key(canonical_stem(t["title"])) for t in chart_seq
        }
        extras = [
            {"title": c["title"], "acoustic_id": c["acoustic_id"]}
            for c in acoustic_clusters
            if c["cluster"] in extra_keys
        ]
    merged = list(chart_seq)
    pos = len(merged) + 1
    for ex in extras:
        merged.append({"position": pos, "title": ex["title"], "acoustic_id": ex.get("acoustic_id")})
        pos += 1
    return merged


def renumber(seq: list[dict]) -> list[dict]:
    out = []
    for i, row in enumerate(seq, start=1):
        out.append({**row, "position": i})
    return out


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--host", default="localhost")
    p.add_argument("--database", default="retroverse")
    p.add_argument("--user", default="bobhopp")
    p.add_argument("--min-tracks", type=int, default=6)
    args = p.parse_args()

    albums = load_albums(args.host, args.database, args.user)
    mb_index = load_mb_index()
    existing_cat = load_existing_cat(args.host, args.database, args.user)
    lineage = load_lineage(args.host, args.database, args.user)
    acoustic = load_acoustic_pool(args.host, args.database, args.user)
    chart_anchor = load_chart_anchor_order(args.host, args.database, args.user)

    all_rows: list[dict] = []
    tier_counts: dict[str, int] = defaultdict(int)
    album_best: dict[int, str] = {}
    spotlight: dict[str, list[dict]] = {}

    for alb in albums:
        aid = alb["album_id"]
        nk = norm_key(alb["artist"], alb["title"])

        def emit(source: str, seq: list[dict], confidence: float, review: str = "ok") -> None:
            if len(seq) < args.min_tracks:
                return
            tier_counts[source] += 1
            for tr in seq:
                all_rows.append(
                    {
                        "album_id": aid,
                        "position": tr["position"],
                        "canonical_title": tr["title"],
                        "sequence_source": source,
                        "confidence_score": confidence,
                        "review_flag": review,
                        "acoustic_staging_id": tr.get("acoustic_id") or "",
                        "variant_cluster_key": tr.get("cluster") or norm_key(tr["title"]),
                        "musicbrainz_position": tr["position"],
                    }
                )

        if aid in existing_cat and len(existing_cat[aid]) >= args.min_tracks:
            emit("existing_canonical_album_tracks", existing_cat[aid], 0.95)

        entry = mb_index.get(nk)
        if entry and entry.get("top_tracks"):
            titles = parse_top_tracks(entry["top_tracks"])
            if len(titles) >= args.min_tracks:
                seq = [
                    {"position": i + 1, "title": t, "acoustic_id": None}
                    for i, t in enumerate(titles)
                ]
                emit("musicbrainz_cache", seq, 0.88)

        lin = lineage.get(aid, [])
        if lin:
            lin = renumber(lin)
            emit("lineage_acoustic", lin, 0.74, "review_required")

        pool = acoustic.get(aid, [])
        clusters = cluster_acoustic(pool)
        if len(clusters) >= args.min_tracks:
            clusters.sort(key=lambda c: (c["year"] or 9999, c["title"]))
            seq = renumber(
                [
                    {
                        "position": i + 1,
                        "title": c["title"],
                        "acoustic_id": c["acoustic_id"],
                        "cluster": c["cluster"],
                    }
                    for i, c in enumerate(clusters)
                ]
            )
            emit("acoustic_consensus", seq, 0.70, "review_required")

        chart = chart_anchor.get(aid, [])
        if chart and len(chart) >= 3:
            merged = merge_chart_anchor_with_lineage(chart, lin, clusters)
            if len(merged) >= args.min_tracks:
                emit("billboard_chart_anchor", renumber(merged), 0.62, "review_required")

        if pool and len(clusters) >= args.min_tracks:
            ordered = sorted(pool, key=lambda r: r["id"])
            seen: set[str] = set()
            seq = []
            for row in ordered:
                k = norm_key(row["stem"])
                if k in seen:
                    continue
                seen.add(k)
                seq.append(
                    {
                        "position": len(seq) + 1,
                        "title": row["stem"],
                        "acoustic_id": row["id"],
                        "cluster": k,
                    }
                )
            emit("acoustic_fallback_order", seq, 0.55, "review_required")

        if nk == norm_key("adele", "21"):
            spotlight["adele_21"] = [r for r in all_rows if r["album_id"] == aid]

        sources = {r["sequence_source"] for r in all_rows if r["album_id"] == aid}
        if sources:
            best = min(sources, key=lambda s: SOURCE_PRIORITY.get(s, 99))
            album_best[aid] = best

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "album_id",
        "position",
        "canonical_title",
        "sequence_source",
        "confidence_score",
        "review_flag",
        "acoustic_staging_id",
        "variant_cluster_key",
        "musicbrainz_position",
    ]
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(all_rows)

    # Load into PG
    subprocess.check_call(
        [
            "psql",
            "-h",
            args.host,
            "-U",
            args.user,
            "-d",
            args.database,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(WORKSPACE / "integrity_console/sql/1105_canonical_album_sequence_candidates_schema.sql"),
        ]
    )
    subprocess.check_call(
        [
            "psql",
            "-h",
            args.host,
            "-U",
            args.user,
            "-d",
            args.database,
            "-c",
            "TRUNCATE canonical_album_sequence_candidates",
        ]
    )
    subprocess.check_call(
        [
            "psql",
            "-h",
            args.host,
            "-U",
            args.user,
            "-d",
            args.database,
            "-c",
            f"\\copy canonical_album_sequence_candidates ({', '.join(fields)}) "
            f"FROM '{OUT_CSV}' CSV HEADER",
        ]
    )

    cat_before = int(
        psql_copy(
            "COPY (SELECT count(*)::text FROM canonical_album_tracks) TO STDOUT",
            args.host,
            args.database,
            args.user,
        ).strip()
    )

    report = {
        "albums_with_rval": len(albums),
        "candidate_rows": len(all_rows),
        "sources_by_album_count": dict(tier_counts),
        "albums_with_any_recovery_source": len(album_best),
        "canonical_album_tracks_before": cat_before,
        "spotlight_adele_21": spotlight.get("adele_21", []),
    }
    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"[sequence-recovery] candidate rows: {len(all_rows)}")
    print(f"[sequence-recovery] albums with recovery source: {len(album_best)}")
    print(f"[sequence-recovery] by source: {dict(tier_counts)}")
    print(f"[sequence-recovery] report → {OUT_REPORT}")


if __name__ == "__main__":
    main()
