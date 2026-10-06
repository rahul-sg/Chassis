"""Measure photo identification on the Stanford Cars test set (196 make/model/year classes).

    server/.venv/bin/python server/tools/eval_identify.py --n 600
    server/.venv/bin/python server/tools/eval_identify.py --n 600 --skip 600   (held out)

Each Stanford label ("acura tl sedan 2012") is matched to an EPA model family; labels with
no EPA family (cars never sold in the U.S. with an EPA rating) are reported and skipped.
The year-range settings in identify.py were tuned on the first 600 photos of the fixed shuffle;
--skip 600 measures on the next 600, which played no part in tuning.
Writes data/eval/identify-<model>[-from<skip>].json.
"""
from __future__ import annotations

import argparse
import glob
import io
import json
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from PIL import Image  # noqa: E402

from garage.specs import epa  # noqa: E402

BODY = {"sedan", "coupe", "convertible", "suv", "hatchback", "wagon", "van", "minivan", "cab", "crew", "extended",
        "regular", "quad", "club", "cargo", "pickup", "drophead", "hybrid", "passenger"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def map_label(label: str, fams: list[dict]) -> dict | None:
    words = label.split()
    year = int(words[-1])
    words = words[:-1]
    makes = sorted({f["make"] for f in fams}, key=lambda m: -len(m))
    make = next((m for m in makes if norm(label).startswith(norm(m))), None)
    if not make:
        return None
    rest = words[len(make.split()):]
    while rest and rest[-1] in BODY:
        rest = rest[:-1]
    target = norm(" ".join(rest))
    best, score = None, 0
    for f in fams:
        if f["make"] != make or not (f["yearFrom"] - 1 <= year <= f["yearTo"] + 1):
            continue
        m = norm(f["model"])
        common = len(m) if target.startswith(m) else len(target) if m.startswith(target) else 0
        if common >= 2 and common > score:
            best, score = f, common
    return {"make": best["make"], "model": best["model"], "year": year} if best else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--skip", type=int, default=0, help="start this far into the fixed shuffle (600 = held out from tuning)")
    ap.add_argument("--no-detect", action="store_true", help="classify the whole photo (Stanford images are already cropped)")
    a = ap.parse_args()

    import polars as pl

    from garage.vision import detect, identify
    from garage.vision.models import SIGLIP

    classes = {int(k): v for k, v in json.loads((ROOT / "data/eval/classes.json").read_text()).items()}
    fams = epa.families()
    mapping = {k: map_label(v, fams) for k, v in classes.items()}
    unmapped = [classes[k] for k, v in mapping.items() if v is None]
    df = pl.read_parquet(glob.glob(str(ROOT / "data/eval/data/*.parquet"))[0], columns=["image", "label"])
    rows = [r for r in df.iter_rows(named=True) if mapping[r["label"]]]
    random.Random(0).shuffle(rows)
    rows = rows[a.skip: a.skip + a.n]

    identify.family_index()  # build text embeddings outside the timing
    res = []
    t0 = time.time()
    for r in rows:
        img = Image.open(io.BytesIO(r["image"]["bytes"])).convert("RGB")
        truth = mapping[r["label"]]
        if not a.no_detect:
            car = detect.find_car(img)
            if car:
                img = detect.crop(img, car["box"])
        cands = identify.identify(img, k=5, with_years=1, details=True)
        top = cands[0]
        res.append({
            "label": classes[r["label"]],
            "truth": truth,
            "top": [(c["make"], c["model"]) for c in cands],
            "conf": top["confidence"],
            "years": [top["yearFrom"], top["yearTo"]],
            "yearProbs": top.get("yearProbs"),
            "familyYears": top.get("years"),
        })
    secs = (time.time() - t0) / max(1, len(res))

    hit = lambda r, k: (r["truth"]["make"], r["truth"]["model"]) in [tuple(x) for x in r["top"][:k]]  # noqa: E731
    n = len(res)
    top1 = sum(hit(r, 1) for r in res)
    top5 = sum(hit(r, 5) for r in res)
    make1 = sum(r["truth"]["make"] == r["top"][0][0] for r in res)
    right = [r for r in res if hit(r, 1)]
    in_range = sum(r["years"][0] <= r["truth"]["year"] <= r["years"][1] for r in right)
    width = sum(r["years"][1] - r["years"][0] + 1 for r in right) / max(1, len(right))
    bins = {}
    for lo, hi in ((0, 0.5), (0.5, 0.8), (0.8, 0.95), (0.95, 1.01)):
        b = [r for r in res if lo <= r["conf"] < hi]
        bins[f"{lo:.2f}-{min(hi, 1):.2f}"] = {"n": len(b), "accuracy": round(sum(hit(r, 1) for r in b) / max(1, len(b)), 3)}
    summary = {
        "model": "/".join(SIGLIP), "images": n, "skip": a.skip, "classesMapped": 196 - len(unmapped), "unmappedClasses": unmapped,
        "top1": round(top1 / n, 3), "top5": round(top5 / n, 3), "makeTop1": round(make1 / n, 3),
        "yearInRange": round(in_range / max(1, len(right)), 3), "meanYearSpan": round(width, 2),
        "calibration": bins, "secondsPerImage": round(secs, 2),
        "commonMistakes": Counter(f"{r['truth']['make']} {r['truth']['model']} → {r['top'][0][0]} {r['top'][0][1]}"
                                  for r in res if not hit(r, 1)).most_common(12),
    }
    out = ROOT / "data/eval" / f"identify-{SIGLIP[0]}{f'-from{a.skip}' if a.skip else ''}.json"
    out.write_text(json.dumps({"summary": summary, "results": res}, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != "unmappedClasses"}, indent=1))
    print(f"{len(unmapped)} classes have no EPA family, e.g. {unmapped[:6]}")


if __name__ == "__main__":
    main()
