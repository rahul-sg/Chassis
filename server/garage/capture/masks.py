"""Car outlines for every frame (white = car), and whether the camera or the car moved."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def car_masks(frames: list[Path], out: Path, progress=lambda f: None) -> dict:
    """Writes out/<frame name> (same name as the frame, so tools can pair them).
    Returns coverage stats; frames without a car get an empty mask."""
    from ..vision.models import DEVICE, gpu, yolo_seg

    out.mkdir(parents=True, exist_ok=True)
    found, areas = 0, []
    for i, f in enumerate(frames):
        img = cv2.imread(str(f))
        with gpu:
            r = yolo_seg().predict(img, classes=[2, 7], conf=0.25, imgsz=960, device=DEVICE, retina_masks=True, verbose=False)[0]
        mask = np.zeros(img.shape[:2], np.uint8)
        if r.boxes is not None and len(r.boxes):
            boxes = r.boxes.xyxy.cpu().numpy()
            j = int(((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])).argmax())
            m = r.masks.data[j].cpu().numpy() > 0.5
            mask[m] = 255
            # A little margin so tyres, mirrors and antennas aren't clipped.
            mask = cv2.dilate(mask, np.ones((15, 15), np.uint8))
            found += 1
            areas.append(float(m.mean()))
        cv2.imwrite(str(out / f.name), mask, [cv2.IMWRITE_JPEG_QUALITY, 100])
        progress((i + 1) / len(frames))
    return {"frames": len(frames), "withCar": found, "meanArea": round(float(np.mean(areas)) if areas else 0.0, 3)}


def turntable(frames: list[Path], masks: Path, samples: int = 12) -> bool:
    """True when the background barely moves between frames while the car does: a car on a
    turntable filmed from a fixed spot. Then only the car can be used to work out the views."""
    idx = np.linspace(0, len(frames) - 2, min(samples, len(frames) - 1)).astype(int)
    bg, car = [], []
    for i in idx:
        a = cv2.cvtColor(cv2.imread(str(frames[i])), cv2.COLOR_BGR2GRAY).astype(float)
        b = cv2.cvtColor(cv2.imread(str(frames[i + 1])), cv2.COLOR_BGR2GRAY).astype(float)
        m = cv2.imread(str(masks / frames[i].name), cv2.IMREAD_GRAYSCALE) > 127
        d = np.abs(a - b)
        if (~m).sum() > 1000:
            bg.append(np.median(d[~m]))
        if m.sum() > 1000:
            car.append(np.median(d[m]))
    return bool(bg and car and np.median(bg) < 4 and np.median(car) > 2 * np.median(bg))
