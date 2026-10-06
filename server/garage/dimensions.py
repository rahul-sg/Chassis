"""Typical outside dimensions by EPA size class, for cars without a measured 3D model.

Metres, as (length, width, height): rough medians for current cars in each class. Used to
scale a capture when you haven't given its length, and to size the stand-in body in the
virtual garage.
"""
from __future__ import annotations

CLASS_DIMS = [
    ("Two Seaters", (4.30, 1.85, 1.25)),
    ("Minicompact", (4.10, 1.78, 1.38)),
    ("Subcompact", (4.40, 1.78, 1.45)),
    ("Compact", (4.60, 1.80, 1.45)),
    ("Midsize Station", (4.80, 1.85, 1.50)),
    ("Small Station", (4.40, 1.80, 1.50)),
    ("Midsize", (4.85, 1.84, 1.45)),
    ("Large", (5.10, 1.90, 1.48)),
    ("Small Sport Utility", (4.50, 1.84, 1.66)),
    ("Standard Sport Utility", (5.00, 1.98, 1.80)),
    ("Small Pickup", (5.40, 1.88, 1.80)),
    ("Standard Pickup", (5.85, 2.03, 1.95)),
    ("Minivan", (5.15, 1.99, 1.76)),
    ("Van", (5.50, 2.03, 2.10)),
    ("Special Purpose", (4.80, 1.90, 1.80)),
]
DEFAULT = (4.70, 1.83, 1.50)


def typical(vclass: str | None) -> tuple[float, float, float]:
    """(length, width, height) for an EPA size class such as "Small Sport Utility Vehicle 4WD"."""
    for key, dims in CLASS_DIMS:
        if vclass and key.lower() in vclass.lower():
            return dims
    return DEFAULT


def vclass_for(make: str, model: str) -> str | None:
    """The EPA size class of a make and model family, or None when EPA doesn't list it."""
    from .specs import epa

    try:
        for fam in epa.families():
            if fam["make"].lower() == make.lower() and fam["model"].lower() == model.lower():
                return fam.get("vclass")
    except Exception:  # EPA data not built yet
        return None
    return None
