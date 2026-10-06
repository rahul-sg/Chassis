"""One photo → 3D: an AI guess at the car's shape and colours, for cars without a walk-around.

TripoSR (MIT licence, Tripo AI and Stability AI) predicts a 3D shape from a single picture.
It has never seen the far side of the car, so that side is invented: the result is labelled
an AI guess everywhere it's shown. The car is cut out with BiRefNet first and centred on grey,
which is what TripoSR was trained on.

Runs as its own process (python -m garage.guess3d IN.png OUT.glb) so the 1.6 GB model is gone
from memory when it's done. TripoSR's source lives in tools/TripoSR; two packages it imports
but Chassis doesn't need are stood in for by garage/shims.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from . import jobs, store
from .paths import MEDIA, ROOT, TOOLS

TRIPOSR = TOOLS / "TripoSR"
REPO = "stabilityai/TripoSR"
REVISION = "5b521936b01fbe1890f6f9baed0254ab6351c04a"  # pinned weights
STEPS = [("cutout", "Cutting the car out of the photo"), ("shape", "Guessing the 3D shape"), ("save", "Saving the model")]
FOREGROUND = 0.85  # share of the picture the car fills, as in TripoSR's own examples
RESOLUTION = 256  # marching-cubes grid: detail of the mesh


def available() -> bool:
    return (TRIPOSR / "tsr" / "system.py").exists()


def prepare(rgba: Image.Image) -> Image.Image:
    """The cut-out car, squared up and centred on mid-grey at 512 px."""
    a = np.asarray(rgba.convert("RGBA")).astype(np.float32) / 255
    ys, xs = np.nonzero(a[..., 3] > 0.5)
    crop = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape[:2]
    side = int(max(h, w) / FOREGROUND)
    canvas = np.zeros((side, side, 4), np.float32)
    y0, x0 = (side - h) // 2, (side - w) // 2
    canvas[y0:y0 + h, x0:x0 + w] = crop
    rgb = canvas[..., :3] * canvas[..., 3:] + 0.5 * (1 - canvas[..., 3:])
    return Image.fromarray((rgb * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)


def _infer(image_path: Path, out: Path) -> dict:
    """In the child process: TripoSR on one prepared image, saved as GLB with vertex colours."""
    sys.path[:0] = [str(Path(__file__).parent / "shims"), str(TRIPOSR)]
    import torch
    import trimesh
    from tsr.system import TSR

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    t0 = time.time()
    from huggingface_hub import snapshot_download

    weights = snapshot_download(REPO, revision=REVISION, allow_patterns=["config.yaml", "model.ckpt"])
    model = TSR.from_pretrained(weights, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    with torch.no_grad():
        codes = model([Image.open(image_path).convert("RGB")], device=device)
    mesh = model.extract_mesh(codes, True, resolution=RESOLUTION)[0]
    # TripoSR's frame has z up; the web viewer has y up.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(out)
    return {"vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)), "seconds": round(time.time() - t0, 1),
            "device": device}


def run(state: dict) -> dict:
    """The worker job: cut out, guess in a child process, store on the car."""
    from . import sell

    job, car_id, photo = state["id"], state["carId"], state["photo"]
    work = jobs.folder(job)
    store.update_item("cars", car_id, {"guess": {"status": "running", "job": job, "photo": photo}})

    jobs.set_step(job, "cutout", "running")
    cut = sell.cutout_cached(photo)
    if cut is None:
        raise RuntimeError("No car found in that photo. Pick one with the whole car in view.")
    prepare(cut["rgba"]).save(work / "input.png")
    jobs.set_step(job, "cutout", "done")

    jobs.set_step(job, "shape", "running", detail="Loading the model (the first time downloads about 1.6 GB)")
    out = MEDIA / "guesses" / job / "car.glb"
    proc = subprocess.run([sys.executable, "-m", "garage.guess3d", str(work / "input.png"), str(out)],
                          cwd=ROOT / "server", capture_output=True, text=True)
    (work / "triposr.log").write_text(proc.stdout + proc.stderr)
    if proc.returncode != 0 or not out.exists():
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["no output"]
        raise RuntimeError(f"The 3D guess didn't finish: {tail[0][:200]}")
    info = json.loads(proc.stdout.strip().splitlines()[-1])
    jobs.set_step(job, "shape", "done", detail=f"{info['faces']:,} triangles in {info['seconds']:.0f} s")

    jobs.set_step(job, "save", "running")
    store.update_item("cars", car_id, {"guess": {
        "status": "done", "job": job, "photo": photo, "model": f"/media/guesses/{job}/car.glb",
        "input": store.save_media((work / "input.png").read_bytes(), "png"), "createdAt": store.now(), **info}})
    jobs.set_step(job, "save", "done")
    return info


def failed(state: dict) -> None:
    car_id = state.get("carId")
    if car_id and store.get_item("cars", car_id):
        store.update_item("cars", car_id, {"guess": {"status": "failed", "job": state["id"], "error": state.get("error")}})


jobs.RUNNERS["guess"] = run
jobs.RUNNERS["guess:failed"] = failed

if __name__ == "__main__":
    print(json.dumps(_infer(Path(sys.argv[1]), Path(sys.argv[2]))))
