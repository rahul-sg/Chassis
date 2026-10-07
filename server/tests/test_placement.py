import numpy as np

from garage.capture.clean import placement


def _rotation(axis, angle):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * k + (1 - np.cos(angle)) * k @ k


def test_a_box_comes_out_upright_centred_and_to_scale():
    rng = np.random.default_rng(0)
    L, H, W = 4.0, 1.5, 1.8
    # A car-sized box of points on the floor, and cameras circling it at head height...
    pts = rng.uniform([-L / 2, 0, -W / 2], [L / 2, H, W / 2], size=(20000, 3))
    a = np.linspace(0, 2 * np.pi, 60, endpoint=False)
    cams = np.stack([3.5 * np.cos(a), np.full_like(a, 1.6), 3.0 * np.sin(a)], 1)
    # ...in an arbitrary frame, as structure-from-motion would give it (rotated, moved, scaled).
    R = _rotation([0.3, 1.0, 0.5], 1.1)
    to_sfm = lambda p: (p @ R.T) * 0.37 + np.array([5.0, -2.0, 1.0])  # noqa: E731
    out = placement(to_sfm(pts), to_sfm(cams), length=L)
    M = np.array(out["matrix"]).reshape(4, 4)
    back = to_sfm(pts) @ M[:3, :3].T + M[:3, 3]
    assert np.allclose(out["size"], [L, H, W], rtol=0.04), out["size"]
    lo, hi = np.percentile(back, 1, 0), np.percentile(back, 99, 0)
    assert abs(lo[1]) < 0.05  # sitting on the floor
    assert abs((lo[0] + hi[0]) / 2) < 0.05 and abs((lo[2] + hi[2]) / 2) < 0.05  # centred
    assert hi[0] - lo[0] > hi[2] - lo[2]  # length along x


def test_a_solid_core_sits_inside_a_hollow_shell():
    """A box-shaped shell with no bottom, like a scan that stops at the tyres, gets a solid core
    a little inside it."""
    import tempfile
    from pathlib import Path

    import numpy as np
    import trimesh
    from plyfile import PlyData, PlyElement

    from garage.capture import core

    rng = np.random.default_rng(0)
    L, H, W = 4.0, 1.4, 1.8
    pts = []
    for _ in range(60000):
        p = rng.uniform([-L / 2, 0.2, -W / 2], [L / 2, H, W / 2])
        face = rng.integers(5)  # sides, ends and top; no bottom
        if face == 0: p[0] = -L / 2
        elif face == 1: p[0] = L / 2
        elif face == 2: p[2] = -W / 2
        elif face == 3: p[2] = W / 2
        else: p[1] = H
        pts.append(p)
    pts = np.array(pts)
    fields = [("x", "f4"), ("y", "f4"), ("z", "f4"), ("opacity", "f4"), ("scale_0", "f4"), ("scale_1", "f4"),
              ("scale_2", "f4"), ("rot_0", "f4"), ("rot_1", "f4"), ("rot_2", "f4"), ("rot_3", "f4"),
              ("f_dc_0", "f4"), ("f_dc_1", "f4"), ("f_dc_2", "f4")]
    v = np.zeros(len(pts), dtype=fields)
    v["x"], v["y"], v["z"], v["opacity"] = pts[:, 0], pts[:, 1], pts[:, 2], 3.0
    v["scale_0"] = v["scale_1"] = v["scale_2"] = np.log(0.01)  # 1 cm splats, unrotated
    v["rot_0"] = 1.0
    with tempfile.TemporaryDirectory() as d:
        ply, out = Path(d) / "car.ply", Path(d) / "core.glb"
        PlyData([PlyElement.describe(v, "vertex")]).write(str(ply))
        info = core.build(ply, list(np.eye(4).ravel()), [L, H, W], out)
        mesh = trimesh.load(out, force="mesh")
    lo, hi = mesh.vertices.min(0), mesh.vertices.max(0)
    assert info["volume"] > 0.6 * L * (H - 0.2) * W  # solid, not a thin skin
    assert lo[0] > -L / 2 and hi[0] < L / 2 and hi[1] < H and lo[2] > -W / 2 and hi[2] < W / 2  # inside the shell
    assert mesh.visual.vertex_colors.shape[1] == 4  # coloured from the scan around it
