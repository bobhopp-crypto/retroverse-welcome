#!/usr/bin/env python3
"""Stream-parse VirtualDJ database.xml → staging-ready CSV. Does not mutate Postgres.

Exports:
  virtualdj_tracks.csv — one row per Song (media instance metadata)
  virtualdj_cues.csv     — Type=cue Poi rows; Cue 8 flagged is_thumbnail=1
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_XML = "/Users/bobhopp/Library/Application Support/VirtualDJ/database.xml"
DEFAULT_OUT = "exports/virtualdj/virtualdj_tracks.csv"
DEFAULT_CUES_OUT = "exports/virtualdj/virtualdj_cues.csv"


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


def media_type_from_path(path: str) -> str:
    ext = Path(path).suffix.lower().lstrip(".")
    if ext in {"mp4", "mov", "mkv", "avi", "webm", "m4v"}:
        return "video"
    if ext in {"mp3", "wav", "flac", "aac", "m4a", "ogg", "aiff"}:
        return "audio"
    if ext in {"jpg", "jpeg", "png", "gif", "webp"}:
        return "image"
    return "other"


def thumbnail_flag(cue_number: int, cue_name: str) -> str:
    if cue_number == 8:
        return "1"
    name = (cue_name or "").strip().lower()
    if "thumbnail" in name or "thumb" in name:
        return "1"
    return "0"


def parse_cue_pois(song: ET.Element, filepath_hash: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for poi in song.findall("Poi"):
        if (poi.get("Type") or "").lower() != "cue":
            continue
        num_raw = poi.get("Num") or ""
        try:
            cue_number = int(num_raw)
        except ValueError:
            continue
        cue_name = attr(poi, "Name")
        pos_raw = attr(poi, "Pos")
        time_position = ""
        if pos_raw:
            try:
                time_position = f"{float(pos_raw):.6f}"
            except ValueError:
                time_position = pos_raw
        color = attr(poi, "Color")
        loop_bits = {k: v for k, v in poi.attrib.items() if k not in {"Type", "Num", "Name", "Pos", "Color"}}
        rows.append(
            {
                "filepath_hash": filepath_hash,
                "cue_number": str(cue_number),
                "cue_name": cue_name,
                "cue_type": "cue",
                "time_position_seconds": time_position,
                "color": color,
                "loop_data": json.dumps(loop_bits, separators=(",", ":")) if loop_bits else "",
                "is_thumbnail": thumbnail_flag(cue_number, cue_name),
            }
        )
    return rows


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
    comments = attr(tags, "Comments") if tags is not None else ""

    scan = song.find("Scan")
    bpm_raw = attr(scan, "Bpm") if scan is not None else ""
    musical_key = attr(scan, "Key") if scan is not None else ""

    file_size = attr(song, "FileSize")
    song_flag = attr(song, "Flag")
    tags_flag = attr(tags, "Flag") if tags is not None else ""

    thumb = ""
    linked_cover = ""
    linked_netsearch = ""
    if link is not None:
        thumb = attr(link, "Cover") or attr(link, "Thumbnail") or ""
        linked_cover = attr(link, "Cover")
        linked_netsearch = attr(link, "NetSearch")

    vdj_guid = (attr(link, "clouddriveId") if link is not None else "") or row_hash(path)

    tag_blob: dict[str, str] = {}
    if tags is not None:
        for k, v in tags.attrib.items():
            if v:
                tag_blob[k] = decode_xml(v)

    p = Path(path)
    fhash = row_hash(path)
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
        "filepath_hash": fhash,
        "vdj_guid": vdj_guid[:512],
        "thumbnail_path": thumb,
        "media_type": media_type_from_path(path),
        "vdj_song_flag": song_flag,
        "vdj_tags_flag": tags_flag,
        "bpm_raw": bpm_raw,
        "musical_key": musical_key,
        "comments": comments,
        "tags_json": json.dumps(tag_blob, separators=(",", ":")),
        "linked_cover_url": linked_cover,
        "linked_netsearch_id": linked_netsearch,
        "file_hash": row_hash(f"{path}|{file_size}") if file_size else "",
        "content_hash": row_hash(
            "|".join([path, artist, title, album, duration_sec, play_count, last_play, file_size])
        ),
        "_cue_rows": parse_cue_pois(song, fhash),
    }


def export(
    xml_path: Path,
    out_path: Path,
    cues_out_path: Path | None = None,
    limit: int | None = None,
) -> tuple[int, int, int]:
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
        "media_type",
        "vdj_song_flag",
        "vdj_tags_flag",
        "bpm_raw",
        "musical_key",
        "comments",
        "tags_json",
        "linked_cover_url",
        "linked_netsearch_id",
        "file_hash",
        "content_hash",
    ]

    cue_fields = [
        "filepath_hash",
        "cue_number",
        "cue_name",
        "cue_type",
        "time_position_seconds",
        "color",
        "loop_data",
        "is_thumbnail",
    ]
    cues_exported = 0

    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        cue_writer: csv.DictWriter | None = None
        cue_file = None
        if cues_out_path is not None:
            cues_out_path.parent.mkdir(parents=True, exist_ok=True)
            cue_file = cues_out_path.open("w", newline="", encoding="utf-8")
            cue_writer = csv.DictWriter(cue_file, fieldnames=cue_fields)
            cue_writer.writeheader()

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
            cue_rows = row.pop("_cue_rows", [])
            w.writerow({k: row[k] for k in fields})
            if cue_writer:
                for cue in cue_rows:
                    cue_writer.writerow(cue)
                    cues_exported += 1
            exported += 1
            if limit and exported >= limit:
                break

        if cue_file is not None:
            cue_file.close()

    return exported, skipped, cues_exported


def main() -> None:
    p = argparse.ArgumentParser(description="Parse VirtualDJ database.xml to CSV")
    p.add_argument("--xml", default=DEFAULT_XML, help="Path to database.xml")
    p.add_argument("--out", default=DEFAULT_OUT, help="Output CSV path")
    p.add_argument("--cues-out", default=DEFAULT_CUES_OUT, help="Cue CSV path (empty = skip)")
    p.add_argument("--limit", type=int, default=0, help="Max rows (0 = all)")
    args = p.parse_args()

    xml_path = Path(args.xml).expanduser()
    out_path = Path(args.out).expanduser()
    cues_out = Path(args.cues_out).expanduser() if args.cues_out.strip() else None
    if not xml_path.is_file():
        raise SystemExit(f"XML not found: {xml_path}")

    # Schema probe
    tree = ET.parse(str(xml_path))
    root = tree.getroot()
    songs = root.findall(".//Song")
    print(f"root_tag={root.tag} song_nodes_sample={len(songs)} (full file uses stream parse)")

    exported, skipped, cues_exported = export(xml_path, out_path, cues_out, args.limit or None)
    print(f"exported={exported} skipped={skipped} cues_exported={cues_exported}")
    print(f"csv={out_path.resolve()}")
    if cues_out:
        print(f"cues_csv={cues_out.resolve()}")


if __name__ == "__main__":
    main()
