import numpy as np

from garage.vision.compare import depth_edges


def test_smooth_flow_has_no_depth_edges():
    flow = np.zeros((200, 300, 2), np.float32)
    flow[..., 0] = np.linspace(0, 3, 300)[None, :]  # a gentle change across the picture
    assert not depth_edges(flow).any()


def test_a_jump_in_flow_is_a_depth_edge():
    flow = np.zeros((200, 300, 2), np.float32)
    flow[:, 150:, 0] = 25.0  # something nearer the camera moved much more
    edges = depth_edges(flow)
    assert edges[:, 145:156].any() and not edges[:, :100].any() and not edges[:, 200:].any()
