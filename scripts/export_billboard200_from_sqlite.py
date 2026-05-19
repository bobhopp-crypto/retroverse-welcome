#!/usr/bin/env python3
"""Export Billboard 200 weekly rows from SQLite to staging-ready CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import sqlite3
from pathlib import Path

DEFAULT_DB = "/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db"
DEFAULT_OUT = "exports/billboard_200/billboard200_export.csv"


def export(db_path: Path, out_path: Path) -> tuple[int, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        """
        SELECT id, date, artist, album, rank, length
        FROM albums
        WHERE date IS NOT NULL AND trim(date) <> ''
          AND artist IS NOT NULL AND trim(artist) <> ''
          AND album IS NOT NULL AND trim(album) <> ''
        ORDER BY id
        """
    )

    seen: set[str] = set()
    exported = 0
    skipped = 0

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "chart_date",
            "chart_position",
            "source_artist",
            "source_album",
            "weeks_on_chart",
            "peak_position",
            "content_hash",
            "source_row_id",
        ])
        for rid, date, artist, album, rank, length in cur:
            chart_date = date.strip()[:10]
            source_artist = artist.strip()
            source_album = album.strip()
            try:
                chart_position = int(float(rank)) if rank not in (None, "") else None
            except ValueError:
                chart_position = None
            try:
                weeks_on_chart = int(length) if length is not None else None
            except (TypeError, ValueError):
                weeks_on_chart = None
            content_hash = hashlib.sha1(
                (
                    f"billboard_200_sqlite|{chart_date}|{chart_position}|"
                    f"{source_artist}|{source_album}|{weeks_on_chart}"
                ).encode("utf-8")
            ).hexdigest()
            if content_hash in seen:
                skipped += 1
                continue
            seen.add(content_hash)
            w.writerow([
                chart_date,
                chart_position,
                source_artist,
                source_album,
                weeks_on_chart,
                chart_position,
                content_hash,
                str(rid),
            ])
            exported += 1

    conn.close()
    return exported, skipped


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--out", default=DEFAULT_OUT)
    args = p.parse_args()
    exported, skipped = export(Path(args.db), Path(args.out))
    print(f"exported_rows={exported}")
    print(f"skipped_duplicate_hashes={skipped}")
    print(f"csv_path={Path(args.out).resolve()}")


if __name__ == "__main__":
    main()
