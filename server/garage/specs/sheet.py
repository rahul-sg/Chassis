"""A spec sheet for one model year: EPA data for the chosen version, the VIN decode when
there is one, NHTSA crash ratings and recalls. Every value says where it came from."""
from __future__ import annotations

import re

from . import epa, nhtsa

EPA = "EPA"
VIN = "NHTSA VIN decode"
NCAP = "NHTSA 5-star ratings"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _trany(t: str) -> str:
    t = t.replace("(variable gear ratios)", "(CVT)").replace("(AV-S", "(CVT, S").replace("Automatic (S", "Automatic, ")
    t = re.sub(r"\((A|AM)-?S?(\d+)\)", r"\2-speed", t)
    return t.replace("Automatic ", "Automatic, ").replace("Manual ", "Manual, ").replace(", , ", ", ").rstrip(")").replace("(", "")


def variant_label(v: dict) -> str:
    if v.get("atvType") == "EV":
        engine = f"Electric{' · ' + v['evMotor'] if v.get('evMotor') else ''}"
    else:
        boost = " turbo" if v.get("tCharger") else " supercharged" if v.get("sCharger") == "S" else ""
        hybrid = " hybrid" if v.get("atvType") in ("Hybrid", "Plug-in Hybrid") else ""
        engine = f"{float(v['displ']):.1f} L {v['cylinders']}-cyl{boost}{hybrid}" if v.get("displ") else "Engine"
    return f"{v['model']} · {engine} · {_trany(v.get('trany', ''))} · {v.get('drive', '')}"


def _match_variant(variants: list[dict], vin: dict | None) -> dict:
    """The EPA version closest to what the VIN says (displacement, drive, cylinders)."""
    if not vin or not variants:
        return variants[0]

    def score(v):
        s = 0
        try:
            s -= abs(float(vin.get("DisplacementL", 0)) - float(v.get("displ") or 0)) * 4
        except ValueError:
            pass
        d = (vin.get("DriveType") or "").lower()
        vd = (v.get("drive") or "").lower()
        if d and (("4" in d or "awd" in d or "all" in d) == ("4" in vd or "all" in vd)):
            s += 2
        if vin.get("EngineCylinders") and str(vin["EngineCylinders"]) == str(v.get("cylinders")):
            s += 1
        return s

    return max(variants, key=score)


def build(year: int, make: str, model: str, variant: int | None = None, vin: str | None = None) -> dict:
    variants = epa.variants(year, make, model)
    if not variants:
        raise LookupError(f"No EPA data for a {year} {make} {model}")
    decoded = nhtsa.decode_vin(vin) if vin else None
    v = next((x for x in variants if x["id"] == variant), None) or _match_variant(variants, decoded)
    ev = v.get("atvType") == "EV"

    def item(label, value, source=EPA):
        return {"label": label, "value": str(value), "source": source} if value not in (None, "", -1) else None

    power = [
        item("Engine", variant_label(v).split(" · ")[1]),
        item("Horsepower", f"{decoded['EngineHP']} hp" if decoded and decoded.get("EngineHP") else None, VIN),
        item("Fuel", v.get("fuelType1") + (f" or {v['fuelType2']}" if v.get("fuelType2") else "")),
        item("Transmission", _trany(v.get("trany", ""))),
        item("Drive", v.get("drive")),
        item("Electric motor", v.get("evMotor")),
    ]
    unit = "MPGe" if ev else "mpg"
    economy = [
        item("City", f"{v['city08']} {unit}" if v.get("city08") else None),
        item("Highway", f"{v['highway08']} {unit}" if v.get("highway08") else None),
        item("Combined", f"{v['comb08']} {unit}" if v.get("comb08") else None),
        item("Range", f"{v['range']} miles" if v.get("range") else None),
        item("Fuel cost", f"${v['fuelCost08']:,} a year" if v.get("fuelCost08") else None, "EPA (15,000 miles a year)"),
        item("CO₂", f"{round(v['co2TailpipeGpm'])} g/mile" if v.get("co2TailpipeGpm") and v["co2TailpipeGpm"] > 0 else None),
        item("Over 5 years vs. average new car",
             (f"Saves ${v['youSaveSpend']:,}" if v["youSaveSpend"] >= 0 else f"Costs ${-v['youSaveSpend']:,} more")
             if v.get("youSaveSpend") not in (None, 0) else None),
    ]
    body = [
        item("Size class", v.get("VClass")),
        item("Body", decoded.get("BodyClass") if decoded else None, VIN),
        item("Doors", decoded.get("Doors") if decoded else None, VIN),
        item("Trim", decoded.get("Trim") if decoded else None, VIN),
        item("Built in", ", ".join(x.title() for x in (decoded.get("PlantCity"), decoded.get("PlantCountry")) if x)
             if decoded else None, VIN),
    ]

    recalls = ratings = None
    errors = []
    for name in dict.fromkeys([model, v["model"]]):  # NHTSA sometimes uses the full EPA model name
        try:
            recalls = recalls or nhtsa.recalls(year, make, name)
            ratings = ratings or nhtsa.ratings(year, make, name)
        except Exception as e:  # offline: the rest of the sheet still works
            errors.append(str(e))
    safety = []
    if ratings:
        best = next((r for r in ratings if r["overall"]), ratings[0])
        safety = [
            item("Overall", f"{best['overall']} of 5 stars" if best["overall"] else None, NCAP),
            item("Frontal crash", f"{best['frontal']} of 5" if best["frontal"] else None, NCAP),
            item("Side crash", f"{best['side']} of 5" if best["side"] else None, NCAP),
            item("Rollover", f"{best['rollover']} of 5" if best["rollover"] else None, NCAP),
        ]

    groups = [
        {"title": "Powertrain", "items": [x for x in power if x]},
        {"title": "Electric range and economy" if ev else "Fuel economy", "items": [x for x in economy if x]},
        {"title": "Body", "items": [x for x in body if x]},
        {"title": "Crash ratings", "items": [x for x in safety if x]},
    ]
    sources = ["EPA fuel economy data (fueleconomy.gov)"]
    if decoded:
        sources.append("NHTSA vPIC VIN decoder")
    if ratings is not None or recalls is not None:
        sources.append("NHTSA recalls and NCAP ratings")
    return {
        "year": year, "make": make, "model": model,
        "variants": [{"id": x["id"], "label": variant_label(x)} for x in variants],
        "variant": v["id"],
        "groups": [g for g in groups if g["items"]],
        "recalls": recalls, "ratings": ratings, "sources": sources,
        "offline": bool(errors) and recalls is None,
    }


def family_from_vin(decoded: dict) -> dict | None:
    """Map a VIN decode (make 'HONDA', model 'Civic', year 2018) onto an EPA family."""
    try:
        year = int(decoded.get("ModelYear"))
    except (TypeError, ValueError):
        return None
    make, model = _norm(decoded.get("Make")), _norm(decoded.get("Model"))
    best, score = None, 0
    for f in epa.families():
        if _norm(f["make"]) != make or not (f["yearFrom"] <= year <= f["yearTo"]):
            continue
        m = _norm(f["model"])
        s = len(m) if model.startswith(m) else len(model) if m.startswith(model) else 0
        if s > score:
            best, score = f, s
    return {"make": best["make"], "model": best["model"], "year": year} if best else None
