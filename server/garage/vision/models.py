"""Model loading. Each model loads once, on first use, and is shared behind a lock
(the Apple GPU backend isn't safe to call from several threads at once).

Loading happens behind the same lock as running. Requests arrive on several threads, and
transformers loads a model (BiRefNet) with a process-wide switch that makes new layers empty
"meta" tensors: a YOLO model running for the first time at that moment (when Ultralytics fuses
its layers into new ones) would get empty layers and fail with "Cannot copy out of meta tensor".
It's reentrant so a model can be loaded from inside a `with gpu:` block."""
from __future__ import annotations

import os
import threading
from functools import lru_cache

import torch

from ..paths import TOOLS

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
gpu = threading.RLock()

# Image–text model for identification; GARAGE_SIGLIP="name,pretrained" overrides it (used by the evaluation).
SIGLIP = tuple(os.environ.get("GARAGE_SIGLIP", "ViT-SO400M-14-SigLIP-384,webli").split(","))


@lru_cache(maxsize=1)
def yolo_seg():
    from ultralytics import YOLO
    from ultralytics.utils.downloads import attempt_download_asset

    path = TOOLS / "yolo11m-seg.pt"
    with gpu:
        if not path.exists():
            attempt_download_asset(str(path))
        return YOLO(str(path))


@lru_cache(maxsize=1)
def siglip():
    import open_clip

    with gpu:
        model, _, preprocess = open_clip.create_model_and_transforms(SIGLIP[0], pretrained=SIGLIP[1], device=DEVICE)
    model.eval()
    if DEVICE == "mps":
        model = model.half()
    return model, preprocess, open_clip.get_tokenizer(SIGLIP[0])


@lru_cache(maxsize=1)
def ocr():
    import easyocr

    with gpu:
        return easyocr.Reader(["en"], gpu=DEVICE != "cpu", verbose=False)
