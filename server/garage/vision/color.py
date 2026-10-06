"""Paint colour: the dominant colour of the body, named the way a dealer would."""
from __future__ import annotations

import numpy as np
from PIL import Image

PAINTS = [
    ("White", (240, 240, 238)), ("Pearl white", (228, 226, 218)), ("Silver", (178, 181, 186)),
    ("Gray", (108, 111, 116)), ("Dark gray", (62, 64, 68)), ("Black", (20, 20, 22)),
    ("Red", (178, 22, 30)), ("Dark red", (100, 18, 26)), ("Burgundy", (110, 36, 44)), ("Red-orange", (205, 70, 35)), ("Orange", (222, 104, 28)), ("Amber", (228, 152, 40)),
    ("Yellow", (232, 190, 22)), ("Gold", (176, 148, 84)), ("Beige", (196, 178, 148)),
    ("Brown", (92, 62, 42)), ("Green", (36, 104, 56)), ("Dark green", (22, 56, 38)),
    ("Light blue", (118, 160, 204)), ("Blue", (28, 76, 164)), ("Dark blue", (22, 36, 72)),
    ("Purple", (88, 40, 110)),
]


def _lab(rgb: np.ndarray) -> np.ndarray:
    import cv2

    return cv2.cvtColor(rgb.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(float)


_REF = _lab(np.array([c for _, c in PAINTS]))


def _nearest_name(c: np.ndarray) -> int:
    """Index of the paint name closest to a Lab colour. Lightness, saturation and hue are
    weighed separately (as in CIE ΔE94), hue most: a red in shade is still a red, not a brown."""
    a, b = c[1] - 128, c[2] - 128
    ra, rb = _REF[:, 1] - 128, _REF[:, 2] - 128
    c1, c2 = np.hypot(a, b), np.hypot(ra, rb)
    dl = _REF[:, 0] - c[0]
    dc = c2 - c1
    dh2 = np.maximum((ra - a) ** 2 + (rb - b) ** 2 - dc ** 2, 0)  # hue difference, squared
    return int(np.sqrt((0.5 * dl) ** 2 + dc ** 2 + 4 * dh2).argmin())


def _paint_cluster(centers: np.ndarray, counts: np.ndarray) -> np.ndarray:
    """The paint among the colour clusters (Lab centres). Clusters of one hue count together:
    a red door in sun and in shade is one paint. Dark colourless clusters (tyres, shadows, trim,
    a convertible's interior) count for less, though a black car still wins on sheer area."""
    chroma = np.hypot(centers[:, 1] - 128, centers[:, 2] - 128)
    hue = np.degrees(np.arctan2(centers[:, 2] - 128, centers[:, 1] - 128))
    n = len(centers)
    group = list(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            same_hue = chroma[i] > 12 and chroma[j] > 12 and abs((hue[i] - hue[j] + 180) % 360 - 180) < 30
            if same_hue:
                group[j] = group[i]
    weight = np.where((centers[:, 0] < 60) & (chroma < 10), 0.75, 1.0) * counts
    totals = {g: weight[[i for i in range(n) if group[i] == g]].sum() for g in set(group)}
    best = max(totals, key=totals.get)
    members = [i for i in range(n) if group[i] == best]
    # Shade only darkens paint, so the lit side shows its colour best.
    return centers[max(members, key=lambda i: centers[i, 0])]


COLOURED = 15  # Lab chroma above which a pixel counts as coloured paint rather than grey/black/white
COLOURED_SHARE = 0.3  # share of body pixels that must be coloured for the paint to be a colour


def _chromatic(lab: np.ndarray) -> np.ndarray | None:
    """Coloured paint: the typical hue of the coloured pixels, at the lightness and depth of colour
    of their well-lit side (shade and reflections of the sky only make paint duller and darker)."""
    a, b = lab[:, 1] - 128, lab[:, 2] - 128
    chroma = np.hypot(a, b)
    col = chroma > COLOURED
    if col.mean() < COLOURED_SHARE:
        return None
    hue = np.arctan2(b[col], a[col])
    # The hue where the colour is strongest: reflections of the sky and shade both wash paint out
    # and pull its hue (pale reflections on orange read pink), so the most coloured quarter leads.
    strong = chroma[col] >= np.percentile(chroma[col], 75)
    h = np.arctan2(np.sin(hue[strong]).mean(), np.cos(hue[strong]).mean())
    near = np.abs(np.angle(np.exp(1j * (hue - h)))) < np.radians(35)  # the paint, not stray tail lights
    L = np.percentile(lab[col][near, 0], 70)
    c = np.percentile(chroma[col][near], 70)
    return np.array([L, 128 + c * np.cos(h), 128 + c * np.sin(h)])


def paint_color(img: Image.Image, mask: np.ndarray | None, box) -> dict:
    """The body's paint colour, named the way a dealer would. Taken from the car's outline between
    the roofline and the sills (doors, fenders, hood on a three-quarter view)."""
    import cv2

    rgb = np.asarray(img.convert("RGB"))
    x0, y0, x1, y1 = [int(v) for v in box]
    h = y1 - y0
    band = np.zeros(rgb.shape[:2], bool)
    band[y0 + int(0.3 * h): y0 + int(0.8 * h), x0:x1] = True
    sel = band & mask if mask is not None and mask.shape == band.shape else band
    px = rgb[sel]
    if len(px) < 50:
        px = rgb[y0:y1, x0:x1].reshape(-1, 3)
    lab = _lab(px)
    c = _chromatic(lab)
    if c is None:
        # Black, grey, silver or white: the biggest cluster of similar shades, trimmed of
        # reflections (brightest 10%) and gaps and shadow (darkest 10%).
        lo, hi = np.percentile(lab[:, 0], [10, 90])
        keep = lab[(lab[:, 0] >= lo) & (lab[:, 0] <= hi)]
        if len(keep) == 0:
            keep = lab
        k = min(3, len(keep))
        _, labels, centers = cv2.kmeans(keep.astype(np.float32), k, None,
                                        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3, cv2.KMEANS_PP_CENTERS)
        c = _paint_cluster(centers, np.bincount(labels.ravel(), minlength=k))
    rgb_c = cv2.cvtColor(np.clip(c, 0, 255).reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB).reshape(3)
    i = _nearest_name(c)
    return {"name": PAINTS[i][0], "hex": "#{:02x}{:02x}{:02x}".format(*[int(v) for v in rgb_c])}
