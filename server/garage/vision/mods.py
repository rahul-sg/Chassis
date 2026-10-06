"""Mod previews on a photo of your car: paint colour and finish, wheel finish, window tint.

Paint: inside the car's outline, each pixel is weighted by how close it is to the car's own
paint colour (so glass, black trim, tyres and chrome keep their look), then moved to the new
colour in Lab space keeping its brightness relative to the paint: reflections and shading
stay where they were. Wheels and windows come from the car-parts model when it's trained
(tools/train_parts.py); without it, wheel and tint previews aren't offered.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from ..paths import TOOLS
from .models import DEVICE, gpu

PARTS_MODEL = TOOLS / "carparts-seg.pt"
WHEEL_FINISH = {"black": (24, 24, 26), "gunmetal": (62, 66, 72), "bronze": (122, 92, 52), "silver": (196, 198, 202),
                "white": (232, 232, 228), "gold": (176, 140, 60)}
GLASS = {"front_glass", "back_glass"}


def _lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)


def _rgb(lab: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


_parts = None


def parts_model():
    """The car-parts model once it's trained (checked again on each call until it exists)."""
    global _parts
    if _parts is None and PARTS_MODEL.exists():
        from ultralytics import YOLO

        _parts = YOLO(str(PARTS_MODEL))
    return _parts


def parts(img: np.ndarray) -> dict[str, np.ndarray]:
    """Part name → mask (bool), merged over instances. Empty without the parts model."""
    model = parts_model()
    if model is None:
        return {}
    with gpu:
        r = model.predict(img[:, :, ::-1], conf=0.25, imgsz=960, device=DEVICE, retina_masks=True, verbose=False)[0]
    out: dict[str, np.ndarray] = {}
    if r.masks is None:
        return out
    for m, c in zip(r.masks.data.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)):
        name = r.names[c]
        out[name] = out.get(name, np.zeros(img.shape[:2], bool)) | (m > 0.5)
    return out


RIM_SHARE = 0.68  # rim diameter over tyre diameter, typical for today's cars


def rims(wheels: np.ndarray) -> np.ndarray:
    """The rim of each wheel: its inner disc, whatever colour the rim is. Each wheel is fitted
    with an ellipse (it's a circle seen at an angle) and shrunk to the rim's share."""
    out = np.zeros_like(wheels)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(wheels.astype(np.uint8))
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 200:
            continue
        contours, _ = cv2.findContours((labels == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(contours, key=cv2.contourArea)
        if len(c) < 5:
            continue
        (cx, cy), (a, b), angle = cv2.fitEllipse(c)
        disc = np.zeros(wheels.shape, np.uint8)
        cv2.ellipse(disc, ((cx, cy), (a * RIM_SHARE, b * RIM_SHARE), angle), 1, -1)
        out |= (disc > 0) & (labels == i)
    return out


def rgb_paint_lab(paint_hex: str) -> np.ndarray:
    return _lab(np.array([[hex_rgb(paint_hex)]], np.uint8))[0, 0]


def side_windows(p: dict[str, np.ndarray], lab: np.ndarray, paint_lab: np.ndarray) -> np.ndarray:
    """The parts model knows the windscreen and rear window but not the side windows. A door's
    outline includes its window, so: the upper part of each door that isn't body paint."""
    out = np.zeros(lab.shape[:2], bool)
    for name, door in p.items():
        if "door" not in name or not door.any():
            continue
        ys = np.nonzero(door.any(axis=1))[0]
        top, bottom = ys.min(), ys.max()
        upper = np.zeros_like(door)
        upper[top:int(top + 0.5 * (bottom - top))] = True
        not_paint = paint_weight(lab, np.ones_like(door), paint_lab, None) < 0.3
        found = (door & upper & not_paint).astype(np.uint8)
        found = cv2.morphologyEx(found, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        if found.sum() < 0.03 * door.sum():
            continue
        # A side window is one convex pane: reflections of the sky can look like pale paint,
        # so the pieces found are filled out to their convex shape (kept inside the door).
        pts = cv2.findNonZero(found)
        hull = np.zeros_like(found)
        cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
        out |= (hull > 0) & door & upper
    return out


def paint_weight(lab: np.ndarray, car: np.ndarray, paint_lab: np.ndarray, exclude: np.ndarray | None) -> np.ndarray:
    """0–1 per pixel: how much it is the car's paint."""
    d_ab = np.linalg.norm(lab[..., 1:] - paint_lab[1:], axis=-1)
    d_l = np.abs(lab[..., 0] - paint_lab[0])
    # Chroma decides; brightness only matters for grey paints, where it is all there is.
    grey = np.hypot(paint_lab[1] - 128, paint_lab[2] - 128) < 12
    d = d_ab + (0.35 if grey else 0.08) * d_l
    w = np.clip(1 - (d - 10) / 22, 0, 1)
    w *= car.astype(np.float32)
    if exclude is not None:
        w *= ~exclude
    w = cv2.GaussianBlur(w, (0, 0), 1.6)
    return w


def repaint(img: Image.Image, car_mask: np.ndarray, paint_hex: str, target_hex: str, finish: str = "gloss",
            wheel: str | None = None, tint: float = 0.0) -> tuple[Image.Image, dict]:
    rgb = np.asarray(img.convert("RGB"))
    lab = _lab(rgb)
    p = parts(rgb)
    glass = np.zeros(rgb.shape[:2], bool)
    for g in GLASS:
        if g in p:
            glass |= p[g]
    glass |= side_windows(p, lab, rgb_paint_lab(paint_hex))
    wheels = p.get("wheel")
    lights = np.zeros(rgb.shape[:2], bool)
    for k, m in p.items():
        if "light" in k:
            lights |= m
    exclude = glass | lights | (wheels if wheels is not None else False)
    paint_lab = _lab(np.array([[hex_rgb(paint_hex)]], np.uint8))[0, 0]
    target_lab = _lab(np.array([[hex_rgb(target_hex)]], np.uint8))[0, 0]
    w = paint_weight(lab, car_mask, paint_lab, exclude)[..., None]

    out = lab.copy()
    # Brightness: keep each pixel's offset from the paint, centred on the new colour.
    rel = lab[..., 0] - paint_lab[0]
    # Shadows keep their depth; highlights (reflections) soften for satin and matte finishes.
    gain = {"gloss": 1.0, "satin": 0.45, "matte": 0.15}.get(finish, 1.0)
    new_l = target_lab[0] + np.where(rel > 0, rel * gain, rel)
    new = np.stack([new_l, np.full_like(new_l, target_lab[1]), np.full_like(new_l, target_lab[2])], -1)
    out = out * (1 - w) + new * w

    applied = {"paint": True, "wheels": False, "tint": False}
    if wheel and wheels is not None and wheel in WHEEL_FINISH:
        rim = rims(wheels)
        wl = _lab(np.array([[WHEEL_FINISH[wheel]]], np.uint8))[0, 0]
        rw = cv2.GaussianBlur(rim.astype(np.float32), (0, 0), 1.2)[..., None]
        shade = (lab[..., 0] - lab[..., 0][rim].mean()) if rim.any() else 0
        rim_new = np.stack([np.clip(wl[0] + 0.6 * shade, 0, 255), np.full(rim.shape, wl[1]), np.full(rim.shape, wl[2])], -1)
        out = out * (1 - rw) + rim_new * rw
        applied["wheels"] = True
    if tint > 0 and glass.any():
        gw = cv2.GaussianBlur(glass.astype(np.float32), (0, 0), 1.2)[..., None] * min(1.0, tint)
        dark = out.copy()
        dark[..., 0] *= 0.35
        dark[..., 1:] = 128 + (dark[..., 1:] - 128) * 0.4
        out = out * (1 - gw) + dark * gw
        applied["tint"] = True
    return Image.fromarray(_rgb(out)), {**applied, "partsModel": parts_model() is not None}
