"""SQLite cache for web lookups, so pages load instantly the second time and work offline."""
from __future__ import annotations

import json
import sqlite3
import threading
import time

from ..paths import CACHE

_con = sqlite3.connect(CACHE / "web.sqlite", check_same_thread=False)
_con.execute("CREATE TABLE IF NOT EXISTS web (key TEXT PRIMARY KEY, at REAL, value TEXT)")
_lock = threading.Lock()


def cached(key: str, fetch, max_age: float | None = None):
    """Return the cached value for key, or fetch() and store it. Failed fetches aren't cached."""
    with _lock:
        row = _con.execute("SELECT at, value FROM web WHERE key = ?", (key,)).fetchone()
    if row and (max_age is None or time.time() - row[0] < max_age):
        return json.loads(row[1])
    try:
        value = fetch()
    except Exception:
        if row:  # offline: stale is better than nothing
            return json.loads(row[1])
        raise
    with _lock:
        _con.execute("INSERT OR REPLACE INTO web VALUES (?, ?, ?)", (key, time.time(), json.dumps(value)))
        _con.commit()
    return value
