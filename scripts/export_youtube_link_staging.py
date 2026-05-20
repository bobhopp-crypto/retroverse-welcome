#!/usr/bin/env python3
"""Export legacy YouTube link files to staging CSV for 909."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

DEFAULT_OUT = "exports/youtube/youtube_links.csv"
SOURCES = [
    ("/Users/bobhopp/Sites/retroverse/data/media/video_cache.json", "video_cache"),
    ("/Users/bobhopp/Sites/retroverse/apps/music-browser/public/data/video_cache.json", "video_cache_mb"),
    ("/Users/bobhopp/Sites/retroverse/raw-data/youtube-reference.json", "youtube_reference"),
]


def norm_key(artist: str, title: str) -> tuple[str, str]:
    a = re.sub(r"\s+", " ", (artist or "").strip().lower())
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    return a, t


def video_id(url: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit.strip()
    if not url:
        return ""
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else ""


def load_video_cache(path: Path, source: str) -> list[dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict[str, str]] = []
    if isinstance(data, dict):
        for key, val in data.items():
            if not isinstance(val, dict):
                continue
            yt = val.get("youtube_id") or val.get("youtubeId") or ""
            if not yt and not val.get("url"):
                continue
            if "__" in key:
                artist, title = key.split("__", 1)
            else:
                artist, title = "", key
            url = val.get("url") or f"https://www.youtube.com/watch?v={yt}"
            rows.append(row(artist, title, url, yt, source))
    return rows


def load_reference(path: Path, source: str) -> list[dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict[str, str]] = []
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            rows.append(
                row(
                    str(item.get("artist", "")),
                    str(item.get("title", "")),
                    str(item.get("url", "")),
                    str(item.get("youtubeId", item.get("youtube_id", ""))),
                    source,
                )
            )
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, str) and len(v) == 11:
                artist, title = (k.split("::", 1) + [""])[:2] if "::" in k else ("", k)
                rows.append(row(artist, title, f"https://www.youtube.com/watch?v={v}", v, source))
    return rows


def row(artist: str, title: str, url: str, yt: str, source: str) -> dict[str, str]:
    vid = video_id(url, yt)
    h = hashlib.sha1(f"{source}|{artist}|{title}|{vid}|{url}".encode()).hexdigest()
    return {
        "source_name": source,
        "artist_text": artist.strip(),
        "title_text": title.strip(),
        "youtube_url": url.strip(),
        "youtube_video_id": vid,
        "content_hash": h,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=DEFAULT_OUT)
    args = p.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    exported = 0
    fields = ["source_name", "artist_text", "title_text", "youtube_url", "youtube_video_id", "content_hash"]

    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for path_str, source in SOURCES:
            path = Path(path_str)
            if not path.is_file():
                print(f"skip_missing={path}")
                continue
            if path.name == "youtube-reference.json":
                items = load_reference(path, source)
            else:
                items = load_video_cache(path, source)
            for item in items:
                if not item["youtube_video_id"] or item["content_hash"] in seen:
                    continue
                seen.add(item["content_hash"])
                w.writerow(item)
                exported += 1

    print(f"exported={exported} csv={out.resolve()}")


if __name__ == "__main__":
    main()
