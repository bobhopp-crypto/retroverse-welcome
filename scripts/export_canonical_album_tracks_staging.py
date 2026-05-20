#!/usr/bin/env python3
"""
Export canonical album track sequences for graph load (1102).

Priority per RVAL: manual canonical-album-sequences.json > musicbrainz sidecar.
Attaches best staging_acoustic_tracks row per canonical title (enrichment only).

Run:
  python3 scripts/export_canonical_album_tracks_staging.py
  psql ... -f integrity_console/sql/1102_populate_canonical_album_tracks.sql
"""

from __future__ import annotations

import csv
import json
import re
import subprocess
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[1]
MB_SIDECAR = Path(
    "/Users/bobhopp/RETROVERSE_DATA/runtime/dossier-musicbrainz-by-rval.json"
)
MANUAL_SEQ = WORKSPACE / "public/data/albums/canonical-album-sequences.json"
OUT_CSV = WORKSPACE / "exports/graph/canonical_album_tracks_staging.csv"

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


def norm_key(*parts: str) -> str:
    blob = " ".join(p for p in parts if p).lower()
    blob = re.sub(r"[^\w\s]", " ", blob)
    blob = re.sub(r"\s+", " ", blob).strip()
    return blob


def norm_title(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("\u2019", "'")
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


def load_acoustic_by_album(host: str, database: str, user: str) -> dict[int, list[dict]]:
    sql = """
      COPY (
        SELECT
          al.id::text,
          sat.id::text,
          sat.source_song,
          sat.source_release_year,
          sat.source_duration,
          sat.acousticness,
          sat.danceability,
          sat.energy,
          sat.valence
        FROM albums al
        JOIN artists ar ON ar.id = al.artist_id
        JOIN staging_acoustic_tracks sat
          ON lower(trim(sat.source_album)) = lower(trim(al.title))
         AND lower(trim(sat.source_artist)) = lower(trim(ar.canonical_name))
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )
    out: dict[int, list[dict]] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = next(csv.reader([line]))
        if len(parts) < 3:
            continue
        album_id = int(parts[0])
        row = {
            "id": int(parts[1]),
            "song": parts[2],
            "year": int(parts[3]) if len(parts) > 3 and parts[3] else None,
            "duration": int(parts[4]) if len(parts) > 4 and parts[4] else None,
        }
        out.setdefault(album_id, []).append(row)
    return out


def load_album_id_by_rval(host: str, database: str, user: str) -> dict[str, int]:
    sql = """
      COPY (
        SELECT external_key, album_id::text
        FROM album_external_keys
        WHERE external_key ~* '^RVAL[0-9]{6}$'
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )
    m: dict[str, int] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = next(csv.reader([line]))
        if len(parts) >= 2:
            m[parts[0].upper()] = int(parts[1])
    return m


def best_acoustic(
    album_id: int,
    title: str,
    position: int,
    acoustic_map: dict[int, list[dict]],
) -> tuple[int | None, str]:
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

    rval_to_album = load_album_id_by_rval(args.host, args.database, args.user)
    acoustic_map = load_acoustic_by_album(args.host, args.database, args.user)

    sequences: dict[str, list[dict]] = {}

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
                    }
                )
            if tracks:
                sequences[rid] = tracks

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
                    }
                )
            if tracks:
                sequences[rid] = sorted(tracks, key=lambda x: x["position"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows_out: list[dict] = []
    beat_it_diag: dict | None = None

    for rval, tracks in sorted(sequences.items()):
        album_id = rval_to_album.get(rval)
        if not album_id:
            continue
        for tr in tracks:
            ac_id, ac_song = best_acoustic(album_id, tr["title"], tr["position"], acoustic_map)
            rows_out.append(
                {
                    "external_key": rval,
                    "position": tr["position"],
                    "title": tr["title"],
                    "canonical_source": tr["source"],
                    "confidence_score": tr["confidence"],
                    "musicbrainz_position": tr["mb_pos"],
                    "acoustic_staging_id": ac_id or "",
                    "review_flag": "ok",
                }
            )
            if rval == "RVAL586982" and norm_title(tr["title"]) == norm_title("Beat It"):
                pool = [r for r in acoustic_map.get(album_id, []) if "beat" in norm_title(r["song"])]
                beat_it_diag = {
                    "canonical_title": tr["title"],
                    "matched_acoustic_id": ac_id,
                    "matched_acoustic_song": ac_song,
                    "candidate_count": len(pool),
                    "candidates": [
                        {
                            "id": r["id"],
                            "song": r["song"],
                            "score": score_acoustic("Beat It", r["song"], 5, 5),
                            "polluted": bool(HARD_POLLUTED.search(r["song"])),
                        }
                        for r in pool[:12]
                    ],
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

    diag_path = out_path.parent / "thriller_beat_it_acoustic_diagnosis.json"
    if beat_it_diag:
        diag_path.write_text(json.dumps(beat_it_diag, indent=2), encoding="utf-8")

    print(f"[canonical-tracks] wrote {len(rows_out)} rows → {out_path}")
    print(f"[canonical-tracks] albums {len(sequences)} with sequences")
    if beat_it_diag:
        print(f"[canonical-tracks] Beat It diagnosis → {diag_path}")
        print(json.dumps(beat_it_diag, indent=2))


if __name__ == "__main__":
    main()
