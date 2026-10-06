"""Studio photos: a cut-out car placed on a clean backdrop with a soft shadow under it.

The shadow is built from the car's own outline: a tight contact shadow from its lowest band
(where the tyres meet the floor) and a wide, faint one under the whole body. The dark backdrop
adds a faint floor reflection.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

SIZE = (1800, 1200)
BACKDROPS = {
    # top colour, floor colour, shadow strength, reflection strength
    "studio": ((238, 238, 236), (212, 212, 210), 0.55, 0.0),
    "graphite": ((44, 44, 49), (20, 20, 23), 0.75, 0.10),
    "white": ((252, 252, 252), (244, 244, 244), 0.45, 0.0),
}
HORIZON = 0.66  # where the wall meets the floor, as a share of the height
FLOOR = 0.82  # where the tyres sit


def _backdrop(kind: str) -> np.ndarray:
    top, floor, *_ = BACKDROPS[kind]
    w, h = SIZE
    y = np.linspace(0, 1, h)[:, None]
    # A soft sweep: wall to floor over a band around the horizon, no hard line.
    t = np.clip((y - (HORIZON - 0.12)) / 0.24, 0, 1)
    t = t * t * (3 - 2 * t)
    rows = (1 - t) * np.array(top, np.float32) + t * np.array(floor, np.float32)
    img = np.repeat(rows[:, None, :], w, axis=1).reshape(h, w, 3)
    # Light falls off towards the corners.
    x = np.linspace(-1, 1, w)[None, :]
    yy = np.linspace(-1, 1, h)[:, None]
    vignette = 1 - 0.10 * (x ** 2 + 0.6 * yy ** 2)
    return img * vignette[..., None]


def compose(rgba: Image.Image, box: list[int], clipped: list[str], kind: str = "studio") -> Image.Image:
    if kind not in BACKDROPS:
        kind = "studio"
    w, h = SIZE
    car = rgba.crop(box)
    cw, ch = car.size
    # As large as fits: 84% of the width, or less for tall vehicles; a car cut off at one side is
    # run off the same edge of the frame so it doesn't end in a hard vertical line.
    scale = min(0.84 * w / cw, 0.56 * h / ch)
    if "left" in clipped or "right" in clipped:
        scale = min(0.92 * w / cw, 0.6 * h / ch)
    car = car.resize((max(1, int(cw * scale)), max(1, int(ch * scale))), Image.LANCZOS)
    cw, ch = car.size
    x = (w - cw) // 2
    if "right" in clipped and "left" not in clipped:
        x = w - cw
    elif "left" in clipped and "right" not in clipped:
        x = 0
    y = int(FLOOR * h) - ch

    base = _backdrop(kind)
    a = np.zeros((h, w), np.float32)
    a[y:y + ch, x:x + cw] = np.asarray(car.getchannel("A"), np.float32) / 255
    _, _, strength, reflect = BACKDROPS[kind]

    # Contact shadows: a small pool under each point where the car meets the floor. Tyres are
    # where the outline's bottom edge dips lowest within its neighbourhood; seen at an angle the
    # far tyre sits higher in the picture, so each gets its own pool at its own height.
    solid = a > 0.5
    has = solid.any(axis=0)
    bottom = np.where(has, h - 1 - np.argmax(solid[::-1], axis=0), 0)
    window = max(3, int(0.12 * cw)) | 1
    local = cv2.dilate(bottom.astype(np.float32)[None, :], np.ones((1, window), np.uint8))[0]
    cols = np.nonzero(has & (bottom >= local - 0.02 * ch) & (bottom >= y + 0.6 * ch))[0]
    pools = np.zeros_like(a)
    for run in np.split(cols, np.nonzero(np.diff(cols) > 1)[0] + 1) if len(cols) else []:
        cx, cb = int(run.mean()), int(bottom[run].max())
        cv2.ellipse(pools, (cx, cb), (int(0.75 * len(run)) + 8, max(4, int(0.012 * h))), 0, 0, 360, 1.0, -1)
    contact = cv2.GaussianBlur(pools, (0, 0), 0.005 * w)
    halo = cv2.GaussianBlur(pools, (0, 0), 0.02 * w)
    contact = contact / (contact.max() + 1e-6) + 0.6 * halo / (halo.max() + 1e-6)
    # Ambient shadow: a wide, faint pool under the whole car.
    ambient = np.zeros_like(a)
    cv2.ellipse(ambient, (x + cw // 2, y + ch), (int(cw * 0.52), int(0.035 * h)), 0, 0, 360, 1.0, -1)
    ambient = cv2.GaussianBlur(ambient, (0, 0), 0.025 * w)
    shadow = np.clip(0.8 * contact + 0.45 * ambient, 0, 1) * strength
    out = base * (1 - shadow[..., None])

    rgb = np.zeros((h, w, 3), np.float32)
    rgb[y:y + ch, x:x + cw] = np.asarray(car.convert("RGB"), np.float32)
    if reflect:
        # Mirror the car below the floor line, fading out quickly.
        depth = min(int(0.4 * ch), h - (y + ch))
        if depth > 0:
            mirror_rgb = rgb[y + ch - depth:y + ch][::-1]
            mirror_a = a[y + ch - depth:y + ch][::-1]
            fade = reflect * np.linspace(1, 0, depth)[:, None] ** 2
            m = (mirror_a * fade)[..., None]
            region = out[y + ch:y + ch + depth]
            out[y + ch:y + ch + depth] = region * (1 - m) + mirror_rgb * m
    out = out * (1 - a[..., None]) + rgb * a[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
