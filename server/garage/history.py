"""A vehicle history report you already have (Carfax or AutoCheck), read into plain facts.

Chassis doesn't fetch these reports: you buy one, or the dealer gives you one, and drop in the
PDF (or paste its text). Only the summary is read: accidents and damage and how bad, structural
damage, airbags, insurance total loss, title brands, owners, service records and the last
reported mileage. Anything the report doesn't say stays unknown (None) rather than guessed.
The wording these rules look for comes from real Carfax reports from several years and
AutoCheck reports as KBB shows them.
"""
from __future__ import annotations

import io
import re

DATE = r"\d{1,2}/\d{1,2}/\d{2,4}"
BRANDS = ["salvage", "junk", "rebuilt", "reconstructed", "fire", "flood", "hail", "lemon", "not actual mileage"]


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:  # a damaged or encrypted PDF
        raise ValueError("That PDF couldn’t be read. Paste the report’s text instead.") from e


def _int(s: str | None) -> int | None:
    return int(s.replace(",", "")) if s else None


def _flag(t: str, no: str, yes: str) -> bool | None:
    """False when the report says there's none, True when it reports one, None when it doesn't say."""
    if re.search(no, t, re.I):
        return False
    if re.search(yes, t, re.I):
        return True
    return None


def _dates(t: str, after: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(after + r"((?:\s*(?:,|and)?\s*" + DATE + ")+)", t, re.I):
        out += re.findall(DATE, m.group(1))
    return list(dict.fromkeys(out))


def parse(text: str) -> dict:
    t = re.sub(r"[ \t]+", " ", text.replace(" ", " "))
    flat = re.sub(r"\s+", " ", t)
    source = "carfax" if "CARFAX" in t else "autocheck" if re.search(r"AutoCheck", t, re.I) else None
    out: dict = {"source": source}

    vin = re.search(r"VIN:?\s*([A-HJ-NPR-Z0-9]{17})", flat)
    out["vin"] = vin.group(1) if vin else None
    when = re.search(r"available as of (" + DATE + ")", flat) or re.search(r"Report run:?\s*(" + DATE + ")", flat)
    out["reportDate"] = when.group(1) if when else None

    # Accidents and damage.
    none = r"No accidents? or damage reported|No Accidents or Damage Reported|no accidents or damage events"
    some = r"Accident reported|Damage reported|Accident / Damage reported|Accident or damage event\(s\) have been reported"
    out["accidents"] = _flag(flat, none, some)
    dates = _dates(flat, r"(?:Accident|Damage) reported(?: on)?:?")
    if source == "autocheck" and out["accidents"]:
        table = re.search(r"Damage Date Damage Type Severity (.*?)(?:Accident or damage event|Service History)", flat)
        if table:
            dates = list(dict.fromkeys(re.findall(DATE, table.group(1))))
    out["damageDates"] = dates
    out["damageCount"] = len(dates) if out["accidents"] else 0 if out["accidents"] is False else None
    # Carfax shows how bad the worst damage was next to its MINOR MODERATE SEVERE scale (its
    # glossary also says "Severe Damage", so the scale is what's looked for).
    worst = re.search(r"\b(Minor|Moderate|Severe) damage\s+MINOR\s+MODERATE\s+SEVERE", flat)
    out["severity"] = worst.group(1).lower() if worst and out["accidents"] else None

    # AutoCheck's damage panel ends "Airbag Deployed Structural Damage Overturned No Damage".
    no_damage = r"Overturned No Damage"
    out["structural"] = _flag(
        flat,
        r"No structural damage reported|Structural Damage (?:CARFAX recommends[^.]*\. )?No Issues Reported|" + no_damage,
        r"(?<!No )Structural damage reported",
    )
    out["airbag"] = _flag(flat, r"No airbag deployment reported|" + no_damage, r"(?<!No )Airbag deployment reported")
    out["totalLoss"] = _flag(
        flat,
        r"No total loss reported|Insurance Loss / Transfer No Issue",
        r"(?<!No )Total loss reported|Insurance Loss / Transfer (?!No Issue)\w",
    )

    # Title: clean only when the report says so; a brand when one is named outside the list of
    # brands the report checks for ("Salvage | Junk | Rebuilt …").
    listless = re.sub(r"(?:Salvage|Junk|Rebuilt|Fire|Flood|Hail|Lemon)(?: \| [A-Za-z ]+)+", " ", flat)
    brands = sorted({b for b in BRANDS if re.search(rf"\b{b}\b[^.]{{0,20}}\b(title|brand)", listless, re.I)})
    clean = re.search(r"None of these (?:major )?title problems were reported|State Title Brand Clean", flat, re.I)
    out["titleBrands"] = [b.title() for b in brands]
    out["title"] = "branded" if brands else "clean" if clean else None

    owners = re.search(r"(\d+)\s*Previous owners", flat, re.I) or re.search(r"Owners -\s*(\d+)", flat)
    if owners:
        out["owners"] = int(owners.group(1))
    elif re.search(r"1-Owner", flat):
        out["owners"] = 1
    else:
        out["owners"] = None
    service = re.search(r"(\d+)\s*Service (?:history )?records?", flat, re.I) or re.search(r"(\d+) Service Record\(s\)", flat)
    out["serviceRecords"] = int(service.group(1)) if service else None

    odo = re.search(r"Last Reported Odometer:?\s*([\d,]+)\s*\((" + DATE + r")\)", flat, re.I)
    if odo:
        out["lastMileage"], out["lastMileageDate"] = _int(odo.group(1)), odo.group(2)
    else:
        odo = re.search(r"([\d,]+)\s*Last reported odometer", flat, re.I)
        out["lastMileage"], out["lastMileageDate"] = (_int(odo.group(1)) if odo else None), None

    out["odometerProblem"] = _flag(
        flat,
        r"No indication of an odometer rollback|State Title Odometer Check No issues reported",
        r"(?:potential|possible) odometer rollback|odometer rollback (?:indicated|reported)",
    )
    return out
