#!/usr/bin/env python3
"""
Export canonical track graph staging (1203).

Eligibility: Billboard Hot 100 chart history OR VirtualDJ media library.
One RVTR per artist + canonical song stem. All recordings attach as versions.

Run:
  python3 scripts/export_canonical_track_graph_staging.py
  npm run graph:canonical-track-graph:load
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import subprocess
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[1]
OUT_TRACKS = WORKSPACE / "exports/graph/canonical_tracks_staging.csv"
OUT_VERSIONS = WORKSPACE / "exports/graph/canonical_track_versions_staging.csv"

HARD_POLLUTED = re.compile(
    r"\b(2008|25th|anniversary|interview|voice[- ]?over|excerpt|karaoke|"
    r"carousel|for all time|bonus|deluxe|rough|outtake|sessions?|alternate|"
    r"underground|home demo|remix|reprise|medley)\b",
    re.I,
)
VARIANT_TAIL = re.compile(
    r"\s*[-]\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|"
    r"instrumental|karaoke|acoustic|extended mix|remix|single version|demo|mix)\s*$",
    re.I,
)


def norm_artist(value: str) -> str:
    blob = value.strip().lower().replace("&", " and ")
    blob = re.sub(r"[^a-z0-9 ]", " ", blob)
    return re.sub(r"\s+", " ", blob).strip()


def norm_title_aggressive(title: str) -> str:
    t = title.strip().lower().replace("\u2019", "'")
    t = re.sub(r"[\[\](){}]", " ", t)
    t = re.sub(r"[–—−]", "-", t)
    t = re.sub(r"\s*(feat\.?|featuring|ft\.?)\s*", " feat ", t, flags=re.I)
    t = VARIANT_TAIL.sub("", t)
    t = re.sub(r"[^a-z0-9']+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def canonical_stem(title: str) -> str:
    stem = norm_title_aggressive(title)
    return stem or norm_artist(title)


def hash_to_six(prefix: str, canonical: str) -> int:
    digest = hashlib.sha1(f"{prefix}:{canonical}".encode("utf-8")).hexdigest()
    return int(digest[:12], 16) % 1_000_000


def allocate_rvtr(canonical_key: str, used: set[str]) -> str:
    probe = hash_to_six("RVTR", f"track::{canonical_key}")
    for _ in range(1_000_000):
        candidate = f"RVTR{probe:06d}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        probe = (probe + 1) % 1_000_000
    raise RuntimeError(f"unable_to_allocate_rvtr:{canonical_key}")


def version_type_for_title(title: str) -> str:
    t = title.lower()
    if re.search(r"\bremaster", t):
        return "remaster"
    if re.search(r"\blive\b", t):
        return "live"
    if re.search(r"\bdemo\b", t):
        return "demo"
    if re.search(r"\bsingle version\b", t):
        return "single_edit"
    if re.search(r"\b(mono|stereo)\b", t):
        return "mix_variant"
    return "album_cut"


def psql_copy(host: str, database: str, user: str, sql: str) -> list[list[str]]:
    raw = subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )
    rows: list[list[str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        rows.append(next(csv.reader([line])))
    return rows


@dataclass
class Entity:
    artist_id: int | None
    artist_name: str
    title_key: str
    canonical_title: str
    has_hot100: bool = False
    has_vdj: bool = False
    has_video: bool = False
    has_audio: bool = False
    has_youtube: bool = False
    first_chart_date: str | None = None
    peak_hot100: int | None = None
    chart_weeks: int = 0
    graph_track_id: int | None = None
    track_family_id: int | None = None
    identity_source: str = "hot100"
    versions: list[dict] = field(default_factory=list)


def entity_key(artist_id: int | None, artist_name: str, title_key: str) -> str:
    aid = str(artist_id) if artist_id is not None else norm_artist(artist_name)
    return f"{aid}::{title_key}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--database", default="retroverse")
    parser.add_argument("--user", default="bobhopp")
    args = parser.parse_args()

    entities: dict[str, Entity] = {}

    hot100_sql = """
      COPY (
        WITH base AS (
          SELECT
            t.id AS graph_track_id,
            ar.id AS artist_id,
            ar.canonical_name AS artist_name,
            t.title AS source_title,
            lower(trim(regexp_replace(
              regexp_replace(
                regexp_replace(lower(trim(t.title)), '[''[\\](){}]', ' ', 'g'),
                '[–—−]', '-', 'g'
              ),
              '\\\\s*[-]\\\\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
              '',
              'gi'
            ))) AS title_key,
            ca.chart_date,
            ca.chart_position,
            tfm.track_family_id
          FROM chart_appearances ca
          JOIN tracks t ON t.id = ca.track_id
          JOIN artists ar ON ar.id = t.artist_id
          LEFT JOIN track_family_members tfm
            ON tfm.track_id = t.id AND tfm.is_primary_recording = true
          WHERE ca.chart_name = 'Billboard Hot 100'
            AND ca.track_id IS NOT NULL
        )
        SELECT
          graph_track_id::text,
          artist_id::text,
          artist_name,
          source_title,
          title_key,
          min(chart_date)::text,
          min(chart_position)::text,
          count(*)::text,
          coalesce(max(track_family_id)::text, '')
        FROM base
        WHERE title_key IS NOT NULL AND title_key <> ''
        GROUP BY graph_track_id, artist_id, artist_name, source_title, title_key, track_family_id
      ) TO STDOUT WITH (FORMAT csv)
    """
    for row in psql_copy(args.host, args.database, args.user, hot100_sql):
        if len(row) < 8:
            continue
        graph_track_id = int(row[0])
        artist_id = int(row[1])
        artist_name = row[2].strip()
        source_title = row[3].strip()
        title_key = row[4].strip()
        if HARD_POLLUTED.search(source_title):
            continue
        first_date = row[5] or None
        peak = int(row[6]) if row[6] else None
        weeks = int(row[7]) if row[7] else 0
        family_id = int(row[8]) if len(row) > 8 and row[8] else None

        key = entity_key(artist_id, artist_name, title_key)
        ent = entities.get(key)
        if not ent:
            ent = Entity(
                artist_id=artist_id,
                artist_name=artist_name,
                title_key=title_key,
                canonical_title=canonical_stem(source_title).title() if canonical_stem(source_title) else source_title,
                identity_source="hot100",
            )
            entities[key] = ent
        ent.has_hot100 = True
        ent.chart_weeks = max(ent.chart_weeks, weeks)
        if peak is not None and (ent.peak_hot100 is None or peak < ent.peak_hot100):
            ent.peak_hot100 = peak
        if first_date and (ent.first_chart_date is None or first_date < ent.first_chart_date):
            ent.first_chart_date = first_date
        if family_id and not ent.track_family_id:
            ent.track_family_id = family_id
        if ent.graph_track_id is None:
            ent.graph_track_id = graph_track_id
        ent.versions.append(
            {
                "source_type": "graph_track",
                "source_track_key": f"graph_track:{graph_track_id}",
                "source_title": source_title,
                "source_artist": artist_name,
                "source_album": "",
                "version_type": version_type_for_title(source_title),
                "graph_track_id": graph_track_id,
                "is_primary": ent.graph_track_id == graph_track_id,
                "confidence_score": 0.95 if version_type_for_title(source_title) == "album_cut" else 0.55,
            }
        )

    vdj_sql = """
      COPY (
        SELECT
          id::text,
          coalesce(artist_text, ''),
          coalesce(title_text, ''),
          coalesce(file_extension, ''),
          coalesce(youtube_video_id, ''),
          coalesce(play_count, 0)::text
        FROM media_assets
        WHERE coalesce(trim(artist_text), '') <> ''
          AND coalesce(trim(title_text), '') <> ''
      ) TO STDOUT WITH (FORMAT csv)
    """
    artist_by_norm: dict[str, tuple[int, str]] = {}
    artist_rows = psql_copy(
        args.host,
        args.database,
        args.user,
        "COPY (SELECT id::text, canonical_name FROM artists) TO STDOUT WITH (FORMAT csv)",
    )
    for row in artist_rows:
        if len(row) >= 2:
            artist_by_norm[norm_artist(row[1])] = (int(row[0]), row[1].strip())

    for row in psql_copy(args.host, args.database, args.user, vdj_sql):
        if len(row) < 3:
            continue
        media_id = int(row[0])
        artist_name = row[1].strip()
        source_title = row[2].strip()
        ext = (row[3] or "").lower()
        yt = (row[4] or "").strip()
        if HARD_POLLUTED.search(source_title):
            continue
        title_key = norm_title_aggressive(source_title)
        if not title_key:
            continue
        artist_id, canonical_artist = artist_by_norm.get(norm_artist(artist_name), (None, artist_name))
        key = entity_key(artist_id, canonical_artist, title_key)
        ent = entities.get(key)
        if not ent:
            ent = Entity(
                artist_id=artist_id,
                artist_name=canonical_artist,
                title_key=title_key,
                canonical_title=canonical_stem(source_title).title(),
                identity_source="vdj",
            )
            entities[key] = ent
        ent.has_vdj = True
        if ext in {"mp4", "mov", "webm", "mkv", "m4v"}:
            ent.has_video = True
        elif ext in {"mp3", "m4a", "aac", "wav", "flac", "ogg"}:
            ent.has_audio = True
        if yt:
            ent.has_youtube = True
        if ent.has_hot100 and ent.has_vdj:
            ent.identity_source = "hot100_vdj"
        elif ent.has_hot100:
            ent.identity_source = "hot100"
        else:
            ent.identity_source = "vdj"
        ent.versions.append(
            {
                "source_type": "vdj_media",
                "source_track_key": f"media_asset:{media_id}",
                "source_title": source_title,
                "source_artist": artist_name,
                "source_album": "",
                "version_type": version_type_for_title(source_title),
                "media_asset_id": media_id,
                "is_primary": False,
                "confidence_score": 0.7,
            }
        )

    # Attach acoustic rows as versions for eligible entities
    acoustic_sql = """
      COPY (
        SELECT
          sat.id::text,
          sat.source_song,
          sat.source_artist,
          sat.source_album
        FROM staging_acoustic_tracks sat
      ) TO STDOUT WITH (FORMAT csv)
    """
    acoustic_by_artist: dict[str, list[dict]] = defaultdict(list)
    for row in psql_copy(args.host, args.database, args.user, acoustic_sql):
        if len(row) < 4:
            continue
        acoustic_by_artist[norm_artist(row[2])].append(
            {
                "acoustic_source_id": int(row[0]),
                "source_title": row[1],
                "source_artist": row[2],
                "source_album": row[3],
            }
        )

    for ent in entities.values():
        if not ent.has_hot100 and not ent.has_vdj:
            continue
        pool = acoustic_by_artist.get(norm_artist(ent.artist_name), [])
        for ac in pool:
            ak = norm_title_aggressive(ac["source_title"])
            if ak != ent.title_key and ent.title_key not in ak and ak not in ent.title_key:
                continue
            if HARD_POLLUTED.search(ac["source_title"]):
                continue
            ent.versions.append(
                {
                    "source_type": "acoustic",
                    "source_track_key": f"acoustic:{ac['acoustic_source_id']}",
                    "source_title": ac["source_title"],
                    "source_artist": ac["source_artist"],
                    "source_album": ac["source_album"],
                    "version_type": version_type_for_title(ac["source_title"]),
                    "acoustic_source_id": ac["acoustic_source_id"],
                    "is_primary": False,
                    "confidence_score": 0.6,
                }
            )

    used_rvtr: set[str] = set()
    track_rows: list[dict] = []
    version_rows: list[dict] = []

    for ent in sorted(entities.values(), key=lambda e: (e.artist_name, e.title_key)):
        if not ent.has_hot100 and not ent.has_vdj:
            continue
        canon_key = f"{norm_title_aggressive(ent.canonical_title)}::{ent.artist_id or norm_artist(ent.artist_name)}"
        rvtr = allocate_rvtr(canon_key, used_rvtr)
        confidence = 0.98 if ent.has_hot100 and ent.has_vdj else 0.92 if ent.has_hot100 else 0.85
        track_rows.append(
            {
                "track_id": rvtr,
                "canonical_title": ent.canonical_title,
                "normalized_title_key": ent.title_key,
                "artist_id": ent.artist_id or "",
                "canonical_artist_name": ent.artist_name,
                "first_chart_date": ent.first_chart_date or "",
                "peak_hot100_position": ent.peak_hot100 if ent.peak_hot100 is not None else "",
                "chart_weeks": ent.chart_weeks,
                "has_hot100": "true" if ent.has_hot100 else "false",
                "has_vdj_media": "true" if ent.has_vdj else "false",
                "has_video": "true" if ent.has_video else "false",
                "has_audio": "true" if ent.has_audio else "false",
                "has_youtube": "true" if ent.has_youtube else "false",
                "graph_track_id": ent.graph_track_id or "",
                "track_family_id": ent.track_family_id or "",
                "retroverse_track_id": rvtr,
                "identity_source": ent.identity_source,
                "confidence_score": confidence,
                "review_flag": "ok",
            }
        )
        seen_version_keys: set[str] = set()
        for ver in ent.versions:
            vk = ver.get("source_track_key") or ver["source_title"]
            if vk in seen_version_keys:
                continue
            seen_version_keys.add(vk)
            version_rows.append(
                {
                    "track_id": rvtr,
                    "source_type": ver["source_type"],
                    "source_track_key": ver.get("source_track_key", ""),
                    "source_title": ver["source_title"],
                    "source_artist": ver.get("source_artist", ""),
                    "source_album": ver.get("source_album", ""),
                    "version_type": ver.get("version_type", "variant"),
                    "release_date": "",
                    "is_primary": "true" if ver.get("is_primary") else "false",
                    "confidence_score": ver.get("confidence_score", 0.5),
                    "graph_track_id": ver.get("graph_track_id", ""),
                    "acoustic_source_id": ver.get("acoustic_source_id", ""),
                    "media_asset_id": ver.get("media_asset_id", ""),
                }
            )

    OUT_TRACKS.parent.mkdir(parents=True, exist_ok=True)
    with OUT_TRACKS.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(track_rows[0].keys()) if track_rows else [])
        if track_rows:
            w.writeheader()
            w.writerows(track_rows)
    with OUT_VERSIONS.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(version_rows[0].keys()) if version_rows else [])
        if version_rows:
            w.writeheader()
            w.writerows(version_rows)

    print(f"[canonical-track-graph] entities {len(track_rows)} → {OUT_TRACKS}")
    print(f"[canonical-track-graph] versions {len(version_rows)} → {OUT_VERSIONS}")


if __name__ == "__main__":
    main()
