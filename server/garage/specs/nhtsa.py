"""NHTSA services (public domain, no key): VIN decoder, safety recalls, owner complaints and 5-star
crash ratings."""
from __future__ import annotations

import re
import urllib.parse
from collections import Counter

import httpx

from .cache import cached

WEEK = 7 * 24 * 3600
_http = httpx.Client(timeout=20, headers={"User-Agent": "Chassis/0.1 (personal project)"})


def _get(url: str) -> dict:
    r = _http.get(url)
    r.raise_for_status()
    return r.json()


def decode_vin(vin: str) -> dict:
    """NHTSA vPIC decode: {field: value} with empty fields dropped."""
    vin = vin.strip().upper()

    def fetch():
        data = _get(f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/{vin}?format=json")
        row = (data.get("Results") or [{}])[0]
        return {k: v for k, v in row.items() if v not in ("", None, "Not Applicable")}

    return cached(f"vin:{vin}", fetch)


def recalls(year: int, make: str, model: str) -> list[dict]:
    def fetch():
        q = urllib.parse.urlencode({"make": make, "model": model, "modelYear": year})
        data = _get(f"https://api.nhtsa.gov/recalls/recallsByVehicle?{q}")
        return [
            {
                "campaign": r.get("NHTSACampaignNumber", ""),
                "date": r.get("ReportReceivedDate", ""),
                "component": (r.get("Component") or "").title(),
                "summary": r.get("Summary", ""),
                "remedy": r.get("Remedy", ""),
            }
            for r in data.get("results", [])
        ]

    return cached(f"recalls:{year}:{make}:{model}".lower(), fetch, max_age=WEEK)


def ratings(year: int, make: str, model: str) -> list[dict]:
    """NCAP ratings for each tested version (e.g. '2018 Honda Civic 4 DR FWD')."""

    def fetch():
        m = urllib.parse.quote(model)
        versions = _get(f"https://api.nhtsa.gov/SafetyRatings/modelyear/{year}/make/{urllib.parse.quote(make)}/model/{m}")
        out = []
        for v in versions.get("Results", [])[:6]:
            detail = (_get(f"https://api.nhtsa.gov/SafetyRatings/VehicleId/{v['VehicleId']}").get("Results") or [{}])[0]
            star = lambda k: detail.get(k) if detail.get(k) not in (None, "", "Not Rated") else None  # noqa: E731
            out.append({
                "description": v.get("VehicleDescription", ""),
                "overall": star("OverallRating"),
                "frontal": star("OverallFrontCrashRating"),
                "side": star("OverallSideCrashRating"),
                "rollover": star("RolloverRating"),
            })
        return out

    return cached(f"ratings:{year}:{make}:{model}".lower(), fetch, max_age=WEEK)


def _norm(name: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", name.upper())


def match_models(family: str, names: list[str], siblings: list[str] = ()) -> list[str]:
    """The NHTSA model names that belong to an EPA family: the same name, or the family name
    followed by a variant ("UX" → "UX 200", "UX250H"; "Civic" → "Civic Hybrid"). A short family
    name only takes a number after it, so "M" matches "M37" but not "MKZ". Names that belong to a
    more specific EPA family of the same make (`siblings`: "Prius c" next to "Prius") are left out."""
    f = _norm(family)
    own = [_norm(s) for s in siblings if _norm(s) != f and _norm(s).startswith(f)]
    exact = [n for n in names if _norm(n) == f]
    longer = [
        n for n in names
        if _norm(n).startswith(f) and _norm(n) != f and (len(f) >= 3 or _norm(n)[len(f)].isdigit())
        and not any(_norm(n).startswith(s) for s in own)
    ]
    return exact + longer


def model_names(year: int, make: str, family: str, issue: str = "c", siblings: list[str] = ()) -> list[str]:
    """NHTSA's names for a model family in one year. NHTSA files complaints under the exact
    model ("UX 200", "UX 250H") where the EPA family is "UX". issue: c complaints, r recalls."""

    def fetch():
        q = urllib.parse.urlencode({"modelYear": year, "make": make, "issueType": issue})
        return sorted({r["model"] for r in _get(f"https://api.nhtsa.gov/products/vehicle/models?{q}").get("results", [])})

    return match_models(family, cached(f"models:{issue}:{year}:{make}".lower(), fetch, max_age=WEEK), siblings)


def _date(s: str | None) -> tuple[int, int, int]:
    """NHTSA dates are MM/DD/YYYY; this makes them sortable."""
    try:
        m, d, y = (int(x) for x in (s or "").split("/"))
        return y, m, d
    except ValueError:
        return 0, 0, 0


def complaints(year: int, make: str, family: str, siblings: list[str] = ()) -> dict:
    """Owner complaints to NHTSA for one model year: how many, what about, how many involved a
    crash, fire, injury or death, and the most recent few in the owners' own words."""
    names = model_names(year, make, family, siblings=siblings) or [family]

    def fetch():
        seen, rows = set(), []
        for name in names:
            q = urllib.parse.urlencode({"make": make, "model": name, "modelYear": year})
            try:
                data = _get(f"https://api.nhtsa.gov/complaints/complaintsByVehicle?{q}")
            except httpx.HTTPStatusError:
                continue
            for r in data.get("results", []):
                if r.get("odiNumber") not in seen:
                    seen.add(r.get("odiNumber"))
                    rows.append(r)
        parts = Counter(c.strip().title() for r in rows for c in (r.get("components") or "").split(",") if c.strip())
        latest = sorted(rows, key=lambda r: _date(r.get("dateComplaintFiled")), reverse=True)[:5]
        return {
            "count": len(rows),
            "models": names,
            "crashes": sum(1 for r in rows if r.get("crash")),
            "fires": sum(1 for r in rows if r.get("fire")),
            "injuries": sum(int(r.get("numberOfInjuries") or 0) for r in rows),
            "deaths": sum(int(r.get("numberOfDeaths") or 0) for r in rows),
            "components": [{"name": n, "count": k} for n, k in parts.most_common(6)],
            "latest": [
                {"date": r.get("dateComplaintFiled", ""), "components": (r.get("components") or "").title(),
                 "summary": (r.get("summary") or "").strip()}
                for r in latest
            ],
        }

    return cached(f"complaints:v2:{year}:{make}:{family}".lower(), fetch, max_age=WEEK)
