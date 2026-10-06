import tempfile
from pathlib import Path

from garage import store
from garage.capture import record


def _isolated():
    store.FILE = Path(tempfile.mkdtemp()) / "garage.json"


def _car_with_model():
    return store.add_item("cars", {"identity": {"make": "Lexus", "model": "UX"}, "capture": {
        "status": "done", "job": "old", "splat": "/media/captures/old/car.ply", "length": 4.5, "lengthSource": "you"}})


def test_filming_again_keeps_the_current_model_on_show():
    _isolated()
    car = _car_with_model()
    store.update_item("cars", car["id"], record.start(car, "new", "/media/v.mov"))
    c = store.get_item("cars", car["id"])
    assert c["capture"]["status"] == "queued" and c["capture"]["job"] == "new"
    assert c["previousCapture"]["job"] == "old"
    assert c["capture"]["length"] == 4.5 and c["capture"]["lengthSource"] == "you"  # your length carries over


def test_a_failed_retake_brings_the_earlier_model_back():
    _isolated()
    car = _car_with_model()
    store.update_item("cars", car["id"], record.start(car, "new", "/media/v.mov"))
    record.failed(car["id"], "new", "Only 3 of 150 frames could be placed.")
    c = store.get_item("cars", car["id"])
    assert c["capture"]["job"] == "old" and c["capture"]["status"] == "done"
    assert c["capture"]["retakeError"].startswith("Only 3") and c["capture"]["retakeJob"] == "new"
    assert not c.get("previousCapture")


def test_retrying_that_retake_puts_the_earlier_model_aside_again():
    _isolated()
    car = _car_with_model()
    store.update_item("cars", car["id"], record.start(car, "new", "/media/v.mov"))
    record.failed(car["id"], "new", "x")
    c = store.get_item("cars", car["id"])
    store.update_item("cars", car["id"], record.start(c, "new", "/media/v.mov"))
    c = store.get_item("cars", car["id"])
    assert c["previousCapture"]["job"] == "old" and "retakeError" not in c["previousCapture"]


def test_a_first_capture_that_fails_is_marked_failed():
    _isolated()
    car = store.add_item("cars", {"identity": {"make": "Lexus", "model": "UX"}})
    store.update_item("cars", car["id"], record.start(car, "first", "/media/v.mov"))
    record.failed(car["id"], "first", "no frames")
    c = store.get_item("cars", car["id"])
    assert c["capture"]["status"] == "failed" and c["capture"]["error"] == "no frames"
