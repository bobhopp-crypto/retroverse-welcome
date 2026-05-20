#!/usr/bin/env python3
"""Stream-parse VirtualDJ database.xml → staging-ready CSV. Does not mutate Postgres."""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_XML = "/Users/bobhopp/Library/Application Support/VirtualDJ/database.xml"
DEFAULT_OUT = "exports/virtualdj/virtualdj_tracks.csv"


def decode_xml(s: str) -> str:
    return (
        s.replace("&apos;", "'")
        .replace("&quot;", '"')
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def attr(el: ET.Element, name: str) -> str:
    return decode_xml(el.get(name, "") or "")


def unix_to_iso(ts: str) -> str:
    if not ts or not ts.isdigit():
        return ""
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except (OSError, ValueError):
        return ""


def row_hash(payload: str) -> str:
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def parse_song(song: ET.Element) -> dict[str, str] | None:
    path = attr(song, "FilePath")
    if not path or path.startswith("netsearch://"):
        return None

    tags = song.find("Tags")
    infos = song.find("Infos")
    link = song.find("Link")

    artist = attr(tags, "Author") if tags is not None else ""
    title = attr(tags, "Title") if tags is not None else ""
    album = attr(tags, "Album") if tags is not None else ""
    genre = attr(tags, "Genre") if tags is not None else ""
    year = attr(tags, "Year") if tags is not None else ""

    song_len = attr(infos, "SongLength") if infos is not None else ""
    duration_sec = ""
    if song_len:
        try:
            duration_sec = str(int(round(float(song_len))))
        except ValueError:
            duration_sec = ""

    play_count = attr(infos, "PlayCount") if infos is not None else ""
    last_play = unix_to_iso(attr(infos, "LastPlay") if infos is not None else "")

    file_size = attr(song, "FileSize")
    thumb = ""
    if link is not None:
        thumb = attr(link, "Cover") or attr(link, "Thumbnail") or ""

    vdj_guid = (attr(link, "clouddriveId") if link is not None else "") or row_hash(path)

    p = Path(path)
    return {
        "source_path": path,
        "filename": p.name,
        "artist_text": artist,
        "title_text": title,
        "album_text": album,
        "genre_text": genre,
        "year_text": year,
        "duration_seconds": duration_sec,
        "play_count": play_count,
        "last_played": last_play,
        "file_size": file_size,
        "filepath_hash": row_hash(path),
        "vdj_guid": vdj_guid[:512],
        "thumbnail_path": thumb,
        "content_hash": row_hash(
            "|".join([path, artist, title, album, duration_sec, play_count, last_play, file_size])
        ),
    }


def export(xml_path: Path, out_path: Path, limit: int | None = None) -> tuple[int, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    exported = 0
    skipped = 0
    seen: set[str] = set()

    fields = [
        "source_path",
        "filename",
        "artist_text",
        "title_text",
        "album_text",
        "genre_text",
        "year_text",
        "duration_seconds",
        "play_count",
        "last_played",
        "file_size",
        "filepath_hash",
        "vdj_guid",
        "thumbnail_path",
        "content_hash",
    ]

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()

        context = ET.iterparse(str(xml_path), events=("end",))
        for _event, elem in context:
            if elem.tag != "Song":
                continue
            row = parse_song(elem)
            elem.clear()
            if row is None:
                skipped += 1
                continue
            if row["content_hash"] in seen:
                skipped += 1
                continue
            seen.add(row["content_hash"])
            w.writerow(row)
            exported += 1
            if limit and exported >= limit:
                break

    return exported, skipped


def main() -> None:
    p = argparse.ArgumentParser(description="Parse VirtualDJ database.xml to CSV")
    p.add_argument("--xml", default=DEFAULT_XML, help="Path to database.xml")
    p.add_argument("--out", default=DEFAULT_OUT, help="Output CSV path")
    p.add_argument("--limit", type=int, default=0, help="Max rows (0 = all)")
    args = p.parse_args()

    xml_path = Path(args.xml).expanduser()
    out_path = Path(args.out).expanduser()
    if not xml_path.is_file():
        raise SystemExit(f"XML not found: {xml_path}")

    # Schema probe
    tree = ET.parse(str(xml_path))
    root = tree.getroot()
    songs = root.findall(".//Song")
    print(f"root_tag={root.tag} song_nodes_sample={len(songs)} (full file uses stream parse)")

    exported, skipped = export(xml_path, out_path, args.limit or None)
    print(f"exported={exported} skipped={skipped}")
    print(f"csv={out_path.resolve()}")


if __name__ == "__main__":
    main()
