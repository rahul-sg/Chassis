"""Before/after: what changed on the car between two photos of the same view.

The after photo is lined up on the before photo: ORB features on the car and a homography
for the overall view, then dense optical flow for the last few pixels (two hand-held photos
are never taken from exactly the same spot, so a flat warp alone leaves the car's edges
slightly off). Lighting is evened out, then the two are compared by their edges rather than
raw colour, since a scratch or dent adds edges while a passing cloud mostly changes
brightness. An edge only counts as new if the other photo has no edge within a few pixels,
which absorbs what alignment misses. Where the flow itself jumps (a depth edge: a slat in
front of the bed, a wheel in its arch), small changes in viewpoint look like change, so those
strips are left out. Regions that changed more than the rest of the car are
outlined. It flags places to look at; it doesn't diagnose damage.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

WIDTH = 1280
TOLERANCE = 7  # px at WIDTH: how far an edge may sit from its match and still count as the same edge
DEPTH_EDGE = 10.0  # flow-gradient level that marks a depth edge (a scratch on a panel stays near 5)


def _prep(img: Image.Image) -> np.ndarray:
    rgb = np.asarray(img.convert("RGB"))
    s = WIDTH / rgb.shape[1]
    return cv2.resize(rgb, (WIDTH, int(rgb.shape[0] * s)), interpolation=cv2.INTER_AREA)


def _mask(rgb: np.ndarray) -> np.ndarray:
    from .detect import find_car

    car = find_car(Image.fromarray(rgb))
    if car is None or car["mask"] is None:
        return np.ones(rgb.shape[:2], bool)
    return car["mask"]


def depth_edges(flow: np.ndarray) -> np.ndarray:
    """Where the flow jumps. Median-filtered first, so a thin scratch can't make a jump itself."""
    sm = np.stack([cv2.medianBlur(np.ascontiguousarray(flow[..., i]), 5) for i in range(2)], -1)
    sm = cv2.GaussianBlur(sm, (0, 0), 3)
    jump = sum(cv2.magnitude(cv2.Sobel(sm[..., i], cv2.CV_32F, 1, 0, ksize=3),
                             cv2.Sobel(sm[..., i], cv2.CV_32F, 0, 1, ksize=3)) for i in range(2))
    return cv2.dilate((jump > DEPTH_EDGE).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0


def align(before: np.ndarray, after: np.ndarray, mb: np.ndarray, ma: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]:
    """After warped onto before, its car mask warped too, the depth edges to leave out, the
    per-pixel shift that was still needed after the overall warp, and the feature matches used."""
    orb = cv2.ORB_create(5000)
    ga, gb = cv2.cvtColor(after, cv2.COLOR_RGB2GRAY), cv2.cvtColor(before, cv2.COLOR_RGB2GRAY)
    ka, da = orb.detectAndCompute(ga, cv2.dilate(ma.astype(np.uint8) * 255, np.ones((25, 25), np.uint8)))
    kb, db = orb.detectAndCompute(gb, cv2.dilate(mb.astype(np.uint8) * 255, np.ones((25, 25), np.uint8)))
    if da is None or db is None:
        raise ValueError("Not enough detail to line the photos up. Take the after photo from the same spot.")
    matches = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db), key=lambda m: m.distance)[:800]
    if len(matches) < 30:
        raise ValueError("These photos don’t look like the same view of the same car.")
    src = np.float32([ka[m.queryIdx].pt for m in matches])
    dst = np.float32([kb[m.trainIdx].pt for m in matches])
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if H is None or inl.sum() < 25:
        raise ValueError("These photos don’t line up. Take the after photo from the same spot, same distance.")
    h, w = before.shape[:2]
    warped = cv2.warpPerspective(after, H, (w, h))
    wm = cv2.warpPerspective(ma.astype(np.uint8), H, (w, h)) > 0
    # Fine alignment: smooth per-pixel flow from before to the warped after.
    gw = cv2.cvtColor(warped, cv2.COLOR_RGB2GRAY)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(gb, gw, None)
    edges = depth_edges(flow)
    flow = cv2.GaussianBlur(flow, (0, 0), 6)
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    mx, my = gx + flow[..., 0], gy + flow[..., 1]
    warped = cv2.remap(warped, mx, my, cv2.INTER_LINEAR)
    wm = cv2.remap(wm.astype(np.uint8), mx, my, cv2.INTER_NEAREST) > 0
    return warped, wm, edges, np.linalg.norm(flow, axis=-1), int(inl.sum())


def _texture(gray: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.GaussianBlur(cv2.magnitude(gx, gy), (0, 0), 1.5)


def compare(before_img: Image.Image, after_img: Image.Image) -> dict:
    before, after = _prep(before_img), _prep(after_img)
    mb, ma = _mask(before), _mask(after)
    if mb.shape != before.shape[:2]:
        mb = cv2.resize(mb.astype(np.uint8), before.shape[1::-1]) > 0
    if ma.shape != after.shape[:2]:
        ma = cv2.resize(ma.astype(np.uint8), after.shape[1::-1]) > 0
    warped, wm, edges, shift, used = align(before, after, mb, ma)
    region = mb & wm
    region = cv2.erode(region.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    if region.sum() < 0.02 * region.size:
        raise ValueError("Couldn’t find the car in both photos. Get the whole car in frame, from the same spot.")
    # How far apart the two viewpoints were: the shift left after the overall warp, in px at WIDTH.
    moved = float(np.percentile(shift[region], 90))
    region &= ~edges

    gb = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY).astype(np.float32)
    ga = cv2.cvtColor(warped, cv2.COLOR_RGB2GRAY).astype(np.float32)
    # Even out exposure inside the car, then compare edges.
    ga = (ga - ga[region].mean()) / (ga[region].std() + 1e-6) * gb[region].std() + gb[region].mean()
    tb, ta = _texture(gb), _texture(ga)
    # New edges (scratches, cracks, dent outlines) and edges that went away (a part missing),
    # each only where the other photo has nothing similar nearby.
    near = np.ones((TOLERANCE, TOLERANCE), np.uint8)
    diff = np.maximum(ta - cv2.dilate(tb, near), tb - cv2.dilate(ta, near)).clip(0)
    diff /= np.percentile(tb[region], 95) + 1e-6
    diff = cv2.GaussianBlur(diff, (0, 0), 2)
    diff[~region] = 0
    vals = diff[region]
    thresh = max(0.35, float(np.median(vals) + 4 * np.median(np.abs(vals - np.median(vals)))))
    hot = (diff > thresh).astype(np.uint8)
    hot = cv2.morphologyEx(hot, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    hot = cv2.morphologyEx(hot, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(hot)
    min_area = 0.001 * region.sum()
    regions = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a < min_area:
            continue
        score = float(diff[labels == i].mean() / thresh)
        regions.append({"box": [int(x), int(y), int(x + w), int(y + h)], "area": int(a), "score": round(score, 2)})
    regions.sort(key=lambda r: -r["score"] * r["area"])
    regions = regions[:8]

    overlay = before.copy()
    tint = overlay.copy()
    for r in regions:
        x0, y0, x1, y1 = r["box"]
        cv2.rectangle(tint, (x0, y0), (x1, y1), (255, 106, 31), -1)
    overlay = cv2.addWeighted(tint, 0.25, overlay, 0.75, 0)
    for k, r in enumerate(regions, 1):
        x0, y0, x1, y1 = r["box"]
        cv2.rectangle(overlay, (x0, y0), (x1, y1), (255, 106, 31), 3)
        cv2.putText(overlay, str(k), (x0 + 6, y0 + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return {
        "regions": regions,
        "matches": used,
        # Under ~3 px the photos were taken from practically the same spot.
        "viewpoint": "same" if moved < 3 else "close" if moved < 8 else "different",
        "overlay": Image.fromarray(overlay),
        "aligned": Image.fromarray(warped),
        "size": [before.shape[1], before.shape[0]],
    }
