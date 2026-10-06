"""One-time setup: train the car-parts model (wheels, windows, lights, doors, bumpers…).

YOLO11 segmentation fine-tuned on Ultralytics' car-parts dataset (CC BY 4.0, ~3,800 photos,
23 part types). Runs as a worker job; the result is tools/carparts-seg.pt."""
from __future__ import annotations

import shutil
from pathlib import Path

from . import jobs
from .paths import DATA, TOOLS

STEPS = [("data", "Downloading the car-parts photos"), ("train", "Teaching the model car parts"), ("save", "Saving the model")]
# Fine-tuning from COCO-trained weights: wheels and windows are learnt in a few rounds. Sized
# for a 16 GB Mac (about 6 GB, roughly 2 hours on an M1 Pro).
EPOCHS = 12
IMGSZ = 512
BATCH = 8
YAML = """# Ultralytics car-parts segmentation dataset (CC BY 4.0), stored inside Chassis's data folder.
path: {root}
train: images/train
val: images/val
test: images/test
names:
  0: back_bumper
  1: back_door
  2: back_glass
  3: back_left_door
  4: back_left_light
  5: back_light
  6: back_right_door
  7: back_right_light
  8: front_bumper
  9: front_door
  10: front_glass
  11: front_left_door
  12: front_left_light
  13: front_light
  14: front_right_door
  15: front_right_light
  16: hood
  17: left_mirror
  18: object
  19: right_mirror
  20: tailgate
  21: trunk
  22: wheel
"""
URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/carparts-seg.zip"


def run(state: dict) -> dict:
    from ultralytics import YOLO

    from .vision.models import DEVICE

    job = state["id"]
    work = jobs.folder(job)
    root = DATA / "datasets" / "carparts-seg"
    yaml = work / "carparts.yaml"
    yaml.write_text(YAML.format(root=root))

    jobs.set_step(job, "data", "running")
    if not any((root / "images" / "train").glob("*.jpg")):
        # Downloaded here ourselves: Ultralytics' own auto-download goes to a folder outside the project.
        from ultralytics.utils.downloads import download

        download(URL, dir=root.parent, unzip=True, delete=True)
    n = sum(1 for _ in (root / "images" / "train").glob("*.jpg"))
    if not n:
        raise RuntimeError("The car-parts photos didn't download. Check the internet connection and try again.")
    jobs.set_step(job, "data", "done", detail=f"{n:,} training photos")

    jobs.set_step(job, "train", "running", progress=0.0)
    last = work / "train" / "weights" / "last.pt"
    start = TOOLS / "yolo11s-seg.pt"
    if not start.exists():
        from ultralytics.utils.downloads import attempt_download_asset

        attempt_download_asset(str(start))
    model = YOLO(str(last if last.exists() else start))
    model.add_callback("on_fit_epoch_end", lambda t: jobs.set_step(
        job, "train", "running", progress=(t.epoch + 1) / EPOCHS,
        detail=f"Round {t.epoch + 1} of {EPOCHS}" + (f" · mask accuracy {t.metrics.get('metrics/mAP50(M)', 0):.2f}" if t.metrics else "")))
    if last.exists():  # picked up after the app was closed mid-training
        model.train(resume=True)
    else:
        model.train(data=str(yaml), epochs=EPOCHS, imgsz=IMGSZ, batch=BATCH, device=DEVICE, project=str(work), name="train",
                    exist_ok=True, plots=False, verbose=False, workers=4, deterministic=False)
    jobs.set_step(job, "train", "done")

    jobs.set_step(job, "save", "running")
    best = Path(work / "train" / "weights" / "best.pt")
    shutil.copy(best, TOOLS / "carparts-seg.pt")
    metrics = YOLO(str(best)).val(data=str(yaml), imgsz=IMGSZ, batch=BATCH, device=DEVICE, plots=False, verbose=False)
    result = {"maskMAP50": round(float(metrics.seg.map50), 3), "boxMAP50": round(float(metrics.box.map50), 3)}
    jobs.set_step(job, "save", "done", detail=f"Mask accuracy (mAP50) {result['maskMAP50']:.2f}")
    return result


jobs.RUNNERS["parts"] = run
