"""Where was the camera for each frame? COLMAP (pycolmap) structure-from-motion.

Runs as its own process (python -m garage.capture.sfm WORK [--masked]) because pycolmap
and PyTorch each ship an OpenMP runtime and can't share one.

Pairs to match: each frame with its next neighbours (the path), every few frames with each
other (so the end of the loop finds the start), then incremental mapping. The result is
undistorted to pinhole cameras for the splat trainer, with the car masks undistorted the
same way. With --masked only features on the car are used: right for a car on a
turntable, where the background stands still while the car turns.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


def pairs(names: list[str], overlap: int = 10, key_every: int = 5) -> list[tuple[str, str]]:
    out = set()
    n = len(names)
    for i in range(n):
        for j in range(i + 1, min(n, i + overlap + 1)):
            out.add((names[i], names[j]))
    keys = list(range(0, n, key_every))
    for a in range(len(keys)):
        for b in range(a + 1, len(keys)):
            out.add((names[keys[a]], names[keys[b]]))
    return sorted(out)


def run(work: Path, masked: bool, per_frame_lens: bool = False) -> dict:
    """per_frame_lens: estimate the lens for every frame (videos that zoom); otherwise one
    lens for all (phone walk-arounds, the usual case: more stable)."""
    import pycolmap

    frames = work / "frames"
    names = sorted(p.name for p in frames.glob("*.jpg"))
    db = work / "colmap.db"
    db.unlink(missing_ok=True)

    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = "SIMPLE_RADIAL" if per_frame_lens else "OPENCV"
    if masked:
        # COLMAP's convention: the mask for 0001.jpg is 0001.jpg.png, black = ignore.
        cm = work / "colmap_masks"
        cm.mkdir(exist_ok=True)
        for n in names:
            shutil.copy(work / "masks" / n, cm / f"{n}.png")
        reader.mask_path = str(cm)
    extraction = pycolmap.FeatureExtractionOptions()
    extraction.max_image_size = 1600
    extraction.sift.max_num_features = 6000
    mode = pycolmap.CameraMode.PER_IMAGE if per_frame_lens else pycolmap.CameraMode.SINGLE
    pycolmap.extract_features(db, frames, camera_mode=mode, reader_options=reader,
                              extraction_options=extraction, device=pycolmap.Device.cpu)

    pair_file = work / "pairs.txt"
    pair_file.write_text("\n".join(f"{a} {b}" for a, b in pairs(names)))
    pairing = pycolmap.ImportedPairingOptions()
    pairing.match_list_path = str(pair_file)
    pycolmap.match_image_pairs(db, pairing_options=pairing, device=pycolmap.Device.cpu)

    sparse = work / "sparse"
    shutil.rmtree(sparse, ignore_errors=True)
    sparse.mkdir()
    opts = pycolmap.IncrementalPipelineOptions()
    opts.multiple_models = False
    # Video frames are close together: let mapping start from a narrower pair of views.
    opts.mapper.init_min_tri_angle = 8
    models = pycolmap.incremental_mapping(db, frames, sparse, opts)
    if not models:
        return {"ok": False, "registered": 0, "total": len(names)}
    rec = max(models.values(), key=lambda r: r.num_reg_images())
    best = sparse / "best"
    best.mkdir(exist_ok=True)
    rec.write(best)
    rec.write_text(best)

    dataset = work / "dataset"
    shutil.rmtree(dataset, ignore_errors=True)
    pycolmap.undistort_images(dataset, best, frames)
    tmp = work / "undistorted_masks"
    shutil.rmtree(tmp, ignore_errors=True)
    pycolmap.undistort_images(tmp, best, work / "masks")
    shutil.move(str(tmp / "images"), str(dataset / "masks"))
    shutil.rmtree(tmp, ignore_errors=True)
    # Brush reads <dataset>/sparse/0; the clean-up step reads the text copy.
    (dataset / "sparse" / "0").mkdir(parents=True, exist_ok=True)
    for f in (dataset / "sparse").glob("*.bin"):
        shutil.move(str(f), str(dataset / "sparse" / "0" / f.name))
    txt = dataset / "sparse" / "txt"
    txt.mkdir(exist_ok=True)
    pycolmap.Reconstruction(dataset / "sparse" / "0").write_text(txt)
    return {
        "ok": True,
        "registered": rec.num_reg_images(),
        "total": len(names),
        "points": rec.num_points3D(),
        "reprojection": round(rec.compute_mean_reprojection_error(), 3),
        "masked": masked,
        "perFrameLens": per_frame_lens,
    }


if __name__ == "__main__":
    work = Path(sys.argv[1])
    result = run(work, "--masked" in sys.argv, "--per-frame-lens" in sys.argv)
    (work / "sfm.json").write_text(json.dumps(result))
    print(json.dumps(result))
