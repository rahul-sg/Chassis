"""The odometer reading from a photo of the instrument cluster.

A cluster shows several numbers (speed, rpm, trip, temperature, clock), so this doesn't pick one
on its own: it reads every number and ranks the likely odometer first: whole numbers of four to
six digits, next to "ODO", "mi" or "km", not a trip meter (one decimal place), a clock or a
temperature. The page shows the top few and you tap the right one.
"""
from __future__ import annotations

import re

import numpy as np
from PIL import Image

NUMBER = re.compile(r"\d[\d,]*(?:\.\d)?")


def rank(texts: list[tuple[str, float]]) -> list[dict]:
    """Score every number in the OCR lines (text, confidence), best odometer candidate first."""
    joined = " ".join(t for t, _ in texts).lower()
    near_km = "km" in joined and not re.search(r"\bmi(les)?\b", joined)
    out: dict[int, dict] = {}
    for i, (text, conf) in enumerate(texts):
        around = " ".join(t for t, _ in texts[max(0, i - 1): i + 2]).lower()
        for m in NUMBER.finditer(text):
            raw = m.group(0)
            if "." in raw or ":" in text[m.end(): m.end() + 1] or "°" in text[m.end(): m.end() + 2]:
                continue  # a trip meter, a clock or a temperature
            digits = raw.replace(",", "")
            if not 3 <= len(digits) <= 6:
                continue
            value = int(digits)
            score = len(digits) + conf * 2
            if re.search(r"\bodo\b|\bmi\b|miles|\bkm\b", around):
                score += 4
            if "trip" in around:
                score -= 4
            if value in out and out[value]["score"] >= score:
                continue
            out[value] = {"value": value, "text": raw, "score": round(score, 2)}
    best = sorted(out.values(), key=lambda c: -c["score"])[:5]
    return [{**c, "unit": "km" if near_km else "mi"} for c in best]


def read(img: Image.Image) -> dict:
    from .models import gpu, ocr

    with gpu:
        lines = ocr().readtext(np.asarray(img.convert("RGB")), detail=1, paragraph=False)
    texts = [(t, float(c)) for _, t, c in lines if t.strip()]
    return {"candidates": rank(texts), "read": [t for t, _ in texts][:20]}
