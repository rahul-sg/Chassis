"""Run a finished capture's clean-up and scaling again, without retraining (seconds, not minutes).

    server/.venv/bin/python server/tools/reclean.py CAR_ID

For when the clean-up rules improve: the trained splats are kept in the job folder, so the car can
be cut out and placed again. The previous car.ply is kept as car.before.ply.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from garage import jobs, store  # noqa: E402
from garage.capture import clean  # noqa: E402
from garage.capture.pipeline import _car_length  # noqa: E402


def main(car_id: str) -> None:
    car = store.get_item("cars", car_id)
    cap = (car or {}).get("capture") or {}
    if cap.get("status") != "done" or not cap.get("job"):
        sys.exit("That car has no finished 3D model.")
    work = jobs.folder(cap["job"])
    trained = sorted((work / "train").glob("*.ply"))
    dataset = work / "dataset_best" if (work / "dataset_best").exists() else work / "dataset"
    if not trained:
        sys.exit("The trained model isn't in the job folder any more.")
    out = store.media_path(cap["splat"])
    backup = out.with_name("car.before.ply")
    if not backup.exists():
        shutil.copy(out, backup)
    length, source = _car_length(car)
    info = clean.clean(trained[-1], dataset / "sparse" / "txt", dataset / "masks", out, length, length_known=source == "you",
                       paint=(car.get("color") or {}).get("hex"))
    stats = {**(cap.get("stats") or {}), "splats": info["splats"]}
    core = cap["splat"].rsplit("/", 1)[0] + "/core.glb" if info.get("core") else None
    store.update_item("cars", car_id, {"capture": {**cap, "transform": info["matrix"], "size": info["size"], "core": core,
                                                   "length": info["size"][0], "lengthSource": info["lengthSource"],
                                                   "stats": stats}})
    print(f"{info['splats']:,} splats kept (was {(cap.get('stats') or {}).get('splats', '?')}), "
          f"size L/H/W {info['size']} m, scaled from {info['lengthSource']}")


if __name__ == "__main__":
    main(sys.argv[1])
