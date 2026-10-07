"""Keep only the car, and work out how to stand it upright at real size.

Every splat's centre is projected into a spread of the frames; it stays if it lands on
the car in most of the frames that see it (the car outlines vote, tightened a little from
the outlines used in training). Long splats must also keep both ends on the car: streaks
reaching off the body are what make edges look smeared. Then stray floaters, haze below
the car, and the road: splats lying flat at floor level, low splats outside the car's outline
seen from above, and pale ones at pavement height. Needle-like streaks go too.

The splat file itself is only filtered, never moved: the viewer applies one transform
(centre, turn upright, scale to metres), so view-dependent colour stays correct. The scale
comes from the length you entered or, failing that, from the height the video was filmed
at: people hold a phone at about chest height, and the floor is known.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from plyfile import PlyData, PlyElement

# Typical lengths (m) by EPA size class, used until you enter the exact length.
def typical_length(vclass: str | None) -> float:
    from ..dimensions import typical

    return typical(vclass)[0]


def read_cameras(txt: Path) -> tuple[dict, list[dict]]:
    cams = {}
    for line in (txt / "cameras.txt").read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        w, h = int(p[2]), int(p[3])
        v = list(map(float, p[4:]))
        fx, fy, cx, cy = (v[0], v[0], v[1], v[2]) if p[1] == "SIMPLE_PINHOLE" else (v[0], v[1], v[2], v[3])
        cams[int(p[0])] = {"w": w, "h": h, "fx": fx, "fy": fy, "cx": cx, "cy": cy}
    views = []
    lines = [ln for ln in (txt / "images.txt").read_text().splitlines() if ln and not ln.startswith("#")]
    for line in lines[::2]:  # each image takes two lines; the second lists its 2D points
        p = line.split()
        qw, qx, qy, qz = map(float, p[1:5])
        t = np.array(list(map(float, p[5:8])))
        R = np.array([
            [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
            [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
            [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
        ])
        views.append({"R": R, "t": t, "cam": cams[int(p[8])], "name": p[9], "center": -R.T @ t})
    return cams, views


TIGHTEN = 10  # px: the training outlines are widened by 15 px; voting uses them pulled back in by this much
CAMERA_HEIGHT = 1.48  # m: where a phone is held filming a walk-around (chest to eye height)


def car_votes(xyz: np.ndarray, views: list[dict], masks: Path, n_views: int = 30,
              tighten: int = TIGHTEN) -> tuple[np.ndarray, np.ndarray]:
    """(hits, seen): in how many of the sampled frames each point lands on the car / in frame."""
    hits = np.zeros(len(xyz), np.int32)
    seen = np.zeros(len(xyz), np.int32)
    kernel = np.ones((2 * tighten + 1, 2 * tighten + 1), np.uint8) if tighten else None
    for v in [views[i] for i in np.linspace(0, len(views) - 1, min(n_views, len(views))).astype(int)]:
        m = cv2.imread(str(masks / v["name"]), cv2.IMREAD_GRAYSCALE)
        if m is None:
            continue
        if kernel is not None:
            m = cv2.erode(m, kernel)
        c = v["cam"]
        pc = xyz @ v["R"].T + v["t"]
        z = pc[:, 2]
        ok = z > 1e-6
        u = np.full(len(xyz), -1.0)
        w = np.full(len(xyz), -1.0)
        u[ok] = c["fx"] * pc[ok, 0] / z[ok] + c["cx"]
        w[ok] = c["fy"] * pc[ok, 1] / z[ok] + c["cy"]
        inside = ok & (u >= 0) & (w >= 0) & (u < m.shape[1] - 1) & (w < m.shape[0] - 1)
        seen += inside
        hits[inside] += m[w[inside].astype(int), u[inside].astype(int)] > 127
    return hits, seen


def splat_axes(v) -> tuple[np.ndarray, np.ndarray]:
    """Each splat's rotation (rows: its three axes) and sizes along them (model units)."""
    q = np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], 1).astype(np.float64)
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    w, x, y, z = q.T
    rot = np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], 1),
                    np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], 1),
                    np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], 1)], 1)
    scale = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1).astype(np.float64))
    return rot, scale


def ends_on_car(v, xyz: np.ndarray, views: list[dict], masks: Path, reach: float = 2.0) -> np.ndarray:
    """True where both ends of a splat's longest axis (at `reach` sizes out) land on the car."""
    rot, scale = splat_axes(v)
    n = np.arange(len(xyz))
    i = scale.argmax(1)
    tip = (reach * scale[n, i])[:, None] * rot[n, :, i]
    ok = np.ones(len(xyz), bool)
    for end in (xyz + tip, xyz - tip):
        hits, seen = car_votes(end, views, masks)
        ok &= hits >= 0.5 * np.maximum(seen, 1)
    return ok


def road(v, xyz: np.ndarray, keep: np.ndarray, place: dict) -> np.ndarray:
    """Splats that are the road, not the car: at floor level and lying flat, or stretched out
    along the floor. Tyres and sills stand upright, so they stay."""
    M = np.array(place["matrix"]).reshape(4, 4)
    k = float(np.cbrt(abs(np.linalg.det(M[:3, :3]))))
    X = xyz @ M[:3, :3].T + M[:3, 3]
    rot, scale = splat_axes(v)
    scale = scale * k
    n = np.arange(len(xyz))
    up = M[1, :3] / k  # the model-space direction that ends up pointing up
    flat = np.abs(rot[n, :, scale.argmin(1)] @ up) > 0.7
    streak = (np.abs(rot[n, :, scale.argmax(1)] @ up) < 0.3) & (scale.max(1) > 0.07)
    low = X[:, 1] < 0.16 * place["size"][1]
    return keep & low & (flat | streak)


SH_C0 = 0.28209479177387814  # turns a splat's base colour coefficients into RGB


def placed(xyz: np.ndarray, place: dict) -> tuple[np.ndarray, float]:
    """Splat centres in metres (car upright, floor at 0) and the scale factor applied."""
    M = np.array(place["matrix"]).reshape(4, 4)
    return xyz @ M[:3, :3].T + M[:3, 3], float(np.cbrt(abs(np.linalg.det(M[:3, :3]))))


def off_the_body(xyz: np.ndarray, opacity: np.ndarray, keep: np.ndarray, place: dict, cell: float = 0.03) -> np.ndarray:
    """Low splats (below 15% of the height) outside the car's outline seen from above. The outline
    comes from the doors and bumpers (25–60% of the height, below the mirrors), so tyres, which sit
    inside it, stay, and road beside and behind the car goes."""
    from scipy import ndimage

    X, _ = placed(xyz, place)
    H = place["size"][1]
    mid = keep & (X[:, 1] > 0.25 * H) & (X[:, 1] < 0.6 * H) & (opacity > 0.3)
    if mid.sum() < 100:
        return np.zeros(len(xyz), bool)
    lo = X[keep][:, [0, 2]].min(0) - 0.5
    cells = lambda P: np.floor((P - lo) / cell).astype(int)  # noqa: E731
    shape = tuple(cells(X[keep][:, [0, 2]].max(0) + 0.5) + 1)
    grid = np.zeros(shape, bool)
    a = cells(X[mid][:, [0, 2]])
    grid[a[:, 0], a[:, 1]] = True
    grid = ndimage.binary_dilation(ndimage.binary_fill_holes(ndimage.binary_closing(grid, iterations=3)), iterations=2)
    b = cells(X[:, [0, 2]])
    ok = (b >= 0).all(1) & (b[:, 0] < shape[0]) & (b[:, 1] < shape[1])
    inside = np.zeros(len(xyz), bool)
    inside[ok] = grid[b[ok, 0], b[ok, 1]]
    return keep & (X[:, 1] < 0.15 * H) & ~inside


def needles(v, keep: np.ndarray, place: dict) -> np.ndarray:
    """Very long, very thin splats (over 12 cm and 12 times longer than wide): a training
    artifact that shows as streaks shooting off the car. Real parts are never that stretched."""
    _, k = placed(np.zeros((1, 3)), place)
    _, scale = splat_axes(v)
    s = np.sort(scale * k, 1)
    return keep & (s[:, 2] > 0.12) & (s[:, 2] / np.maximum(s[:, 1], 1e-6) > 12)


def pavement(v, xyz: np.ndarray, keep: np.ndarray, place: dict) -> np.ndarray:
    """Pale grey splats at pavement height (under 7% of the height, about 10 cm). Down there only
    the tyres are car, and tyres are dark."""
    X, _ = placed(xyz, place)
    rgb = np.clip(0.5 + SH_C0 * np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], 1), 0, 1)
    pale = (rgb.mean(1) > 0.42) & (rgb.max(1) - rgb.min(1) < 0.12)
    return keep & (X[:, 1] < 0.07 * place["size"][1]) & pale


def camera_length(place: dict, centers: np.ndarray) -> float | None:
    """The car's length if the video was filmed with the phone at about chest height: the upper
    cameras (the chest-height loop, if there were two) set the scale. None if implausible."""
    M = np.array(place["matrix"]).reshape(4, 4)
    heights = (centers @ M[:3, :3].T + M[:3, 3])[:, 1]
    h = float(np.percentile(heights, 85))
    if h <= 0:
        return None
    length = place["size"][0] * CAMERA_HEIGHT / h
    return length if 2.8 < length < 7.5 else None


def rescale(place: dict, length: float) -> dict:
    """The same placement, scaled so the car is `length` metres long."""
    k = length / place["size"][0]
    m = [round(x * k, 6) if i < 12 else x for i, x in enumerate(place["matrix"])]
    return {"matrix": m, "size": [round(x * k, 3) for x in place["size"]]}


def main_body(xyz: np.ndarray, opacity: np.ndarray, cells: int = 160) -> np.ndarray:
    """The car as one dense blob: splats in the largest connected group of occupied cells
    of a voxel grid. Stray "floaters" (sparse splats hanging in the air around the car)
    fall outside it."""
    from scipy import ndimage

    core = xyz[opacity > 0.2] if (opacity > 0.2).sum() > 1000 else xyz
    lo, hi = np.percentile(core, 0.5, axis=0), np.percentile(core, 99.5, axis=0)
    size = float(np.max(hi - lo)) / cells
    idx = np.floor((xyz - lo) / size).astype(int)
    inside = np.all((idx >= 0) & (idx < np.ceil((hi - lo) / size).astype(int) + 1), axis=1)
    shape = tuple(np.ceil((hi - lo) / size).astype(int) + 1)
    grid = np.zeros(shape, np.int32)
    np.add.at(grid, tuple(idx[inside].T), 1)
    occupied = grid >= 3  # cells holding a few splats; lone floaters don't count
    occupied = ndimage.binary_closing(occupied, iterations=2)
    labels, n = ndimage.label(occupied)
    if n == 0:
        return np.ones(len(xyz), bool)
    counts = ndimage.sum(occupied, labels, range(1, n + 1))
    body = ndimage.binary_dilation(labels == (int(np.argmax(counts)) + 1), iterations=1)
    keep = np.zeros(len(xyz), bool)
    keep[inside] = body[tuple(idx[inside].T)]
    return keep


def placement(xyz: np.ndarray, centers: np.ndarray, length: float, floor: float = 1.0) -> dict:
    """4×4 transform (row-major) that centres the car on the floor, y up, length along x, in metres."""
    c = np.median(xyz, axis=0)
    # The camera path circles the car: the normal of its plane is "up".
    cc = centers - centers.mean(0)
    up = np.linalg.svd(cc, full_matrices=False)[2][2]
    if (centers.mean(0) - c) @ up < 0:  # cameras are held above the car's middle
        up = -up
    flat = (xyz - c) - np.outer((xyz - c) @ up, up)
    axes = np.linalg.svd(flat - flat.mean(0), full_matrices=False)[2]
    x = axes[0] - (axes[0] @ up) * up
    x /= np.linalg.norm(x)
    z = np.cross(x, up)
    R = np.stack([x, up, z])  # rows: new x, y, z
    local = (xyz - c) @ R.T
    lo, hi = np.percentile(local, 1, axis=0), np.percentile(local, 99, axis=0)
    hi[1] = np.percentile(local[:, 1], 99.7)  # the roofline is a small share of the splats
    # The floor: while road debris may still be there, the lowest 1%; once it's gone, the tyre
    # bottoms, which are a small share of the splats (floor=0.2).
    lo[1] = np.percentile(local[:, 1], floor)
    s = length / max(1e-6, hi[0] - lo[0])
    mid = (lo + hi) / 2
    shift = np.array([-mid[0], -lo[1], -mid[2]]) * s
    M = np.eye(4)
    M[:3, :3] = s * R
    M[:3, 3] = -s * R @ c + shift
    size = (hi - lo) * s
    return {"matrix": [round(float(v), 6) for v in M.ravel()], "size": [round(float(v), 3) for v in size]}


def ground_haze(v, xyz: np.ndarray, keep: np.ndarray, place: dict) -> np.ndarray:
    """Splats to drop that `keep` still holds: anything below the floor, and low, hazy
    blobs outside the car's footprint (reflections and road texture baked in near the tyres)."""
    M = np.array(place["matrix"]).reshape(4, 4)
    X = xyz @ M[:3, :3].T + M[:3, 3]
    L, H, W = place["size"]
    s = float(np.cbrt(abs(np.linalg.det(M[:3, :3]))))
    scale = np.exp(np.max(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1), axis=1)) * s
    opacity = 1 / (1 + np.exp(-np.asarray(v["opacity"], np.float64)))
    below = X[:, 1] < -0.03
    outside = (np.abs(X[:, 0]) > L / 2 * 1.01) | (np.abs(X[:, 2]) > W / 2 * 1.02)
    haze = (X[:, 1] < 0.12 * H) & outside
    smear = (scale > 0.18) & (opacity < 0.5)
    return keep & (below | haze | smear)


def clean(ply: Path, txt: Path, masks: Path, out: Path, length: float, keep_share: float = 0.6,
          length_known: bool = False, paint: str | None = None) -> dict:
    """Filter the trained splats down to the car and place it. `length` is used as given when
    `length_known` (you entered it); otherwise the camera height sets the scale if it can, and
    `length` (typical for the size class) is the fallback."""
    data = PlyData.read(str(ply))
    v = data["vertex"].data
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64)
    _, views = read_cameras(txt)
    hits, seen = car_votes(xyz, views, masks)
    opacity = 1 / (1 + np.exp(-np.asarray(v["opacity"], np.float64)))
    keep = (seen >= 3) & (hits >= keep_share * np.maximum(seen, 1)) & (opacity > 0.02)
    if keep.sum() < 1000:
        raise RuntimeError("Almost nothing of the 3D model lines up with the car. The video may not circle the car.")
    keep &= ends_on_car(v, xyz, views, masks)
    voted = int(keep.sum())
    body = main_body(xyz[keep], opacity[keep])
    keep[np.flatnonzero(keep)[~body]] = False
    centers = np.array([vw["center"] for vw in views])
    place = placement(xyz[keep], centers, length)
    keep &= ~ground_haze(v, xyz, keep, place)
    keep &= ~road(v, xyz, keep, place)
    place = placement(xyz[keep], centers, length)
    keep &= ~off_the_body(xyz, opacity, keep, place)
    keep &= ~needles(v, keep, place)
    keep &= ~pavement(v, xyz, keep, place)
    place = placement(xyz[keep], centers, length, floor=0.2)
    source = "you" if length_known else "size class"
    if not length_known:
        measured = camera_length(place, centers)
        if measured:
            place, source = rescale(place, measured), "camera"
    kept = v[keep]
    PlyData([PlyElement.describe(kept, "vertex")], text=False).write(str(out))
    try:  # the solid core that stops thin panels being seen through (core.py)
        from . import core

        core.build(out, place["matrix"], place["size"], out.with_name("core.glb"), paint)
        made = True
    except Exception:  # the model still works without it
        made = False
    return {"splats": int(keep.sum()), "removed": int((~keep).sum()), "floaters": voted - int(keep.sum()), "core": made,
            "lengthSource": source, **place}
