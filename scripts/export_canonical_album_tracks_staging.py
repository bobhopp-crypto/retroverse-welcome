#!/usr/bin/env python3
"""
Export canonical album track sequences for graph load (1102).

Sequence priority per RVAL:
  1. manual canonical-album-sequences.json
  2. MusicBrainz dossier sidecar
  3. musicbrainz_cache (recovery / MB album cache by artist+title)
  4. existing canonical_album_tracks
  5. canonical_album_sequence_candidates (lineage_acoustic, acoustic_consensus, …)

Run:
  python3 scripts/build_canonical_album_sequence_recovery.py
  python3 scripts/export_canonical_album_tracks_staging.py
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
MB_SIDECAR = Path(
    "/Users/bobhopp/RETROVERSE_DATA/runtime/dossier-musicbrainz-by-rval.json"
)
MB_CACHE = Path(
    "/Users/bobhopp/Sites/retroverse/data/derived/albums/source_musicbrainz_album_cache.json"
)
MANUAL_SEQ = WORKSPACE / "public/data/albums/canonical-album-sequences.json"
OUT_CSV = WORKSPACE / "exports/graph/canonical_album_tracks_staging.csv"

MIN_TRACKS = 6

HARD_POLLUTED = re.compile(
    r"\b(2008|25th|anniversary|interview|voice[- ]?over|excerpt|karaoke|quincy|"
    r"carousel|for all time|bonus|deluxe|rough|outtake|sessions?|alternate|"
    r"underground|home demo|remix|reprise)\b",
    re.I,
)
VARIANT_TAIL = re.compile(
    r"\b(live|remaster(?:ed)?|mono|stereo|demo|session|rough|outtake|alternate|"
    r"version|edit|mix|acoustic|instrumental|karaoke|reprise|single version)\b",
    re.I,
)

RECOVERY_SOURCE_ORDER = [
    "musicbrainz_cache",
    "existing_canonical_album_tracks",
    "lineage_acoustic",
    "acoustic_consensus",
    "billboard_chart_anchor",
    "acoustic_fallback_order",
]

CANONICAL_SOURCE_LABEL = {
    "manual_canonical_sequence": "manual_canonical_sequence",
    "musicbrainz_cache": "musicbrainz_cache",
    "musicbrainz_sidecar": "musicbrainz_cache",
    "existing_canonical_album_tracks": "existing_canonical_album_tracks",
    "lineage_acoustic": "lineage_acoustic_recovery",
    "acoustic_consensus": "acoustic_consensus_recovery",
    "billboard_chart_anchor": "billboard_chart_anchor_recovery",
    "acoustic_fallback_order": "acoustic_fallback_order",
}


def norm_key(*parts: str) -> str:
    blob = " ".join(p for p in parts if p).strip().lower()
    blob = re.sub(r"[^\w\s]", " ", blob)
    blob = re.sub(r"\s+", " ", blob).strip()
    return blob


def norm_title(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("–", "-")
        .replace("—", "-")
    )


def split_stem(raw: str) -> str:
    t = raw.strip()
    idx = t.find(" - ")
    if idx == -1:
        return t
    head, tail = t[:idx].strip(), t[idx + 3 :].strip()
    if VARIANT_TAIL.search(tail):
        return head
    return t


def score_acoustic(canon: str, song: str, position: int | None, mb_pos: int | None) -> int:
    cn = norm_key(canon)
    sn = norm_key(song)
    stem = norm_key(split_stem(song))
    score = 0
    if sn == cn or stem == cn:
        score += 120
    elif sn.startswith(cn + " ") or stem.startswith(cn + " "):
        score += 70
    elif len(cn) >= 4 and (cn in sn or cn in stem):
        score += 35
    if HARD_POLLUTED.search(song):
        score -= 150
    elif re.search(r"\b(single version|remaster|demo|mix)\b", song, re.I) and stem != cn:
        score -= 90
    elif re.search(r"\b(single version|remaster)\b", song, re.I) and stem == cn:
        score -= 8
    if position is not None and mb_pos == position:
        score += 45
    return score


def psql_copy(sql: str, host: str, database: str, user: str) -> str:
    return subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )


def load_acoustic_by_album(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT al.id::text, sat.id::text, sat.source_song
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        JOIN staging_acoustic_tracks sat
          ON lower(trim(sat.source_album)) = lower(trim(al.title))
         AND lower(trim(sat.source_artist)) = lower(trim(ar.canonical_name))
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    out: dict[int, list[dict]] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = next(csv.reader([line]))
        if len(parts) < 3:
            continue
        album_id = int(parts[0])
        out.setdefault(album_id, []).append({"id": int(parts[1]), "song": parts[2]})
    return out


def load_album_meta(host: str, database: str, user: str) -> dict[str, dict]:
    sql = """
      COPY (
        SELECT upper(trim(aek.external_key)), al.id::text, ar.canonical_name, al.title
        FROM album_external_keys aek
        JOIN albums al ON al.id = aek.album_id
        JOIN artists ar ON ar.id = al.artist_id
        WHERE aek.external_key ~* '^RVAL[0-9]{6}$'
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = psql_copy(sql, host, database, user)
    m: dict[str, dict] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 4:
            continue
        m[p[0].upper()] = {
            "album_id": int(p[1]),
            "artist": p[2],
            "title": p[3],
        }
    return m


def load_recovery_candidates(host: str, database: str, user: str) -> dict[int, dict[str, list[dict]]]:
    sql = """
      COPY (
        SELECT
          c.album_id::text,
          c.sequence_source,
          c.position,
          c.canonical_title,
          c.confidence_score::text,
          c.review_flag,
          coalesce(c.acoustic_staging_id::text, '')
        FROM canonical_album_sequence_candidates c
        ORDER BY c.album_id, c.sequence_source, c.position
      ) TO STDOUT WITH (FORMAT csv)
    """
    try:
        raw = psql_copy(sql, host, database, user)
    except subprocess.CalledProcessError:
        return {}
    out: dict[int, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for line in raw.splitlines():
        if not line.strip():
            continue
        p = next(csv.reader([line]))
        if len(p) < 6:
            continue
        aid = int(p[0])
        src = p[1]
        out[aid][src].append(
            {
                "position": int(p[2]),
                "title": p[3].strip(),
                "confidence": float(p[4]) if p[4] else 0.5,
                "review_flag": p[5],
                "acoustic_id": int(p[6]) if len(p) > 6 and p[6] else None,
            }
        )
    return out


def load_mb_cache_index() -> dict[str, dict]:
    if not MB_CACHE.is_file():
        return {}
    cache = json.loads(MB_CACHE.read_text(encoding="utf-8"))
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for entry in cache.values():
        if entry.get("match_status") != "matched":
            continue
        nk = norm_key(entry.get("matched_artist", ""), entry.get("matched_album", ""))
        if nk:
            by_norm[nk].append(entry)
    out: dict[str, dict] = {}
    for nk, items in by_norm.items():
        items.sort(key=lambda e: -(e.get("match_score") or 0))
        out[nk] = items[0]
    return out


def parse_top_tracks(raw: str) -> list[str]:
    return [t.strip() for t in (raw or "").split("|") if t.strip()]


def tracks_from_recovery(
    album_id: int,
    recovery: dict[int, dict[str, list[dict]]],
) -> tuple[list[dict] | None, str]:
    by_src = recovery.get(album_id, {})
    for src in RECOVERY_SOURCE_ORDER:
        seq = by_src.get(src, [])
        if len(seq) >= MIN_TRACKS:
            return (
                [
                    {
                        "position": tr["position"],
                        "title": tr["title"],
                        "source": CANONICAL_SOURCE_LABEL.get(src, src),
                        "confidence": tr["confidence"],
                        "mb_pos": tr["position"],
                        "review_flag": tr.get("review_flag", "ok"),
                        "acoustic_id": tr.get("acoustic_id"),
                    }
                    for tr in sorted(seq, key=lambda x: x["position"])
                ],
                src,
            )
    return None, ""


def tracks_from_mb_entry(entry: dict) -> list[dict] | None:
    titles = parse_top_tracks(entry.get("top_tracks", ""))
    if len(titles) < MIN_TRACKS:
        return None
    return [
        {
            "position": i + 1,
            "title": t,
            "source": "musicbrainz_cache",
            "confidence": 0.88,
            "mb_pos": i + 1,
            "review_flag": "ok",
            "acoustic_id": None,
        }
        for i, t in enumerate(titles)
    ]


def best_acoustic(
    album_id: int,
    title: str,
    position: int,
    acoustic_map: dict[int, list[dict]],
    preset_id: int | None = None,
) -> tuple[int | None, str]:
    if preset_id:
        for row in acoustic_map.get(album_id, []):
            if row["id"] == preset_id:
                return preset_id, row["song"]
    pool = acoustic_map.get(album_id, [])
    best_id: int | None = None
    best_score = 0
    best_song = ""
    for row in pool:
        if HARD_POLLUTED.search(row["song"]):
            continue
        sc = score_acoustic(title, row["song"], position, position)
        if sc > best_score:
            best_score = sc
            best_id = row["id"]
            best_song = row["song"]
    if best_score >= 50:
        return best_id, best_song
    return None, ""


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--host", default="localhost")
    p.add_argument("--database", default="retroverse")
    p.add_argument("--user", default="bobhopp")
    p.add_argument("--mb-sidecar", default=str(MB_SIDECAR))
    p.add_argument("--manual-seq", default=str(MANUAL_SEQ))
    p.add_argument("--out", default=str(OUT_CSV))
    args = p.parse_args()

    rval_meta = load_album_meta(args.host, args.database, args.user)
    acoustic_map = load_acoustic_by_album(args.host, args.database, args.user)
    recovery = load_recovery_candidates(args.host, args.database, args.user)
    mb_index = load_mb_cache_index()

    sequences: dict[str, list[dict]] = {}
    source_counts: dict[str, int] = defaultdict(int)

    manual_path = Path(args.manual_seq)
    if manual_path.is_file():
        manual = json.loads(manual_path.read_text(encoding="utf-8"))
        for rval, seq in (manual.get("sequences") or {}).items():
            rid = rval.upper()
            tracks = []
            for t in seq.get("tracks") or []:
                title = (t.get("canonical_title") or "").strip()
                if not title:
                    continue
                tracks.append(
                    {
                        "position": int(t["global_position"]),
                        "title": title,
                        "source": "manual_canonical_sequence",
                        "confidence": 1.0,
                        "mb_pos": int(t["global_position"]),
                        "review_flag": "ok",
                        "acoustic_id": None,
                    }
                )
            if len(tracks) >= MIN_TRACKS:
                sequences[rid] = tracks
                source_counts["manual"] += 1

    mb_path = Path(args.mb_sidecar)
    if mb_path.is_file():
        mb = json.loads(mb_path.read_text(encoding="utf-8"))
        for rval, blob in mb.items():
            rid = rval.upper()
            if rid in sequences:
                continue
            tracks_raw = blob.get("tracks") or []
            if not tracks_raw:
                top = (blob.get("top_tracks") or "").split("|") if isinstance(blob, dict) else []
                tracks_raw = [{"position": i + 1, "title": x.strip()} for i, x in enumerate(top) if x.strip()]
            tracks = []
            for row in tracks_raw:
                title = (row.get("title") or "").strip()
                pos = int(row.get("position") or 0)
                if not title or pos < 1:
                    continue
                tracks.append(
                    {
                        "position": pos,
                        "title": title,
                        "source": "musicbrainz_cache",
                        "confidence": 0.92,
                        "mb_pos": pos,
                        "review_flag": "ok",
                        "acoustic_id": None,
                    }
                )
            if len(tracks) >= MIN_TRACKS:
                sequences[rid] = sorted(tracks, key=lambda x: x["position"])
                source_counts["musicbrainz_sidecar"] += 1

    for rval, meta in sorted(rval_meta.items()):
        if rval in sequences:
            continue
        nk = norm_key(meta["artist"], meta["title"])
        album_id = meta["album_id"]

        entry = mb_index.get(nk)
        if entry:
            tr = tracks_from_mb_entry(entry)
            if tr:
                sequences[rval] = tr
                source_counts["musicbrainz_cache"] += 1
                continue

        tr, src = tracks_from_recovery(album_id, recovery)
        if tr:
            sequences[rval] = tr
            source_counts[src] += 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows_out: list[dict] = []
    beat_it_diag: dict | None = None

    for rval, tracks in sorted(sequences.items()):
        meta = rval_meta.get(rval)
        if not meta:
            continue
        album_id = meta["album_id"]
        for tr in tracks:
            ac_id, ac_song = best_acoustic(
                album_id,
                tr["title"],
                tr["position"],
                acoustic_map,
                tr.get("acoustic_id"),
            )
            rows_out.append(
                {
                    "external_key": rval,
                    "position": tr["position"],
                    "title": tr["title"],
                    "canonical_source": tr["source"],
                    "confidence_score": tr["confidence"],
                    "musicbrainz_position": tr["mb_pos"],
                    "acoustic_staging_id": ac_id or "",
                    "review_flag": tr.get("review_flag", "ok"),
                }
            )
            if rval == "RVAL586982" and norm_title(tr["title"]) == norm_title("Beat It"):
                pool = [r for r in acoustic_map.get(album_id, []) if "beat" in norm_title(r["song"])]
                beat_it_diag = {
                    "canonical_title": tr["title"],
                    "matched_acoustic_id": ac_id,
                    "matched_acoustic_song": ac_song,
                    "candidate_count": len(pool),
                }

    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "external_key",
                "position",
                "title",
                "canonical_source",
                "confidence_score",
                "musicbrainz_position",
                "acoustic_staging_id",
                "review_flag",
            ],
        )
        w.writeheader()
        w.writerows(rows_out)

    print(f"[canonical-tracks] wrote {len(rows_out)} rows → {out_path}")
    print(f"[canonical-tracks] albums {len(sequences)} with sequences")
    print(f"[canonical-tracks] sources: {dict(source_counts)}")
    adele = sequences.get("RVAL182738")
    if adele:
        print("[canonical-tracks] Adele 21 preview:", [t["title"] for t in adele[:5]], "…")


if __name__ == "__main__":
    main()
