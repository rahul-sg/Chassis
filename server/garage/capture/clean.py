"""Keep only the car, and work out how to stand it upright at real size.

Every splat's centre is projected into a spread of the frames; it stays if it lands on
the car in most of the frames that see it (the car outlines vote). The splat file itself is
only filtered, never moved: the viewer applies one transform (centre, turn upright,
scale to metres), so view-dependent colour stays correct.
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


def car_votes(xyz: np.ndarray, views: list[dict], masks: Path, n_views: int = 30) -> tuple[np.ndarray, np.ndarray]:
    """(hits, seen): in how many of the sampled frames each point lands on the car / in frame."""
    hits = np.zeros(len(xyz), np.int32)
    seen = np.zeros(len(xyz), np.int32)
    for v in [views[i] for i in np.linspace(0, len(views) - 1, min(n_views, len(views))).astype(int)]:
        m = cv2.imread(str(masks / v["name"]), cv2.IMREAD_GRAYSCALE)
        if m is None:
            continue
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


def placement(xyz: np.ndarray, centers: np.ndarray, length: float) -> dict:
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


def clean(ply: Path, txt: Path, masks: Path, out: Path, length: float, keep_share: float = 0.6) -> dict:
    data = PlyData.read(str(ply))
    v = data["vertex"].data
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64)
    _, views = read_cameras(txt)
    hits, seen = car_votes(xyz, views, masks)
    opacity = 1 / (1 + np.exp(-np.asarray(v["opacity"], np.float64)))
    keep = (seen >= 3) & (hits >= keep_share * np.maximum(seen, 1)) & (opacity > 0.02)
    if keep.sum() < 1000:
        raise RuntimeError("Almost nothing of the 3D model lines up with the car. The video may not circle the car.")
    voted = int(keep.sum())
    body = main_body(xyz[keep], opacity[keep])
    keep[np.flatnonzero(keep)[~body]] = False
    centers = np.array([vw["center"] for vw in views])
    place = placement(xyz[keep], centers, length)
    keep &= ~ground_haze(v, xyz, keep, place)
    place = placement(xyz[keep], centers, length)
    kept = v[keep]
    PlyData([PlyElement.describe(kept, "vertex")], text=False).write(str(out))
    return {"splats": int(keep.sum()), "removed": int((~keep).sum()), "floaters": voted - int(keep.sum()), **place}
