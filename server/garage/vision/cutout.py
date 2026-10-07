"""Car cut-outs for studio photos.

BiRefNet (MIT licence, the "lite" version: 44M parameters) separates the car from everything
around it, including the gaps between parts and under the body. Only the pieces lying mostly
inside the box YOLO found for the car are kept, so people and other cars in the photo stay
out. If BiRefNet can't be loaded, YOLO's own outline is used, feathered, which is rougher at
the edges.
"""
from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np
import torch
from PIL import Image

from .models import DEVICE, gpu

REPO = "ZhengPeng7/BiRefNet_lite"
REVISION = "aa62cd87eafb9cc43056d08ef3615a14628b831d"  # pinned: the repo ships model code that runs locally
SIZE = 1024
MEAN = torch.tensor([0.485, 0.456, 0.406])[:, None, None]
STD = torch.tensor([0.229, 0.224, 0.225])[:, None, None]


@lru_cache(maxsize=1)
def birefnet():
    try:
        from transformers import AutoModelForImageSegmentation

        with gpu:  # see models.py: nothing may run while transformers is loading
            model = AutoModelForImageSegmentation.from_pretrained(REPO, revision=REVISION, trust_remote_code=True)
            return model.to(DEVICE).eval().half()
    except Exception:  # offline on first use, or a library mismatch: fall back to YOLO outlines
        return None


def _birefnet_alpha(img: Image.Image) -> np.ndarray | None:
    model = birefnet()
    if model is None:
        return None
    x = torch.from_numpy(np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR), np.float32) / 255).permute(2, 0, 1)
    x = ((x - MEAN) / STD)[None].to(DEVICE).half()
    with gpu, torch.no_grad():
        pred = model(x)[-1].sigmoid().float().cpu()[0, 0].numpy()
    return cv2.resize(pred, img.size, interpolation=cv2.INTER_LINEAR)


def cutout(img: Image.Image) -> dict | None:
    """{rgba, box, clipped, method}, or None when there's no car in the photo.
    clipped lists the sides where the car runs off the photo."""
    from .detect import find_car

    img = img.convert("RGB")
    car = find_car(img)
    if car is None:
        return None
    w, h = img.size
    x0, y0, x1, y1 = car["box"]
    pad_x, pad_y = 0.04 * (x1 - x0), 0.04 * (y1 - y0)
    box = np.zeros((h, w), bool)
    box[int(max(0, y0 - pad_y)):int(min(h, y1 + pad_y)), int(max(0, x0 - pad_x)):int(min(w, x1 + pad_x))] = True

    alpha = _birefnet_alpha(img)
    method = "birefnet"
    if alpha is None:
        mask = car["mask"].astype(np.uint8)
        if mask.shape != (h, w):
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        alpha = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 2.0)
        method = "outline"
    # Keep what belongs to this car: the pieces that lie mostly inside YOLO's box. Whole pieces,
    # not cut at the box: YOLO's box sometimes stops short of a bumper or a nose.
    solid = (alpha > 0.5).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    inside = np.bincount(labels[box], minlength=n)
    keep = [i for i in range(1, n) if inside[i] >= 0.3 * stats[i, cv2.CC_STAT_AREA]]
    if not keep:
        return None
    main = np.isin(labels, keep).astype(np.uint8)
    # Soft edges stay soft: everything within a few pixels of the kept pieces keeps its alpha.
    alpha = np.clip(alpha, 0, 1) * (cv2.dilate(main, np.ones((7, 7), np.uint8)) > 0)

    ys, xs = np.nonzero(alpha > 0.5)
    if len(xs) == 0:
        return None
    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    edge = 3
    clipped = [side for side, hit in (("left", bx0 <= edge), ("right", bx1 >= w - edge), ("top", by0 <= edge),
                                      ("bottom", by1 >= h - edge)) if hit]
    rgba = img.copy()
    rgba.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
    return {"rgba": rgba, "box": [bx0, by0, bx1, by1], "clipped": clipped, "method": method}
