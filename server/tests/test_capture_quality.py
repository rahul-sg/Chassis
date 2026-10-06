import tempfile
from pathlib import Path

import cv2
import numpy as np

from garage.capture import check, clean, frames


def test_hdr_reference_white_comes_out_near_white_and_greys_stay_grey():
    # HLG puts HDR's reference white (203 nits) at a signal of about 0.75.
    grey = np.full((4, 4, 3), 0.75, np.float32)
    out = frames.hdr_to_sdr(grey, frames.HLG)
    assert out.min() > 235 and np.ptp(out) <= 2
    dark = frames.hdr_to_sdr(np.full((4, 4, 3), 0.3, np.float32), frames.HLG)
    assert 40 < dark.mean() < 160  # shadows don't crush or wash out


def test_hdr_highlights_ease_into_white_without_hard_clipping():
    ramp = np.linspace(0.75, 1.0, 64, dtype=np.float32)[None, :, None].repeat(3, 2)
    out = frames.hdr_to_sdr(ramp, frames.HLG)[0, :, 0].astype(int)
    assert (np.diff(out) >= 0).all() and out[-1] >= 250


def _masks(folder: Path, box, n=20, size=(160, 90)):
    folder.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        m = np.zeros((size[1], size[0]), np.uint8)
        x0, y0, x1, y1 = box
        m[y0:y1, x0:x1] = 255
        cv2.imwrite(str(folder / f"{i:04d}.jpg"), m)
    return folder


def test_a_well_framed_landscape_video_passes():
    d = _masks(Path(tempfile.mkdtemp()) / "masks", (30, 25, 130, 75))
    issues, _ = check.review({"portrait": False, "duration": 40}, d)
    assert issues == []


def test_portrait_and_too_close_videos_are_flagged():
    d = _masks(Path(tempfile.mkdtemp()) / "masks", (0, 10, 90, 150), size=(90, 160))
    issues, f = check.review({"portrait": True, "duration": 40}, d)
    assert f["cutOff"] == 1.0
    assert any("portrait" in i for i in issues) and any("further back" in i for i in issues)


def test_a_short_video_is_flagged():
    d = _masks(Path(tempfile.mkdtemp()) / "masks", (30, 25, 130, 75))
    issues, _ = check.review({"portrait": False, "duration": 9}, d)
    assert any("9 seconds" in i for i in issues)


def test_camera_height_sets_the_scale():
    # A placement at 4.85 m where the phone appears 1.6 m up: a real phone at 1.48 m means a shorter car.
    place = {"matrix": list(np.eye(4).ravel()), "size": [4.85, 1.6, 1.9]}
    centers = np.array([[np.cos(a) * 4, 1.6, np.sin(a) * 4] for a in np.linspace(0, 6.2, 40)])
    length = clean.camera_length(place, centers)
    assert abs(length - 4.85 * 1.48 / 1.6) < 0.01
    scaled = clean.rescale(place, length)
    assert abs(scaled["size"][0] - length) < 0.01 and abs(scaled["matrix"][0] - length / 4.85) < 1e-4


def test_implausible_camera_heights_are_ignored():
    place = {"matrix": list(np.eye(4).ravel()), "size": [4.85, 1.6, 1.9]}
    on_floor = np.array([[np.cos(a) * 4, 0.05, np.sin(a) * 4] for a in np.linspace(0, 6.2, 40)])
    assert clean.camera_length(place, on_floor) is None


def test_road_splats_go_and_upright_ones_stay():
    n = 4
    v = np.zeros(n, dtype=[(k, "f4") for k in ("rot_0", "rot_1", "rot_2", "rot_3", "scale_0", "scale_1", "scale_2")])
    v["rot_0"] = 1  # identity rotation: axes are x, y, z
    flat = (np.log(0.05), np.log(0.001), np.log(0.05))     # thin along y (up): lying on the floor
    upright = (np.log(0.05), np.log(0.05), np.log(0.001))  # thin along z: standing up, like a tyre wall
    for i, sc in enumerate((flat, upright, flat, upright)):
        v["scale_0"][i], v["scale_1"][i], v["scale_2"][i] = sc
    xyz = np.array([[0, 0.02, 0], [0, 0.02, 0.5], [0, 1.0, 0], [0, 1.0, 0.5]], float)  # two low, two high
    place = {"matrix": list(np.eye(4).ravel()), "size": [4.5, 1.5, 1.8]}
    gone = clean.road(v, xyz, np.ones(n, bool), place)
    assert gone.tolist() == [True, False, False, False]


def _splats(scales, colours):
    names = ("rot_0", "rot_1", "rot_2", "rot_3", "scale_0", "scale_1", "scale_2", "f_dc_0", "f_dc_1", "f_dc_2")
    v = np.zeros(len(scales), dtype=[(k, "f4") for k in names])
    v["rot_0"] = 1
    for i, (sc, rgb) in enumerate(zip(scales, colours)):
        v["scale_0"][i], v["scale_1"][i], v["scale_2"][i] = np.log(sc)
        v["f_dc_0"][i], v["f_dc_1"][i], v["f_dc_2"][i] = (np.array(rgb) - 0.5) / clean.SH_C0
    return v


def test_needles_go_and_ordinary_splats_stay():
    v = _splats([(0.3, 0.01, 0.01), (0.05, 0.04, 0.02), (0.13, 0.03, 0.02)], [(0.5, 0.5, 0.5)] * 3)
    place = {"matrix": list(np.eye(4).ravel()), "size": [4.5, 1.5, 1.8]}
    assert clean.needles(v, np.ones(3, bool), place).tolist() == [True, False, False]


def test_pale_pavement_goes_and_dark_tyres_stay():
    v = _splats([(0.02, 0.02, 0.02)] * 3, [(0.6, 0.6, 0.6), (0.1, 0.1, 0.1), (0.6, 0.6, 0.6)])
    xyz = np.array([[0, 0.03, 0], [0, 0.03, 0], [0, 0.8, 0]], float)  # pale and low, dark and low, pale and high
    place = {"matrix": list(np.eye(4).ravel()), "size": [4.5, 1.5, 1.8]}
    assert clean.pavement(v, xyz, np.ones(3, bool), place).tolist() == [True, False, False]
