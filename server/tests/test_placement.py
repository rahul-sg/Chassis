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
