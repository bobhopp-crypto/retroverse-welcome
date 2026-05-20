#!/usr/bin/env python3
"""Export acoustic_features from Billboard 200 SQLite to staging-ready CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import sqlite3
from pathlib import Path

DEFAULT_DB = "/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db"
DEFAULT_OUT = "exports/acoustics/acoustics_export.csv"
SOURCE_TABLE = "acoustic_features"


def norm(s: str | None) -> str:
    return (s or "").strip()


def year_from_date(date_text: str | None) -> int | None:
    if not date_text:
        return None
    t = date_text.strip()
    if len(t) >= 4 and t[:4].isdigit():
        y = int(t[:4])
        if 1900 <= y <= 2100:
            return y
    return None


def row_hash(
    source_row_id: str,
    artist: str,
    album: str,
    song: str,
    duration_ms: float | None,
    release_year: int | None,
    features: tuple[float | None, ...],
) -> str:
    payload = "|".join(
        [
            source_row_id,
            artist,
            album,
            song,
            str(duration_ms if duration_ms is not None else ""),
            str(release_year if release_year is not None else ""),
            *[str(v if v is not None else "") for v in features],
        ]
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def inspect_schema(conn: sqlite3.Connection) -> list[str]:
    cols = conn.execute(f"PRAGMA table_info({SOURCE_TABLE})").fetchall()
    names = [c[1] for c in cols]
    print(f"table={SOURCE_TABLE} columns={names}")
    return names


def export(db_path: Path, out_path: Path) -> tuple[int, int, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    inspect_schema(conn)

    cur = conn.execute(
        f"""
        SELECT
          id, song, album, artist,
          acousticness, danceability, duration_ms, energy,
          instrumentalness, liveness, loudness, speechiness, tempo, valence,
          date
        FROM {SOURCE_TABLE}
        WHERE artist IS NOT NULL AND trim(artist) <> ''
          AND album IS NOT NULL AND trim(album) <> ''
          AND song IS NOT NULL AND trim(song) <> ''
        ORDER BY id
        """
    )

    seen: set[str] = set()
    exported = 0
    skipped_exact_dupes = 0

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "source_artist",
            "source_album",
            "source_song",
            "source_duration",
            "source_release_year",
            "acousticness",
            "danceability",
            "energy",
            "instrumentalness",
            "liveness",
            "loudness",
            "speechiness",
            "tempo",
            "valence",
            "source_row_id",
            "content_hash",
        ])
        for (
            rid,
            song,
            album,
            artist,
            acousticness,
            danceability,
            duration_ms,
            energy,
            instrumentalness,
            liveness,
            loudness,
            speechiness,
            tempo,
            valence,
            date,
        ) in cur:
            source_artist = norm(artist)
            source_album = norm(album)
            source_song = norm(song)
            source_duration = int(round(duration_ms / 1000.0)) if duration_ms else None
            source_release_year = year_from_date(date)
            features = (
                acousticness,
                danceability,
                energy,
                instrumentalness,
                liveness,
                loudness,
                speechiness,
                tempo,
                valence,
            )
            content_hash = row_hash(
                str(rid),
                source_artist,
                source_album,
                source_song,
                duration_ms,
                source_release_year,
                features,
            )
            if content_hash in seen:
                skipped_exact_dupes += 1
                continue
            seen.add(content_hash)
            w.writerow([
                source_artist,
                source_album,
                source_song,
                source_duration,
                source_release_year,
                acousticness,
                danceability,
                energy,
                instrumentalness,
                liveness,
                loudness,
                speechiness,
                tempo,
                valence,
                str(rid),
                content_hash,
            ])
            exported += 1

    conn.close()
    return exported, skipped_exact_dupes, len(seen)


def main() -> None:
    p = argparse.ArgumentParser(description="Export acoustic_features to CSV")
    p.add_argument("--db", default=DEFAULT_DB, help="SQLite path")
    p.add_argument("--out", default=DEFAULT_OUT, help="Output CSV path")
    args = p.parse_args()
    db_path = Path(args.db).expanduser()
    out_path = Path(args.out).expanduser()
    if not db_path.is_file():
        raise SystemExit(f"DB not found: {db_path}")

    exported, skipped, unique = export(db_path, out_path)
    print(f"exported={exported} skipped_exact_dupes={skipped} unique_hashes={unique}")
    print(f"csv={out_path.resolve()}")


if __name__ == "__main__":
    main()
