"""A solid core for a scanned car, so it can't be seen through.

Gaussian splats struggle with glossy paint: the trainer models reflections as faint splats, so
some panels come out thin, and whatever is behind them shows through (the far side's wheel
through a door, the room behind the car). The core is an opaque shape inside the body, drawn in a
deep shade of the paint: through a thin panel you see deeper paint, through the windows a dark
cabin, and splats on the far side are hidden behind it as they should be.

Below the window line the core is the car's own paint in shade (measured from the scan's side
panels), above it the near-black of a cabin: through a thin door you see paint, through the
windows a dark cabin, so where the core shows it reads as part of the car.

The scan is a shell with a lot missing (no underside, little of the cabin, and thin glossy panels
are exactly where splats are sparse), so the inside can't simply be filled. Instead:

- every confident splat counts by its extent, not just its centre (splats on paint are flat
  discs several centimetres across), and the car is mirrored side to side: a car is the same shape
  on both sides, so a well-scanned side stands in for a thin one;
- the body is the space inside its outline seen from the side and from the front, and narrower
  than its measured half-width at each point along the length, height band by height band (a
  car's sides lean in as they rise; the 90th percentile keeps door mirrors from widening it);
- nothing goes above the scan's top surface at any spot seen from above (so a pickup's open bed
  stays open) or inside the wheels (so wheels show as scanned, even inboard of wide fenders);
- that shape is pulled in by 10 cm so it never shows through the paint, kept inside the measured
  car, meshed and smoothed (so no blocky edge shows through thin paint), and coloured: paint
  below the window line, a dark cabin above it.

The mesh is saved in the splat file's own coordinates, so the viewer places it with the same
transform as the splat (and it stays right if the transform is rescaled later).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

CELL = 0.035  # m
BAND = 0.25  # m: height bands for the body's width
INSET = 3  # cells: how far inside the body the core sits (about 10 cm)
TYRE = 0.72  # m: a typical tyre's diameter


def _extent_points(v, thr: float = 0.2) -> np.ndarray:
    """Confident splats as their centres plus the ends of their three axes (1 sigma)."""
    from scipy.spatial.transform import Rotation

    opacity = 1 / (1 + np.exp(-np.asarray(v["opacity"], np.float64)))
    k = opacity > thr
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64)[k]
    scale = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1).astype(np.float64)[k])
    quat = np.stack([v["rot_1"], v["rot_2"], v["rot_3"], v["rot_0"]], 1).astype(np.float64)[k]  # x, y, z, w
    axes = Rotation.from_quat(quat / np.linalg.norm(quat, axis=1, keepdims=True)).as_matrix() * scale[:, None, :]
    return np.concatenate([xyz] + [xyz + s * axes[:, :, a] for a in range(3) for s in (-1, 1)])


def _half_widths(points: np.ndarray, lo: np.ndarray, nx: int, bands: int) -> np.ndarray:
    """The body's half-width (cells) at each slice along the length, per height band."""
    from scipy import ndimage

    xi = np.floor((points[:, 0] - lo[0]) / CELL).astype(int)
    bi = np.clip((points[:, 1] / BAND).astype(int), 0, bands - 1)
    hz = np.abs(points[:, 2]) / CELL
    hw = np.full((nx, bands), np.nan)
    for b in range(bands):
        sel = bi == b
        order = np.argsort(xi[sel])
        xs, zs = xi[sel][order], hz[sel][order]
        cuts = np.flatnonzero(np.diff(xs)) + 1
        for x_group, z_group in zip(np.split(xs, cuts), np.split(zs, cuts)):
            if len(z_group) >= 8:
                hw[x_group[0], b] = np.percentile(z_group, 90)
        col = hw[:, b]
        ok = np.flatnonzero(~np.isnan(col))
        if len(ok):
            hw[:, b] = ndimage.median_filter(np.interp(np.arange(nx), ok, col[ok]), size=5, mode="nearest")
        else:
            hw[:, b] = 0
    return hw


BELT = 0.64  # the window line, as a share of the car's height


def _wheels(points: np.ndarray, x0: float, nx: int) -> list[tuple[float, float]]:
    """Where the wheels are along the length: the car's lowest point dips well below the sills there
    (the scan's tyres don't always reach the floor, but they reach far lower than the body). Each is
    taken as a tyre's width around the middle of its dip."""
    from scipy import ndimage

    xi = np.floor((points[:, 0] - x0) / CELL).astype(int)
    order = np.argsort(xi)
    xs, ys = xi[order], points[order, 1]
    cuts = np.flatnonzero(np.diff(xs)) + 1
    low = np.full(nx, np.nan)
    for x_group, y_group in zip(np.split(xs, cuts), np.split(ys, cuts)):
        if len(y_group) >= 20:
            low[x_group[0]] = np.percentile(y_group, 2)
    if np.isnan(low).all():
        return []
    sill = np.nanmedian(low)
    low = ndimage.median_filter(np.nan_to_num(low, nan=sill), size=3, mode="nearest")
    dips, _ = ndimage.label(ndimage.binary_closing(low < sill - 0.1, iterations=3))
    runs = [r for (r,) in ndimage.find_objects(dips) if (r.stop - r.start) * CELL >= 0.15]
    # The middle of each dip, deeper parts counting more: a step or mud flap at one end of a dip
    # doesn't pull the wheel off its tyre.
    depth = np.clip(sill - 0.1 - low, 0, None)
    centres = [x0 + (np.average(np.arange(r.start, r.stop), weights=depth[r] + 1e-6) + 0.5) * CELL for r in runs]
    return [(c - TYRE / 2, c + TYRE / 2) for c in centres]


def _colours(v, M: np.ndarray, at: np.ndarray, size: list[float], paint_hex: str | None) -> np.ndarray:
    """RGBA (0–255, linear as glTF wants) for each point of the core: the car's paint, a shade darker,
    below the window line, the near-black of a cabin above it, blended over a few centimetres.
    The paint is the colour read from the car's photo; failing that, the scan's side panels (darker
    than the real paint: on glossy panels the most solid splats are reflections)."""
    length, height, width = size
    opacity = 1 / (1 + np.exp(-np.asarray(v["opacity"], np.float64)))
    centres = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    srgb = np.clip(0.5 + 0.28209479 * np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], 1).astype(np.float64), 0, 1)
    sides = (opacity > 0.3) & (centres[:, 1] > 0.3 * height) & (centres[:, 1] < 0.55 * height) & (np.abs(centres[:, 2]) > 0.35 * width)
    if paint_hex:
        paint = np.array([int(paint_hex.lstrip("#")[i: i + 2], 16) for i in (0, 2, 4)]) / 255 * 0.8
    elif sides.sum() > 50:
        paint = np.median(srgb[sides], axis=0) * 0.85
    else:
        paint = np.array([0.12, 0.12, 0.13])
    cabin = np.array([0.06, 0.06, 0.07])
    t = np.clip((at[:, 1] - (BELT * height - 0.06)) / 0.12, 0, 1)[:, None]
    t = t * t * (3 - 2 * t)
    linear = ((1 - t) * paint + t * cabin) ** 2.2
    return np.concatenate([np.round(linear * 255), np.full((len(at), 1), 255)], 1).astype(np.uint8)


def build(ply: Path, matrix: list[float], size: list[float], out: Path, paint: str | None = None) -> dict:
    """`matrix` places the splat in metres (row-major 4×4); `size` is the car's length, height and
    width from that placement, which the core is kept inside; `paint` is the car's colour (#rrggbb)."""
    from plyfile import PlyData
    from scipy import ndimage
    from skimage import measure
    import trimesh

    v = PlyData.read(str(ply))["vertex"].data
    M = np.array(matrix, np.float64).reshape(4, 4)
    car = _extent_points(v) @ M[:3, :3].T + M[:3, 3]  # metres, car frame: length along x, y up
    length, height, width = size
    car = car[(np.abs(car[:, 0]) < length / 2) & (car[:, 1] > -0.02) & (car[:, 1] < height) & (np.abs(car[:, 2]) < width / 2)]
    car = np.concatenate([car, car * [1, 1, -1]])  # the same shape on both sides

    lo = np.array([-length / 2, -0.02, -width / 2]) - 2 * CELL
    shape = tuple(np.floor((np.array([length / 2, height, width / 2]) - lo) / CELL).astype(int) + 3)
    idx = np.floor((car - lo) / CELL).astype(int)
    grid = np.zeros(shape, bool)
    grid[tuple(idx.T)] = True
    shell = ndimage.binary_closing(grid, iterations=2)
    side = ndimage.binary_fill_holes(shell.any(axis=2))  # x, y
    front = ndimage.binary_fill_holes(shell.any(axis=0))  # y, z
    # The scan's lower outline is ragged along the sills, and where the paint above is thin a ragged
    # core edge would show through it, so the bottom of the side outline is evened out along the length.
    rows = np.arange(side.shape[1])[None, :]
    bottom = np.where(side.any(axis=1), np.argmax(side, axis=1), side.shape[1])
    bottom = ndimage.median_filter(bottom, size=15, mode="nearest")
    side &= rows >= bottom[:, None]
    wheels = _wheels(car, lo[0], shape[0])

    bands = int(np.ceil(height / BAND))
    hw = _half_widths(car, lo, shape[0], bands)
    centre = lo + (np.indices(shape).transpose(1, 2, 3, 0) + 0.5) * CELL
    band = np.clip((centre[..., 1] / BAND).astype(int), 0, bands - 1)
    narrow = np.abs(centre[..., 2]) / CELL <= hw[np.arange(shape[0])[:, None, None], band]

    body = side[:, :, None] & front[None, :, :] & narrow
    # Nothing above the scan's top surface at each spot seen from above: on a closed car that's the
    # roof, bonnet and boot lid, but a pickup's bed is open, and its top surface is the bed floor.
    has_top = shell.any(axis=1)
    top = np.where(has_top, shell.shape[1] - 1 - np.argmax(shell[:, ::-1, :], axis=1), -1)
    top = ndimage.maximum_filter(top, size=3)  # bridge small gaps in a thin roof
    body &= np.arange(shape[1])[None, :, None] <= top[:, None, :]
    # No core inside the wheels: tyres sit inboard of wide fenders, and through the spokes you should
    # see what the scan shows.
    tyre_top = min(0.85, 0.5 * height) + INSET * CELL
    outer = np.abs(centre[..., 2]) > width / 2 - 0.5  # the tyres, even well inboard of wide fenders
    for x0, x1 in wheels:
        body &= ~((centre[..., 0] > x0) & (centre[..., 0] < x1) & (centre[..., 1] < tyre_top) & outer)
    solid = ndimage.binary_erosion(body, iterations=INSET)
    labels, n = ndimage.label(solid)
    if n == 0:
        raise ValueError("No solid shape found in the model.")
    sizes = ndimage.sum(solid, labels, range(1, n + 1))
    solid = labels == (int(np.argmax(sizes)) + 1)

    verts, faces, _, _ = measure.marching_cubes(np.pad(solid, 1).astype(np.float32), 0.5)
    mesh = trimesh.Trimesh(lo + (verts - 1 + 0.5) * CELL, faces[:, ::-1], process=True)
    trimesh.smoothing.filter_taubin(mesh, iterations=12)
    mesh.visual.vertex_colors = _colours(v, M, mesh.vertices, size, paint)
    mesh.vertices = (mesh.vertices - M[:3, 3]) @ np.linalg.inv(M[:3, :3]).T  # back to the splat's own coordinates
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(out, file_type="glb")
    return {"faces": int(len(mesh.faces)), "volume": round(float(solid.sum()) * CELL**3, 2),
            "wheels": [[round(a, 2), round(b, 2)] for a, b in wheels]}
