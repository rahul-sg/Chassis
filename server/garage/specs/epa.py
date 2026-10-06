"""The EPA fuel economy database (fueleconomy.gov): every car sold in the U.S. since 1984.

Downloaded once as vehicles.csv (public domain) and loaded into SQLite. Each row is one
version of a model (engine × transmission × drive); `baseModel` groups them into families
like "Civic", which is what a photo can be matched against.
"""
from __future__ import annotations

import csv
import io
import sqlite3
import threading
import urllib.request
import zipfile
from functools import lru_cache

from ..paths import CACHE

URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip"
DB = CACHE / "epa.sqlite"
_lock = threading.Lock()

NUMERIC = {
    "year", "id", "cylinders", "displ", "city08", "highway08", "comb08", "cityA08", "highwayA08", "combA08",
    "fuelCost08", "co2TailpipeGpm", "youSaveSpend", "range", "rangeCity", "rangeHwy", "charge240", "feScore",
    "ghgScore", "barrels08", "cityE", "combE", "highwayE",
}
COLUMNS = [
    "id", "year", "make", "model", "baseModel", "VClass", "drive", "trany", "cylinders", "displ", "eng_dscr",
    "fuelType", "fuelType1", "fuelType2", "atvType", "evMotor", "tCharger", "sCharger", "startStop", "city08",
    "highway08", "comb08", "cityA08", "highwayA08", "combA08", "fuelCost08", "co2TailpipeGpm", "youSaveSpend",
    "range", "rangeCity", "rangeHwy", "charge240", "feScore", "ghgScore", "combE",
]


def _num(v: str):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


def build(raw: bytes | None = None) -> None:
    """Download (unless given) and load vehicles.csv into SQLite."""
    if raw is None:
        with urllib.request.urlopen(URL, timeout=60) as r:
            raw = r.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        text = z.read(z.namelist()[0]).decode("latin-1")
    rows = list(csv.DictReader(io.StringIO(text)))
    tmp = DB.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.execute(f"CREATE TABLE vehicles ({', '.join(COLUMNS)})")
    con.executemany(
        f"INSERT INTO vehicles VALUES ({', '.join('?' * len(COLUMNS))})",
        [[_num(r.get(c, "")) if c in NUMERIC else (r.get(c) or "").strip() for c in COLUMNS] for r in rows],
    )
    con.execute("CREATE INDEX fam ON vehicles (make, baseModel, year)")
    con.commit()
    con.close()
    tmp.replace(DB)


def connect() -> sqlite3.Connection:
    with _lock:
        if not DB.exists():
            build()
    con = sqlite3.connect(DB, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _key(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


@lru_cache(maxsize=1)
def families() -> list[dict]:
    """Every make/model family with its model years.

    The EPA sometimes lists one car under two names ("Elantra" and "J-Car/Elantra",
    "Leaf" and "LEAF"); names that share a part are merged, shown under the plainest
    one, with the EPA names kept in `members` for lookups."""
    con = connect()
    rows = [dict(r) for r in con.execute(
        """SELECT make, baseModel AS model, MIN(year) AS yearFrom, MAX(year) AS yearTo, COUNT(*) AS n,
                  (SELECT VClass FROM vehicles v2 WHERE v2.make = v.make AND v2.baseModel = v.baseModel
                   GROUP BY VClass ORDER BY COUNT(*) DESC LIMIT 1) AS vclass
           FROM vehicles v WHERE baseModel != '' GROUP BY make, baseModel ORDER BY make, baseModel""")]
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    by_alias: dict = {}
    for i, r in enumerate(rows):
        for alias in {_key(r["model"]), *(_key(p) for p in r["model"].split("/"))} - {""}:
            j = by_alias.setdefault((r["make"], alias), i)
            parent[find(i)] = find(j)
    groups: dict = {}
    for i, r in enumerate(rows):
        groups.setdefault(find(i), []).append(r)
    out = []
    for members in groups.values():
        plain = [m for m in members if "/" not in m["model"]] or members
        name = max(plain, key=lambda m: (m["n"], m["yearTo"]))["model"]
        out.append({
            "make": members[0]["make"], "model": name, "members": sorted(m["model"] for m in members),
            "yearFrom": min(m["yearFrom"] for m in members), "yearTo": max(m["yearTo"] for m in members),
            "n": sum(m["n"] for m in members), "vclass": max(members, key=lambda m: m["n"])["vclass"],
        })
    return sorted(out, key=lambda f: (f["make"], f["model"]))


def members(make: str, model: str) -> list[str]:
    """EPA base-model names behind a family name (just the name if it isn't a family)."""
    f = next((f for f in families() if f["make"] == make and f["model"] == model), None)
    return f["members"] if f else [model]


def _in(names: list[str]) -> str:
    return ", ".join("?" * len(names))


def years(make: str, model: str) -> list[int]:
    m = members(make, model)
    return [r[0] for r in connect().execute(
        f"SELECT DISTINCT year FROM vehicles WHERE make = ? AND baseModel IN ({_in(m)}) ORDER BY year", (make, *m))]


def makes() -> list[str]:
    return [r[0] for r in connect().execute("SELECT DISTINCT make FROM vehicles ORDER BY make")]


def models(make: str) -> list[dict]:
    return [{"model": f["model"], "yearFrom": f["yearFrom"], "yearTo": f["yearTo"]} for f in families() if f["make"] == make]


def variants(year: int, make: str, model: str) -> list[dict]:
    """All EPA versions of a model year: one per engine/transmission/drive combination."""
    m = members(make, model)
    return [dict(r) for r in connect().execute(
        f"SELECT * FROM vehicles WHERE year = ? AND make = ? AND baseModel IN ({_in(m)}) ORDER BY model, displ, trany",
        (year, make, *m))]


def stats() -> dict:
    con = connect()
    n, y0, y1 = con.execute("SELECT COUNT(*), MIN(year), MAX(year) FROM vehicles").fetchone()
    return {"vehicles": n, "families": len(families()), "yearFrom": y0, "yearTo": y1}
