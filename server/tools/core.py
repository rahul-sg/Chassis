"""Give finished 3D models a solid core (see garage/capture/core.py), without rebuilding them.

    server/.venv/bin/python server/tools/core.py            every car with a 3D model
    server/.venv/bin/python server/tools/core.py CAR_ID     one car

New builds get one automatically; this is for models made before cores existed.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from garage import store  # noqa: E402
from garage.capture import core  # noqa: E402


def main(only: str | None = None) -> None:
    for car in store.list_items("cars"):
        cap = car.get("capture") or {}
        if (only and car["id"] != only) or cap.get("status") != "done" or not cap.get("splat"):
            continue
        url = cap["splat"].rsplit("/", 1)[0] + "/core.glb"
        info = core.build(store.media_path(cap["splat"]), cap["transform"], cap["size"], store.media_path(url),
                          (car.get("color") or {}).get("hex"))
        store.update_item("cars", car["id"], {"capture": {**cap, "core": url}})
        print(f"{car['id']}: core of {info['volume']} m³, {info['faces']:,} faces → {url}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
