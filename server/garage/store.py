"""Your garage on disk: data/garage.json for records, data/media/ for files.

One JSON file is plenty for a personal garage and easy to back up or inspect. Writes go
to a temp file first and are swapped in, so a crash never leaves half a file.
"""
from __future__ import annotations

import json
import os
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
    with _lock:
        db = _read()
        keep = [x for x in db[kind] if x["id"] != item_id]
        if len(keep) == len(db[kind]):
            return False
        db[kind] = keep
        _write(db)
        return True


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
