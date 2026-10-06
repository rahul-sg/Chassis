"""Chassis local API (http://127.0.0.1:8311, reached through the website at /api)."""
from __future__ import annotations

import hashlib
import io
import json
import platform
import shutil
import time

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from starlette.concurrency import run_in_threadpool

from . import jobs, store
from .capture import record
from .capture.steps import STEPS as CAPTURE_STEPS
from .paths import MEDIA
from .specs import epa, nhtsa, sheet

app = FastAPI(title="Chassis", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.mount("/media", StaticFiles(directory=MEDIA), name="media")

KINDS = {"cars": "cars", "spotted": "spotted"}


def _lan_ips() -> list[str]:
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the outgoing interface
        ip = s.getsockname()[0]
        s.close()
        return [ip]
    except OSError:
        return []


@app.get("/api/health")
def health():
    import torch

    return {"ok": True, "python": platform.python_version(), "gpu": "mps" if torch.backends.mps.is_available() else "cpu",
            "lan": _lan_ips()}


def _open_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        return ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        raise HTTPException(400, "That file isn’t a photo this can read. Try a JPEG, PNG or HEIC exported as JPEG.")


def _save_photo(img: Image.Image, long_side: int = 1600) -> str:
    img = img.copy()
    img.thumbnail((long_side, long_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return store.save_media(buf.getvalue(), "jpg")


@app.post("/api/identify")
async def identify_photo(file: UploadFile):
    """Photo → the car in it, its likely make/model/years and its paint colour."""
    # Model work runs on a thread so the server keeps answering other requests meanwhile.
    return await run_in_threadpool(_identify, await file.read())


def _identify(data: bytes) -> dict:
    from .vision import color, detect, identify

    t0 = time.time()
    img = _open_image(data)
    url = _save_photo(img)
    car = detect.find_car(img)
    if car is None:
        return {"photo": url, "found": False, "candidates": [], "ms": round((time.time() - t0) * 1000)}
    cands = identify.identify(detect.crop(img, car["box"]))
    paint = color.paint_color(img, car["mask"], car["box"])
    return {
        "photo": url, "found": True, "kind": car["kind"], "box": car["box"], "share": car["share"],
        "size": [img.width, img.height], "candidates": cands, "color": paint,
        "ms": round((time.time() - t0) * 1000),
    }


def _vin_result(vin: str) -> dict:
    d = nhtsa.decode_vin(vin)
    fam = sheet.family_from_vin(d)
    codes = {c.strip() for c in str(d.get("ErrorCode", "")).split(",")}
    return {
        "vin": vin, "checkDigit": "1" not in codes, "decoded": bool(d.get("Make") and d.get("ModelYear")),
        "family": fam, "make": d.get("Make", "").title(), "model": d.get("Model"), "year": d.get("ModelYear"),
        "trim": d.get("Trim"), "body": d.get("BodyClass"), "engine": d.get("DisplacementL"),
    }


@app.post("/api/vin/read")
async def vin_from_photo(file: UploadFile):
    """Photo of a VIN plate or sticker → the VIN, checked against NHTSA's decoder."""
    return await run_in_threadpool(_read_vin, await file.read())


def _read_vin(data: bytes) -> dict:
    from .vision import vin

    img = _open_image(data)
    found = vin.read_vin(img)
    tried = []
    for cand in found["candidates"][:5]:
        r = _vin_result(cand)
        tried.append(cand)
        if r["decoded"] and r["family"]:
            return {**r, "found": True, "read": found["read"]}
    return {"found": False, "tried": tried, "read": found["read"][:12]}


@app.get("/api/vin/{vin}")
def vin_lookup(vin: str):
    vin = vin.strip().upper()
    if len(vin) != 17:
        raise HTTPException(400, "A VIN has 17 characters.")
    return _vin_result(vin)


@app.get("/api/specs")
def specs(year: int, make: str, model: str, variant: int | None = None, vin: str | None = None):
    try:
        return sheet.build(year, make, model, variant, vin)
    except LookupError as e:
        raise HTTPException(404, str(e))


@app.get("/api/catalog/makes")
def catalog_makes():
    return epa.makes()


@app.get("/api/catalog/models")
def catalog_models(make: str):
    return epa.models(make)


@app.get("/api/catalog/years")
def catalog_years(make: str, model: str):
    return epa.years(make, model)


@app.get("/api/stats")
def stats():
    return epa.stats()


VIDEO_TYPES = {"mp4", "mov", "m4v", "webm", "mkv", "avi"}


@app.post("/api/cars/{car_id}/capture")
def start_capture(car_id: str, file: UploadFile):
    """Upload a walk-around video and start building the 3D model."""
    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    if (car.get("capture") or {}).get("status") in ("queued", "running"):
        raise HTTPException(409, "A 3D model is already being built for this car.")
    ext = (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()
    if ext not in VIDEO_TYPES:
        raise HTTPException(400, "That doesn’t look like a video. Use MP4, MOV or WebM.")
    name = f"{store.new_id()}.{ext}"
    with (MEDIA / name).open("wb") as out:
        shutil.copyfileobj(file.file, out)
    job = jobs.submit("capture", CAPTURE_STEPS, carId=car_id, video=f"/media/{name}")
    # A car filmed again keeps showing its current model until the new one is ready.
    store.update_item("cars", car_id, record.start(car, job["id"], f"/media/{name}"))
    return job


@app.post("/api/cars/{car_id}/capture/rebuild")
def rebuild_capture(car_id: str):
    """Build the 3D model again from the video already on file (after the processing improves)."""
    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    cap = car.get("capture") or {}
    if cap.get("status") in ("queued", "running", "paused"):
        raise HTTPException(409, "A 3D model is already being built for this car.")
    video = cap.get("video")
    if not video or not store.media_path(video).exists():
        raise HTTPException(400, "The original video isn’t on file any more. Add a new walk-around instead.")
    job = jobs.submit("capture", CAPTURE_STEPS, carId=car_id, video=video)
    store.update_item("cars", car_id, record.start(car, job["id"], video))
    return job


_masks: dict[str, tuple] = {}
PREVIEW_VERSION = 2  # bump when mod previews change, so cached ones are made again


def _car_in(photo_url: str) -> tuple[Image.Image, dict]:
    """The photo and the car's outline in it (cached: mods redraw the same photo many times).
    The outline is the studio cut-out's, which follows the car far more closely than YOLO's."""
    from . import sell

    path = store.media_path(photo_url)
    if not path.exists():
        raise HTTPException(404, "That photo is gone.")
    if photo_url not in _masks:
        img = Image.open(path).convert("RGB")
        cut = sell.cutout_cached(photo_url)
        if cut is None:
            raise HTTPException(422, "No car found in that photo, so there’s nothing to repaint.")
        mask = np.asarray(cut["rgba"].getchannel("A")) > 127
        _masks[photo_url] = (img, {"mask": mask, "box": cut["box"]})
    return _masks[photo_url]


@app.post("/api/cars/{car_id}/mods")
def mod_preview(car_id: str, body: dict):
    """{photo, paint: '#rrggbb', finish, wheel, tint} → a preview image of the mods on that photo."""
    from .vision import color, mods

    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    photo = body.get("photo") or car.get("photo")
    if not photo:
        raise HTTPException(400, "Add a photo of the car first.")
    img, found = _car_in(photo)
    original = (car.get("color") or {}).get("hex") or color.paint_color(img, found["mask"], found["box"])["hex"]
    paint, finish, wheel, tint = body.get("paint") or original, body.get("finish", "gloss"), body.get("wheel"), float(body.get("tint") or 0)
    # One file per photo and setting: trying colours back and forth reuses previews instead of piling up files.
    key = hashlib.sha1(json.dumps([PREVIEW_VERSION, photo, original, paint, finish, wheel, tint,
                                   mods.parts_model() is not None]).encode()).hexdigest()[:20]
    out_path = MEDIA / "previews" / f"{key}.jpg"
    meta = out_path.with_suffix(".json")
    if out_path.exists() and meta.exists():
        return {"url": f"/media/previews/{key}.jpg", "applied": json.loads(meta.read_text())}
    out, applied = mods.repaint(img, found["mask"], original, paint, finish, wheel, tint)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, "JPEG", quality=90)
    meta.write_text(json.dumps(applied))
    return {"url": f"/media/previews/{key}.jpg", "applied": applied}


@app.get("/api/setup")
def setup_state():
    """Which optional models are installed, and the latest setup job."""
    from .paths import TOOLS
    from .vision.mods import PARTS_MODEL

    latest = None
    for f in sorted(jobs.JOBS.glob("*/state.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        state = jobs.read(f.parent.name)
        if state and state.get("kind") == "parts":
            latest = state
            break
    from huggingface_hub import try_to_load_from_cache

    from . import guess3d
    from .vision import cutout

    def cached(repo: str, name: str, rev: str) -> bool:
        return isinstance(try_to_load_from_cache(repo, name, revision=rev), str)

    return {
        "partsModel": PARTS_MODEL.exists(),
        "brush": (TOOLS / "brush-app-aarch64-apple-darwin" / "brush_app").exists(),
        "triposr": guess3d.available(),
        "triposrWeights": cached(guess3d.REPO, "model.ckpt", guess3d.REVISION),
        "birefnet": cached(cutout.REPO, "config.json", cutout.REVISION),
        "epa": epa.stats() if hasattr(epa, "stats") else None,
        "partsJob": latest,
    }


@app.post("/api/setup/parts")
def setup_parts():
    from .partsmodel import STEPS as PARTS_STEPS

    current = setup_state()["partsJob"]
    if current and current["status"] in ("queued", "running"):
        return current
    return jobs.submit("parts", PARTS_STEPS)


@app.post("/api/cars/{car_id}/studio")
def studio_photo(car_id: str, body: dict):
    """{photo, backdrop} → the car cut out of that photo onto a studio backdrop."""
    from . import sell

    if store.get_item("cars", car_id) is None:
        raise HTTPException(404, "Not found")
    try:
        return sell.studio(body.get("photo") or "", body.get("backdrop") or "studio")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/cars/{car_id}/kit")
def listing_kit(car_id: str):
    """The listing as a zip: a small website with the photos, listing, specs and 3D model."""
    from . import sell

    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    data, name = sell.build_kit(car)
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/garage/scene")
def garage_scene():
    """Every car with what the 3D garage needs: real size (measured, yours or typical for its
    class), paint colour, and the 3D model when there is one."""
    from .dimensions import typical, vclass_for

    out = []
    for car in store.list_items("cars"):
        ident = car.get("identity") or {}
        cap = record.showing(car)
        vclass = vclass_for(ident["make"], ident["model"]) if ident.get("make") else None
        scanned = cap.get("status") == "done" and cap.get("splat") and cap.get("transform") and cap.get("size")
        if scanned:
            length, height, width = cap["size"]
            source = "you" if cap.get("lengthSource") == "you" else "scan"
        else:
            length, width, height = typical(vclass)
            source = "class"
        out.append({
            "id": car["id"], "nickname": car.get("nickname"), "identity": ident or None,
            "color": (car.get("color") or {}).get("hex"), "vclass": vclass,
            "size": [round(length, 2), round(width, 2), round(height, 2)], "sizeSource": source,
            "splat": cap.get("splat") if scanned else None, "transform": cap.get("transform") if scanned else None,
            "captureSize": cap.get("size") if scanned else None, "front": cap.get("front", 1),
        })
    return out


@app.post("/api/cars/{car_id}/guess")
def start_guess(car_id: str, body: dict):
    """{photo} → queue a one-photo 3D guess (TripoSR) for this car."""
    from . import guess3d

    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    if not guess3d.available():
        raise HTTPException(503, "The one-photo 3D model isn't installed. Run bash scripts/setup.sh, then try again.")
    if (car.get("guess") or {}).get("status") in ("queued", "running"):
        raise HTTPException(409, "A 3D guess for this car is already being made.")
    photo = body.get("photo") or car.get("photo")
    if not photo or not store.media_path(photo).exists():
        raise HTTPException(400, "Add a photo of the car first.")
    job = jobs.submit("guess", guess3d.STEPS, carId=car_id, photo=photo)
    store.update_item("cars", car_id, {"guess": {"status": "queued", "job": job["id"], "photo": photo}})
    return job


@app.post("/api/jobs/{job_id}/retry")
def job_retry(job_id: str):
    state = jobs.retry(job_id)
    if state is None:
        raise HTTPException(404, "Not found")
    if state.get("carId"):
        car = store.get_item("cars", state["carId"])
        if car:
            store.update_item("cars", state["carId"], {"capture": {**(car.get("capture") or {}), "status": "queued", "error": None}})
    return state


def _save_image(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return store.save_media(buf.getvalue(), "jpg")


@app.post("/api/cars/{car_id}/condition/compare")
async def condition_compare(car_id: str, after: UploadFile = File(...), before: UploadFile | None = File(None),
                            beforeUrl: str | None = Form(None)):
    """Line up an after photo on a before photo of the same view and outline what changed."""
    from .vision import compare

    car = store.get_item("cars", car_id)
    if car is None:
        raise HTTPException(404, "Not found")
    if before is not None:
        before_img, before_url = _open_image(await before.read()), None
    elif beforeUrl and store.media_path(beforeUrl).exists():
        before_img, before_url = Image.open(store.media_path(beforeUrl)).convert("RGB"), beforeUrl
    else:
        raise HTTPException(400, "Choose a before photo.")
    after_img = _open_image(await after.read())
    try:
        r = await run_in_threadpool(compare.compare, before_img, after_img)
    except ValueError as e:
        raise HTTPException(422, str(e))
    record = {
        "id": store.new_id(), "createdAt": store.now(), "before": before_url or _save_photo(before_img),
        "after": _save_photo(after_img), "overlay": _save_image(r["overlay"]), "aligned": _save_image(r["aligned"]),
        "regions": r["regions"], "size": r["size"], "matches": r["matches"], "viewpoint": r["viewpoint"],
    }
    car = store.get_item("cars", car_id) or car  # it may have changed while comparing
    cond = car.get("condition") or {}
    store.update_item("cars", car_id, {"condition": {**cond, "comparisons": [record, *(cond.get("comparisons") or [])]}})
    return record


@app.post("/api/jobs/{job_id}/continue")
def job_continue(job_id: str):
    """Go on with a job that paused to ask you something (build anyway)."""
    state = jobs.resume(job_id)
    if state is None:
        raise HTTPException(404, "Not found")
    car_id = state.get("carId")
    if state.get("kind") == "capture" and car_id and store.get_item("cars", car_id):
        cap = store.get_item("cars", car_id).get("capture") or {}
        if cap.get("job") == job_id:
            store.update_item("cars", car_id, {"capture": {**cap, "status": "queued"}})
    return state


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    """Stop a job that's paused or still waiting (e.g. to film the car again)."""
    state = jobs.cancel(job_id, "Stopped so you can film it again.")
    if state is None:
        raise HTTPException(404, "Not found")
    return state


@app.get("/api/jobs/{job_id}")
def job_state(job_id: str):
    state = jobs.read(job_id)
    if state is None:
        raise HTTPException(404, "Not found")
    return state


@app.post("/api/media")
async def upload(file: UploadFile):
    ext = (file.filename or "").rsplit(".", 1)[-1] if "." in (file.filename or "") else "jpg"
    return {"url": store.save_media(await file.read(), ext)}


def _kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown collection")
    return KINDS[kind]


@app.get("/api/{kind}")
def list_all(kind: str):
    return store.list_items(_kind(kind))


@app.post("/api/{kind}")
def create(kind: str, item: dict):
    return store.add_item(_kind(kind), item)


@app.get("/api/{kind}/{item_id}")
def read(kind: str, item_id: str):
    item = store.get_item(_kind(kind), item_id)
    if item is None:
        raise HTTPException(404, "Not found")
    return item


@app.patch("/api/{kind}/{item_id}")
def update(kind: str, item_id: str, patch: dict):
    item = store.update_item(_kind(kind), item_id, patch)
    if item is None:
        raise HTTPException(404, "Not found")
    return item


@app.delete("/api/{kind}/{item_id}")
def delete(kind: str, item_id: str):
    if not store.delete_item(_kind(kind), item_id):
        raise HTTPException(404, "Not found")
    return {"ok": True}
