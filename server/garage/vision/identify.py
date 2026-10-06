"""Identify make, model and model years from a photo of a car.

SigLIP embeds the photo and a short text for every make and model family in the EPA
database ("a photo of a Honda Civic."); the closest texts are the candidates. For the
leading candidates, each model year gets its own text ("a photo of a 2017 Honda Civic.")
and the best-scoring years become the range shown. Text embeddings are cached on disk.
"""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache

import numpy as np
import torch
from PIL import Image

from ..paths import CACHE
from ..specs import epa
from .models import DEVICE, SIGLIP, gpu, siglip

TEMPLATES = ["a photo of a {make} {model}.", "a photo of a {make} {model}, a type of car."]
# Softmax temperatures, set so the shown confidence roughly matches how often it's right
# (see tools/eval_identify.py).
T_FAMILY = 1.0
T_YEAR = 1.0
YEAR_MASS = 0.9     # a year range covers at least this much of the year probability…
YEAR_SPAN = 5       # …but never more than this many years (86% of ranges hold the true year on held-out photos)


def _norm(x: torch.Tensor) -> torch.Tensor:
    return x / x.norm(dim=-1, keepdim=True)


def encode_text(texts: list[str]) -> torch.Tensor:
    model, _, tok = siglip()
    out = []
    with gpu, torch.no_grad():
        for i in range(0, len(texts), 256):
            t = tok(texts[i:i + 256]).to(DEVICE)
            out.append(_norm(model.encode_text(t).float()).cpu())
    return torch.cat(out)


def encode_image(img: Image.Image) -> torch.Tensor:
    model, preprocess, _ = siglip()
    x = preprocess(img.convert("RGB")).unsqueeze(0).to(DEVICE)
    if DEVICE == "mps":
        x = x.half()
    with gpu, torch.no_grad():
        return _norm(model.encode_image(x).float()).cpu()[0]


@lru_cache(maxsize=1)
def family_index() -> tuple[list[dict], torch.Tensor]:
    fams = epa.families()
    key = hashlib.md5(json.dumps([SIGLIP, TEMPLATES, [(f["make"], f["model"]) for f in fams]]).encode()).hexdigest()[:12]
    path = CACHE / f"families-{key}.pt"
    if path.exists():
        return fams, torch.load(path)
    per = [encode_text([t.format(make=f["make"], model=f["model"]) for f in fams]) for t in TEMPLATES]
    emb = _norm(torch.stack(per).mean(0))
    torch.save(emb, path)
    return fams, emb


def _scale() -> tuple[float, float]:
    model, _, _ = siglip()
    return float(model.logit_scale.exp()), float(getattr(model, "logit_bias", torch.tensor(0.0)))


def year_range(img_emb: torch.Tensor, fam: dict) -> tuple[int, int, int, list[float]]:
    """(from, to, most likely, per-year probabilities) for one family."""
    years = epa.years(fam["make"], fam["model"])
    if len(years) == 1:
        return years[0], years[0], years[0], [1.0]
    texts = [f"a photo of a {y} {fam['make']} {fam['model']}." for y in years]
    scale, _ = _scale()
    p = torch.softmax(scale * (encode_text(texts) @ img_emb) / T_YEAR, 0).numpy()
    best = int(p.argmax())
    lo = hi = best
    while p[lo:hi + 1].sum() < YEAR_MASS and hi - lo + 1 < YEAR_SPAN:
        left = p[lo - 1] if lo > 0 else -1
        right = p[hi + 1] if hi < len(p) - 1 else -1
        if left < 0 and right < 0:
            break
        if left >= right:
            lo -= 1
        else:
            hi += 1
    return years[lo], years[hi], years[best], [round(float(v), 4) for v in p]


def identify(img: Image.Image, k: int = 5, with_years: int = 3, details: bool = False) -> list[dict]:
    """Top-k families with confidence; the first `with_years` also get a year range.
    `details` adds the per-year probabilities (for tuning the year range)."""
    fams, emb = family_index()
    e = encode_image(img)
    scale, _ = _scale()
    probs = torch.softmax(scale * (emb @ e) / T_FAMILY, 0).numpy()
    top = np.argsort(-probs)[:k]
    out = []
    for rank, i in enumerate(top):
        f = fams[int(i)]
        c = {"make": f["make"], "model": f["model"], "confidence": round(float(probs[i]), 4),
             "yearFrom": f["yearFrom"], "yearTo": f["yearTo"], "vclass": f["vclass"]}
        if rank < with_years:
            c["yearFrom"], c["yearTo"], c["year"], probs_y = year_range(e, f)
            if details:
                c["yearProbs"] = probs_y
                c["years"] = epa.years(f["make"], f["model"])
        out.append(c)
    return out
