"""Stand-in for torchmcubes (a CUDA-oriented C++ extension TripoSR imports): the same
marching_cubes(volume, threshold) -> (vertices, faces), done by scikit-image on the CPU.
torchmcubes lists vertex coordinates last axis first, so they're reversed to match."""
import numpy as np
import torch
from skimage.measure import marching_cubes as _marching_cubes


def marching_cubes(volume: torch.Tensor, threshold: float):
    verts, faces, _, _ = _marching_cubes(volume.detach().cpu().numpy(), threshold)
    return torch.from_numpy(np.ascontiguousarray(verts[:, ::-1])).float(), torch.from_numpy(faces.astype(np.int64))
