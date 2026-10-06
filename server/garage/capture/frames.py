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
                          "stream=width,height,avg_frame_rate,color_transfer:stream_side_data=rotation:format=duration",
                          "-of", "json", str(video)],
                         capture_output=True, text=True, check=True)
    d = json.loads(out.stdout)
    s = d["streams"][0]
    num, den = (s.get("avg_frame_rate") or "30/1").split("/")
    rotation = next((int(x["rotation"]) for x in s.get("side_data_list") or [] if "rotation" in x), 0)
    w, h = (s["height"], s["width"]) if abs(rotation) % 180 == 90 else (s["width"], s["height"])
    return {"width": w, "height": h, "fps": float(num) / max(1.0, float(den)), "duration": float(d["format"]["duration"]),
            "transfer": s.get("color_transfer"), "portrait": h > w}


HLG, PQ = "arib-std-b67", "smpte2084"
BT2020_TO_709 = np.array([[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]], np.float32)


def hdr_to_sdr(x: np.ndarray, transfer: str) -> np.ndarray:
    """An HDR frame (BT.2020, HLG or PQ, values 0–1) as an everyday sRGB image (uint8).

    Phones film HDR by default; read naively, those frames come out flat and dull (an orange car
    turns brown). Here the curve is undone to real light levels, HDR's reference white (203 nits)
    becomes SDR white, colours move from BT.2020 to sRGB's primaries, and brighter highlights
    ease into white instead of clipping."""
    if transfer == HLG:
        a, b, c = 0.17883277, 0.28466892, 0.55991073
        scene = np.where(x <= 0.5, x * x / 3, (np.exp((x - c) / a) + b) / 12)
        ys = scene @ np.array([0.2627, 0.6780, 0.0593], np.float32)
        nits = 1000 * np.power(np.maximum(ys, 1e-6), 0.2)[..., None] * scene  # HLG system gamma 1.2 at 1000 nits
    else:  # PQ
        m1, m2, c1, c2, c3 = 0.1593017578125, 78.84375, 0.8359375, 18.8515625, 18.6875
        p = np.power(np.clip(x, 0, 1), 1 / m2)
        nits = 10000 * np.power(np.maximum(p - c1, 0) / (c2 - c3 * p), 1 / m1)
    lin = np.clip((nits / 203.0) @ BT2020_TO_709.T, 0, None)
    y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # Everything up to 80% of white stays as it is; brighter light eases into white (as in BT.2408).
    knee = 0.8
    toned = np.where(y <= knee, y, knee + (1 - knee) * (1 - np.exp(-(y - knee) / (1 - knee))))
    lin = np.clip(lin * (toned / np.maximum(y, 1e-6))[..., None], 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return (srgb * 255 + 0.5).astype(np.uint8)


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
    best = [int(b[int(np.argmax([scores[i] for i in b]))]) for b in bins]
    kept = [out / f"{k:04d}.jpg" for k in range(len(best))]
    if info["transfer"] in (HLG, PQ):
        # The sharpest frames are read again at full depth and converted properly (see hdr_to_sdr).
        h, w = cv2.imread(str(files[0])).shape[:2]
        pick = "+".join(f"eq(n\\,{i})" for i in best)
        proc = subprocess.Popen([ffmpeg(), "-loglevel", "error", "-i", str(video), "-vf",
                                 f"fps={rate:.4f},{scale},select='{pick}'", "-fps_mode", "passthrough",
                                 "-f", "rawvideo", "-pix_fmt", "rgb48le", "pipe:1"], stdout=subprocess.PIPE)
        n = 0
        for dst in kept:
            buf = proc.stdout.read(w * h * 6)
            if len(buf) < w * h * 6:
                break
            frame = np.frombuffer(buf, np.uint16).reshape(h, w, 3).astype(np.float32) / 65535
            cv2.imwrite(str(dst), cv2.cvtColor(hdr_to_sdr(frame, info["transfer"]), cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            n += 1
        proc.wait()
        if n < len(kept):  # an odd video: fall back to the plain frames for the rest
            for i, dst in list(zip(best, kept))[n:]:
                shutil.copy(files[i], dst)
    else:
        for i, dst in zip(best, kept):
            shutil.copy(files[i], dst)
    shutil.rmtree(raw)
    progress(1.0)
    return kept
