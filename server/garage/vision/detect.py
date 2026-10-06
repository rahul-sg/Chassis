"""Find the main car in a photo: the biggest car or truck, with its outline."""
from __future__ import annotations

import numpy as np
from PIL import Image

from .models import DEVICE, gpu, yolo_seg

VEHICLES = {2: "car", 7: "truck", 5: "bus", 3: "motorcycle"}


def find_car(img: Image.Image) -> dict | None:
    """{box: [x0,y0,x1,y1], mask: bool HxW, kind, score} for the largest vehicle, or None."""
    rgb = np.asarray(img.convert("RGB"))
    with gpu:
        res = yolo_seg().predict(rgb[:, :, ::-1], classes=list(VEHICLES), conf=0.3, imgsz=960, device=DEVICE,
                                 retina_masks=True, verbose=False)[0]
    if res.boxes is None or len(res.boxes) == 0:
        return None
    boxes = res.boxes.xyxy.cpu().numpy()
    area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    i = int(area.argmax())
    mask = res.masks.data[i].cpu().numpy() > 0.5 if res.masks is not None else None
    return {
        "box": [round(float(v), 1) for v in boxes[i]],
        "mask": mask,
        "kind": VEHICLES[int(res.boxes.cls[i])],
        "score": round(float(res.boxes.conf[i]), 3),
        "share": round(float(area[i] / (rgb.shape[0] * rgb.shape[1])), 3),
    }


def crop(img: Image.Image, box, pad: float = 0.08) -> Image.Image:
    """The box plus a margin, squared up so the classifier sees the whole car."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    side = max(w, h) * (1 + 2 * pad)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left, top = max(0, cx - side / 2), max(0, cy - side / 2)
    right, bottom = min(img.width, cx + side / 2), min(img.height, cy + side / 2)
    return img.crop((int(left), int(top), int(right), int(bottom)))
