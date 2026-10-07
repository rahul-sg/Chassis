"""Your garage on disk: data/garage.json for records, data/media/ for files.

One JSON file is plenty for a personal garage and easy to back up or inspect. Writes go
to a temp file first and are swapped in, so a crash never leaves half a file.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path

from .paths import DATA, MEDIA

FILE = DATA / "garage.json"
_lock = threading.Lock()


def _read() -> dict:
    if not FILE.exists():
        return {"cars": [], "spotted": []}
    return json.loads(FILE.read_text())


def _write(db: dict) -> None:
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(db, indent=1))
    os.replace(tmp, FILE)


def new_id() -> str:
    return uuid.uuid4().hex[:10]


def now() -> float:
    return round(time.time(), 3)


def list_items(kind: str) -> list[dict]:
    with _lock:
        return _read()[kind]


def get_item(kind: str, item_id: str) -> dict | None:
    return next((x for x in list_items(kind) if x["id"] == item_id), None)


def add_item(kind: str, item: dict) -> dict:
    with _lock:
        db = _read()
        item = {"id": new_id(), "createdAt": now(), **item}
        db[kind].insert(0, item)
        _write(db)
        return item


def update_item(kind: str, item_id: str, patch: dict) -> dict | None:
    with _lock:
        db = _read()
        for i, x in enumerate(db[kind]):
            if x["id"] == item_id:
                db[kind][i] = {**x, **patch, "id": item_id, "updatedAt": now()}
                _write(db)
                return db[kind][i]
    return None


def delete_item(kind: str, item_id: str) -> bool:
    """Remove a record, and the files it pointed to that nothing else uses (a car's photo is
    often also its Spotted entry's photo)."""
    with _lock:
        db = _read()
        gone = next((x for x in db[kind] if x["id"] == item_id), None)
        if gone is None:
            return False
        db[kind] = [x for x in db[kind] if x["id"] != item_id]
        _write(db)
    still = media_urls(db)
    for url in media_urls(gone) - still:
        path = media_path(url)
        if path.is_file():
            path.unlink()
        # A 3D model's folder (its splat, poster and earlier versions) goes with it.
        parts = url.split("/")
        if len(parts) > 4 and parts[2] == "captures" and not any(u.startswith(f"/media/captures/{parts[3]}/") for u in still):
            folder = media_path(f"/media/captures/{parts[3]}/x").parent
            if folder.parent == (MEDIA / "captures").resolve():
                shutil.rmtree(folder, ignore_errors=True)
    return True


def media_urls(x) -> set[str]:
    """Every /media/… URL anywhere inside a record."""
    if isinstance(x, str):
        return {x} if x.startswith("/media/") else set()
    if isinstance(x, dict):
        x = list(x.values())
    if isinstance(x, list):
        return set().union(*map(media_urls, x)) if x else set()
    return set()


def orphaned_files(item: dict, rest: dict) -> set[str]:
    """The files `item` points to that nothing in `rest` (the garage without it) points to."""
    return media_urls(item) - media_urls(rest)


def save_media(data: bytes, ext: str) -> str:
    """Store a file under data/media and return its URL path."""
    ext = ext.lower().lstrip(".") or "bin"
    name = f"{new_id()}.{ext}"
    (MEDIA / name).write_bytes(data)
    return f"/media/{name}"


def media_path(url: str) -> Path:
    """/media/<path> → that file in the media folder. Anything that would point outside the
    folder (../ and the like) maps to a path that doesn't exist, so callers' exists() checks fail."""
    rel = url[len("/media/"):] if url.startswith("/media/") else Path(url).name
    path = (MEDIA / rel).resolve()
    root = MEDIA.resolve()
    return path if root in path.parents else root / ".outside"
