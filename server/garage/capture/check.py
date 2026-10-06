"""A look at the video before the 20-minute build: is it likely to make a good 3D model?

Runs once the frames are picked and the car is outlined in each (about 30 seconds in). If the
video is portrait, filmed too close, too far or too short, the job pauses and asks whether to
build anyway. Thresholds come from real captures: a portrait walk-around with the car running
off the sides of every frame came out smeared; landscape ones with the car off the sides in
about half the frames (turning the corners) came out well.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

CUT_OFF = 0.75  # share of frames with the car running off the left or right edge
FILLS = 0.65  # median share of the frame the car fills
TINY = 0.06
FOUND = 0.6  # share of frames the car was found in
SHORT = 15  # seconds


def framing(masks: Path) -> dict:
    """How the car sits in the frames: found in how many, how often cut off at the sides, how big."""
    found = cut = 0
    shares = []
    files = sorted(masks.glob("*.jpg"))
    for f in files:
        m = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        if m is None:
            continue
        m = m > 127
        if m.mean() < 0.01:
            continue
        found += 1
        edge = max(2, int(0.01 * m.shape[1]))
        cut += bool(m[:, :edge].any() or m[:, -edge:].any())
        shares.append(float(m.mean()))
    n = max(1, len(files))
    return {"found": found / n, "cutOff": cut / max(1, found), "share": float(np.median(shares)) if shares else 0.0}


def review(info: dict, masks: Path) -> tuple[list[str], dict]:
    """(issues in plain words, the measurements). No issues means build straight away."""
    f = framing(masks)
    issues = []
    if info.get("portrait"):
        issues.append("It’s filmed upright (portrait), so most frames show only part of the car. Hold the phone sideways.")
    if f["found"] < FOUND:
        issues.append(f"The car is only in {f['found']:.0%} of the frames. Keep it in the picture the whole way round.")
    if f["cutOff"] > CUT_OFF:
        issues.append(f"The car runs off the edge of the picture in {f['cutOff']:.0%} of frames. Stand further back, about 2 m (6 ft).")
    elif f["share"] > FILLS:
        issues.append("The car fills almost the whole picture. Stand a little further back.")
    if 0 < f["share"] < TINY:
        issues.append("The car is very small in the picture. Walk round closer, about 2 m (6 ft) away.")
    if info.get("duration", 60) < SHORT:
        issues.append(f"The video is only {info['duration']:.0f} seconds long. Walk round slowly: 30–60 seconds.")
    return issues, f
