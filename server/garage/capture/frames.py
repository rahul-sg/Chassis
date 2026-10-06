"""Frames from the video: the sharpest one in each slice of time, at a size SfM likes."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np


def ffmpeg() -> str:
    # On the PATH, or beside the Python running this (miniforge installs ffmpeg there).
    beside = Path(sys.base_prefix) / "bin" / "ffmpeg"
    path = shutil.which("ffmpeg") or (str(beside) if beside.exists() else None)
    if not path:
        raise RuntimeError("ffmpeg isn’t installed. Install it with miniforge (conda install ffmpeg) and retry.")
    return path


def probe(video: Path) -> dict:
    out = subprocess.run([ffmpeg().replace("ffmpeg", "ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,avg_frame_rate:format=duration", "-of", "json", str(video)],
                         capture_output=True, text=True, check=True)
    d = json.loads(out.stdout)
    s = d["streams"][0]
    num, den = (s.get("avg_frame_rate") or "30/1").split("/")
    return {"width": s["width"], "height": s["height"], "fps": float(num) / max(1.0, float(den)),
            "duration": float(d["format"]["duration"])}


def sharpness(img: np.ndarray) -> float:
    g = cv2.cvtColor(cv2.resize(img, (640, int(640 * img.shape[0] / img.shape[1]))), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def extract(video: Path, out: Path, target: int = 150, long_side: int = 1600, progress=lambda f: None) -> list[Path]:
    """`target` frames spread evenly through the video, each the sharpest of its slice."""
    info = probe(video)
    if info["duration"] < 5:
        raise ValueError("The video is shorter than 5 seconds. Film one or two slow loops around the car (30–60 s).")
    raw = out.parent / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    rate = min(info["fps"], 3 * target / info["duration"])  # three candidates per kept frame
    scale = f"scale='if(gt(iw,ih),{long_side},-2)':'if(gt(iw,ih),-2,{long_side})'"
    subprocess.run([ffmpeg(), "-loglevel", "error", "-y", "-i", str(video), "-vf", f"fps={rate:.4f},{scale}",
                    "-q:v", "2", str(raw / "%05d.jpg")], check=True)
    files = sorted(raw.glob("*.jpg"))
    if not files:
        raise ValueError("No frames could be read from that video.")
    scores = []
    for i, f in enumerate(files):
        scores.append(sharpness(cv2.imread(str(f))))
        progress(0.9 * i / len(files))
    bins = np.array_split(np.arange(len(files)), min(target, len(files)))
    kept = []
    for k, b in enumerate(bins):
        best = b[int(np.argmax([scores[i] for i in b]))]
        dst = out / f"{k:04d}.jpg"
        shutil.copy(files[best], dst)
        kept.append(dst)
    shutil.rmtree(raw)
    progress(1.0)
    return kept
