"""The capture job: video → frames → car outlines → camera path → splat → clean car."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2

from .. import jobs, store
from ..paths import MEDIA, ROOT
from . import check, clean, frames, masks, record, train
from .steps import STEPS  # noqa: F401

TRAIN_STEPS = 12000


def _car_length(car: dict) -> tuple[float, str]:
    cap = car.get("capture") or {}
    if cap.get("lengthSource") == "you" and cap.get("length"):
        return float(cap["length"]), "you"
    vclass = next((i["value"] for g in (car.get("specs") or {}).get("groups", []) for i in g["items"]
                   if i["label"] == "Size class"), None)
    if vclass is None and car.get("identity"):
        from ..dimensions import vclass_for

        vclass = vclass_for(car["identity"]["make"], car["identity"]["model"])
    return clean.typical_length(vclass), "size class"


def _set_capture(car_id: str, **fields) -> None:
    car = store.get_item("cars", car_id)
    if car is not None:
        store.update_item("cars", car_id, {"capture": {**(car.get("capture") or {}), **fields, "updatedAt": time.time()}})


def _sfm(work: Path, masked: bool, per_frame: bool) -> dict:
    args = [sys.executable, "-m", "garage.capture.sfm", str(work)] + (["--masked"] if masked else []) + \
        (["--per-frame-lens"] if per_frame else [])
    log = (work / "sfm.log").open("a")
    subprocess.run(args, cwd=ROOT / "server", stdout=log, stderr=subprocess.STDOUT, check=False)
    log.close()
    f = work / "sfm.json"
    return json.loads(f.read_text()) if f.exists() else {"ok": False, "registered": 0, "total": 1}


def run(state: dict) -> dict:
    job, car_id = state["id"], state["carId"]
    work = jobs.folder(job)
    video = MEDIA / Path(state["video"]).name
    t0 = time.time()
    car = store.get_item("cars", car_id)
    if car and (car.get("capture") or {}).get("job") != job:  # a retake retried after its earlier model came back
        store.update_item("cars", car_id, record.start(car, job, state["video"]))
    _set_capture(car_id, status="running", job=job, error=None)

    done = {s["key"] for s in state["steps"] if s["status"] == "done"}  # a retry skips finished steps

    def step(key: str):
        jobs.set_step(job, key, "running")
        return lambda f: jobs.set_step(job, key, "running", progress=f)

    if "frames" in done:
        shots = sorted((work / "frames").glob("*.jpg"))
    else:
        p = step("frames")
        shots = frames.extract(video, work / "frames", target=150, progress=p)
        jobs.set_step(job, "frames", "done", detail=f"{len(shots)} frames")

    if "masks" in done:
        mf = work / "masks.json"
        tt = json.loads(mf.read_text())["turntable"] if mf.exists() else masks.turntable(shots, work / "masks")
    else:
        p = step("masks")
        st = masks.car_masks(shots, work / "masks", progress=p)
        if st["withCar"] < 0.3 * st["frames"]:
            raise RuntimeError(f"The car was only found in {st['withCar']} of {st['frames']} frames. Keep the whole car in view.")
        tt = masks.turntable(shots, work / "masks")
        (work / "masks.json").write_text(json.dumps({**st, "turntable": tt}))
        jobs.set_step(job, "masks", "done", detail=f"Car in {st['withCar']} of {st['frames']} frames" + (" · turntable" if tt else ""))

    # Before the long part: is this video likely to make a good model? If not, ask first.
    if "check" not in done and any(s["key"] == "check" for s in state["steps"]):
        jobs.set_step(job, "check", "running")
        issues, framing = check.review(frames.probe(video), work / "masks")
        if issues and not state.get("confirmed"):
            _set_capture(car_id, status="paused")
            raise jobs.Paused(issues)
        jobs.set_step(job, "check", "done", detail="Looks good" if not issues else "Building anyway, as you chose")

    best = {"registered": 0, "total": len(shots)}
    prior = json.loads((work / "sfm.json").read_text()) if (work / "sfm.json").exists() else {}
    if "cameras" in done and (work / "sfm_best.json").exists():
        best = json.loads((work / "sfm_best.json").read_text())
    elif prior.get("registered", 0) >= 0.6 * prior.get("total", 1) and (work / "dataset" / "sparse" / "txt").exists():
        # A finished camera solve from an interrupted run.
        best = prior
        shutil.rmtree(work / "dataset_best", ignore_errors=True)
        shutil.copytree(work / "dataset", work / "dataset_best")
        (work / "sfm_best.json").write_text(json.dumps(best))
    else:
        jobs.set_step(job, "cameras", "running", detail="Matching features between frames")
        tries = [(tt, False), (tt, True), (not tt, False)]
        for masked, per_frame in tries:
            r = _sfm(work, masked, per_frame)
            if r.get("registered", 0) > best["registered"]:
                best = r
                shutil.rmtree(work / "dataset_best", ignore_errors=True)
                shutil.copytree(work / "dataset", work / "dataset_best")
                (work / "sfm_best.json").write_text(json.dumps(best))
            if r.get("registered", 0) >= 0.6 * r.get("total", 1):
                break
            jobs.set_step(job, "cameras", "running",
                          detail=f"Placed {r.get('registered', 0)} of {r.get('total')} frames; trying another way")
    if best["registered"] < 0.4 * best["total"]:
        raise RuntimeError(
            f"Only {best['registered']} of {best['total']} frames could be placed in 3D. Film in softer light, walk slowly, "
            "and keep the car filling most of the frame.")
    dataset = work / "dataset_best"
    jobs.set_step(job, "cameras", "done", detail=f"{best['registered']} of {best['total']} frames placed")

    trained = sorted((work / "train").glob("*.ply"))
    if "train" in done and trained:
        ply = trained[-1]
    else:
        p = step("train")
        ply = train.train(dataset, work / "train", steps=TRAIN_STEPS, progress=p)
        jobs.set_step(job, "train", "done")

    jobs.set_step(job, "clean", "running")
    car = store.get_item("cars", car_id) or {}
    length, source = _car_length(car)
    out = MEDIA / "captures" / job
    out.mkdir(parents=True, exist_ok=True)
    info = clean.clean(ply, dataset / "sparse" / "txt", dataset / "masks", out / "car.ply", length,
                       length_known=source == "you", paint=(car.get("color") or {}).get("hex"))
    length, source = info["size"][0], info["lengthSource"]
    # Poster: the frame where the car is largest.
    best_frame = max(shots, key=lambda f: (cv2.imread(str(work / "masks" / f.name), cv2.IMREAD_GRAYSCALE) > 127).mean())
    shutil.copy(best_frame, out / "poster.jpg")
    jobs.set_step(job, "clean", "done", detail=f"{info['splats']:,} splats kept")

    result = {
        "status": "done", "job": job, "splat": f"/media/captures/{job}/car.ply", "poster": f"/media/captures/{job}/poster.jpg",
        "transform": info["matrix"], "size": info["size"], "length": length, "lengthSource": source, "front": 1,
        "core": f"/media/captures/{job}/core.glb" if info.get("core") else None,
        "stats": {"frames": len(shots), "placed": best["registered"], "splats": info["splats"],
                  "turntable": tt, "minutes": round((time.time() - t0) / 60, 1)},
    }
    _set_capture(car_id, **result, error=None)
    record.finished(car_id)
    return result


jobs.RUNNERS["capture"] = run  # its failure hook is registered in record.py
