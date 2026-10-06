"""NHTSA services (public domain, no key): VIN decoder, safety recalls and 5-star crash ratings."""
from __future__ import annotations

import urllib.parse

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
