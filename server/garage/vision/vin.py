"""Read a VIN from a photo of the windshield plate, door-jamb sticker or registration.

North American VINs carry a check digit (position 9), so among everything OCR reads, the
right 17 characters can be told apart from misreads, and common look-alikes (S/5, B/8,
Z/2, G/6, D/0) can be corrected until the check digit agrees.
"""
from __future__ import annotations

import itertools
import re

import numpy as np
from PIL import Image

ALLOWED = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
VALUES = {**{str(d): d for d in range(10)},
          **dict(zip("ABCDEFGH", range(1, 9))), **dict(zip("JKLMN", range(1, 6))), "P": 7, "R": 9,
          **dict(zip("STUVWXYZ", range(2, 10)))}
NEVER = {"I": "1", "O": "0", "Q": "0"}  # letters a VIN never uses
LOOKALIKE = {"S": "5", "5": "S", "B": "8", "8": "B", "Z": "2", "2": "Z", "G": "6", "6": "G", "D": "0", "0": "D",
             "U": "V", "V": "U", "1": "L", "L": "1"}


def check_digit(vin: str) -> str:
    total = sum(VALUES[c] * w for c, w in zip(vin, WEIGHTS))
    r = total % 11
    return "X" if r == 10 else str(r)


def is_valid(vin: str) -> bool:
    return len(vin) == 17 and all(c in ALLOWED for c in vin) and check_digit(vin) == vin[8]


YEAR_CODES = set("ABCDEFGHJKLMNPRSTVWXY123456789")  # position 10: model year


def _clean(text: str) -> str:
    t = re.sub(r"\bVIN\b|\bV\.I\.N\.?", " ", text.upper())
    return "".join(NEVER.get(c, c) for c in re.sub(r"[^A-Z0-9 ]", "", t))


def fix(window: str, max_changes: int = 1) -> str | None:
    """The window itself if valid, else the fewest look-alike swaps that make it valid."""
    if is_valid(window):
        return window
    spots = [i for i, c in enumerate(window) if c in LOOKALIKE and i != 8]
    for n in range(1, max_changes + 1):
        for idx in itertools.combinations(spots, n):
            chars = list(window)
            for i in idx:
                chars[i] = LOOKALIKE[chars[i]]
            cand = "".join(chars)
            if is_valid(cand):
                return cand
    return None


def candidates(texts: list[str]) -> list[str]:
    """Likely VINs, best first: whole 17-character words before windows slid across a line,
    unchanged before corrected, and only with a real model-year code in position 10."""
    words, runs = [], []
    for t in texts:
        c = _clean(t)
        words += [w for w in c.split() if len(w) == 17]
        joined = c.replace(" ", "")
        runs += [joined[i:i + 17] for i in range(0, len(joined) - 16)]
    out: list[str] = []
    for pool, changes in ((words, 0), (words, 2), (runs, 0), (runs, 1)):
        for w in pool:
            if not all(ch in ALLOWED for ch in w):
                continue
            v = fix(w, changes) if changes else (w if is_valid(w) else None)
            if v and v[9] in YEAR_CODES and v not in out:
                out.append(v)
    # Last resort, for VINs without a check digit (outside North America): a whole word.
    out += [w for w in words if w not in out and all(ch in ALLOWED for ch in w) and w[9] in YEAR_CODES]
    return out[:8]


def read_vin(img: Image.Image) -> dict:
    from .models import gpu, ocr

    rgb = np.asarray(img.convert("RGB"))
    if max(rgb.shape[:2]) > 2000:
        s = 2000 / max(rgb.shape[:2])
        rgb = np.asarray(img.convert("RGB").resize((int(img.width * s), int(img.height * s))))
    texts: list[str] = []
    for k in (0, 1, 3):  # upright, and turned either way (door stickers are often photographed sideways)
        with gpu:
            lines = ocr().readtext(np.rot90(rgb, k).copy(), detail=0, allowlist=ALLOWED + "IOQ :", paragraph=False)
        texts += [t for t in lines if len(t) >= 5]
        if any(is_valid(c) for c in candidates(lines)):
            break
    return {"candidates": candidates(texts), "read": texts}
