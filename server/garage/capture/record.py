"""What a car's capture record looks like while a new walk-around is built.

Filming the car again shouldn't take its 3D model away: the finished model is kept as
previousCapture and stays on show until the new one is done. If the new video doesn't work,
the earlier model comes back with a note saying why. A length you entered carries over.
"""
from __future__ import annotations

from .. import store

RETAKE_NOTES = ("retakeError", "retakeJob")


def start(car: dict, job: str, video: str) -> dict:
    """The patch for a car whose (new) capture is starting with this job."""
    cap = car.get("capture") or {}
    patch: dict = {"capture": {"status": "queued", "job": job, "video": video, "error": None}}
    if cap.get("status") == "done" and cap.get("splat") and cap.get("job") != job:
        patch["previousCapture"] = {k: v for k, v in cap.items() if k not in RETAKE_NOTES}
    earlier = patch.get("previousCapture") or car.get("previousCapture") or {}
    if earlier.get("lengthSource") == "you" and earlier.get("length"):
        patch["capture"].update(length=earlier["length"], lengthSource="you")
    return patch


def finished(car_id: str) -> None:
    """The new model is in: the earlier one isn't needed on show any more."""
    store.update_item("cars", car_id, {"previousCapture": None})


def failed(car_id: str, job: str, error: str | None) -> None:
    """The new video didn't make a model: bring back the earlier one, if there was one."""
    car = store.get_item("cars", car_id)
    if car is None:
        return
    earlier = car.get("previousCapture")
    if earlier:
        store.update_item("cars", car_id, {"capture": {**earlier, "retakeError": error, "retakeJob": job}, "previousCapture": None})
    else:
        cap = car.get("capture") or {}
        store.update_item("cars", car_id, {"capture": {**cap, "status": "failed", "error": error}})


def showing(car: dict) -> dict:
    """The capture to show and use right now: the finished one, or the earlier model while a new
    walk-around is being built."""
    cap = car.get("capture") or {}
    if cap.get("status") != "done" and (car.get("previousCapture") or {}).get("status") == "done":
        return car["previousCapture"]
    return cap
