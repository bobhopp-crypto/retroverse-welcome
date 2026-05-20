#!/usr/bin/env python3
"""Bridge RVAL dossier IDs to Postgres album_id + seed album_artwork_links CSVs."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

import subprocess

DEFAULT_DOSSIERS = "public/data/albums/album-dossiers.json"
DEFAULT_OVERRIDES = "public/data/albums/canonical-artwork-overrides.json"
OUT_DIR = "exports/graph"


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def r2_key_from_path(path: str, rval: str) -> str | None:
    p = (path or "").strip()
    if not p:
        return None
    if p.startswith("http"):
        return f"retroverse/covers/{rval}/canonical.jpg"
    rel = p.lstrip("/")
    if rel.lower().startswith("retroverse/covers/"):
        return rel
    return f"retroverse/covers/{rval}/canonical.jpg"


def local_web_path(path: str) -> str | None:
    p = (path or "").strip()
    if not p:
        return None
    if p.startswith("/retroverse/covers/"):
        return p
    if p.startswith("retroverse/covers/"):
        return f"/{p}"
    return None


def load_pg_index(host: str, database: str, user: str) -> dict[tuple[str, str], list[int]]:
    sql = """
      COPY (
        SELECT a.id::text, lower(trim(a.title)), lower(trim(ar.canonical_name))
        FROM albums a
        JOIN artists ar ON ar.id = a.artist_id
      ) TO STDOUT WITH (FORMAT csv)
    """
    raw = subprocess.check_output(
        ["psql", "-h", host, "-U", user, "-d", database, "-c", sql],
        text=True,
    )
    idx: dict[tuple[str, str], list[int]] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = next(csv.reader([line]))
        if len(parts) < 3:
            continue
        album_id, title, artist = parts[0], parts[1], parts[2]
        idx.setdefault((artist, title), []).append(int(album_id))
    return idx


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dossiers", default=DEFAULT_DOSSIERS)
    p.add_argument("--overrides", default=DEFAULT_OVERRIDES)
    p.add_argument("--out-dir", default=OUT_DIR)
    p.add_argument("--host", default="localhost")
    p.add_argument("--database", default="retroverse")
    p.add_argument("--user", default="bobhopp")
    args = p.parse_args()

    dossiers_path = Path(args.dossiers)
    overrides_path = Path(args.overrides)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    dossiers = json.loads(dossiers_path.read_text(encoding="utf-8"))
    dossier_map: dict[str, dict] = dossiers.get("dossiers") or {}

    overrides: dict[str, dict] = {}
    if overrides_path.is_file():
        ov = json.loads(overrides_path.read_text(encoding="utf-8"))
        overrides = ov.get("albums") or {}

    idx = load_pg_index(args.host, args.database, args.user)

    key_rows: list[dict[str, str]] = []
    art_rows: list[dict[str, str]] = []
    seen_art: set[tuple[int, str]] = set()

    matched = 0
    for rval, d in dossier_map.items():
        rval = rval.strip().upper()
        if not re.fullmatch(r"RVAL[0-9]{6}", rval):
            continue
        ident = d.get("identity") or {}
        artist = norm(str(ident.get("artist", "")))
        title = norm(str(ident.get("album", "")))
        if not artist or not title:
            continue
        ids = idx.get((artist, title)) or []
        if not ids:
            continue
        album_id = ids[0]
        matched += 1
        key_rows.append(
            {
                "album_id": str(album_id),
                "external_key": rval,
                "source": "dossier_match",
                "confidence_score": "90" if len(ids) == 1 else "70",
            }
        )

        paths: list[tuple[str, str, str]] = []
        ov = overrides.get(rval) or {}
        ov_path = (ov.get("canonical_cover_path") or "").strip()
        if ov_path:
            flag = "curated" if ov.get("trust_state") == "verified" else "ok"
            paths.append((ov_path, "curator_override", flag))
        dossier_path = (ident.get("canonical_cover_path") or "").strip()
        if dossier_path:
            paths.append((dossier_path, "dossier", "ok"))

        for path, source, review in paths:
            sig = (album_id, source)
            if sig in seen_art:
                continue
            seen_art.add(sig)
            art_rows.append(
                {
                    "album_id": str(album_id),
                    "album_edition_id": "",
                    "canonical_cover_path": path,
                    "local_cover_path": local_web_path(path) or "",
                    "r2_cover_key": r2_key_from_path(path, rval) or "",
                    "source": source,
                    "confidence_score": "95" if source == "curator_override" else "85",
                    "review_flag": review,
                }
            )

    keys_csv = out_dir / "album_external_keys.csv"
    art_csv = out_dir / "album_artwork_links.csv"
    for path, rows, fields in (
        (keys_csv, key_rows, ["album_id", "external_key", "source", "confidence_score"]),
        (
            art_csv,
            art_rows,
            [
                "album_id",
                "album_edition_id",
                "canonical_cover_path",
                "local_cover_path",
                "r2_cover_key",
                "source",
                "confidence_score",
                "review_flag",
            ],
        ),
    ):
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)

    print(
        f"matched={matched} keys={len(key_rows)} artwork_rows={len(art_rows)} "
        f"keys_csv={keys_csv.resolve()} art_csv={art_csv.resolve()}"
    )


if __name__ == "__main__":
    main()
