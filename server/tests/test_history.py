"""History reports, odometer photos and NHTSA's model names. The report snippets are written
here in the wording real Carfax and AutoCheck reports use; no report is copied."""
from garage import history
from garage.specs.nhtsa import match_models
from garage.vision.odometer import rank

CARFAX_CLEAN = """
Vehicle History Report This CARFAX Vehicle History Report is based only on information supplied to CARFAX
and available as of 3/31/25 at 5:34:58 PM (CDT).
No accidents or damage reported to CARFAX
7 Service history records
2 Previous owners
10,844 Last reported odometer reading
2018 ASTON MARTIN DB11 VIN:SCFRMFAV4JGL03835
Total Loss No total loss reported to CARFAX.
Structural Damage No structural damage reported to CARFAX.
Airbag Deployment No airbag deployment reported to CARFAX.
Odometer Check No indication of an odometer rollback.
Damage Brands Salvage | Junk | Rebuilt | Fire | Flood | Hail | Lemon Guaranteed No Problem
GUARANTEED - None of these title problems were reported by a U.S. state Department of Motor Vehicles.
Glossary Severe Damage: damage that may affect the car's structure.
"""

CARFAX_DAMAGE = """
CARFAX Vehicle History Report available as of 6/1/23.
Moderate damage
MINOR MODERATE SEVERE
2  Service history records
CARFAX 1-Owner vehicle
10  Last reported odometer reading
VIN: 1G1YB3D48N5123625
Accident / Damage Damage reported: 08/16/2022 and 02/14/2023. Damage Reported
Total Loss No total loss reported to CARFAX.
None of these major title problems were reported by a state Department of Motor Vehicles (DMV).
"""

AUTOCHECK = """
Experian AutoCheck Report Report run: 10/06/2026 21:08:38 EDT
VIN: 2C3CDXBG1PH627112
Last Reported Odometer: 33,629 (04/16/2026)
Owners - 2
State Title Brand Clean
Accident / Damage Damage Reported
Insurance Loss / Transfer No Issue
1 Service Record(s) Reported
Accident & Damage Airbag Deployed Structural Damage Overturned Unknown
Damage Date Damage Type Severity 12/19/2023 Collision Unknown
Accident or damage event(s) have been reported for this vehicle to Experian AutoCheck.
Service History
"""


def test_a_clean_carfax_report():
    r = history.parse(CARFAX_CLEAN)
    assert r["source"] == "carfax" and r["vin"] == "SCFRMFAV4JGL03835"
    assert r["accidents"] is False and r["severity"] is None  # the glossary's "Severe Damage" isn't a finding
    assert (r["structural"], r["airbag"], r["totalLoss"], r["odometerProblem"]) == (False, False, False, False)
    assert r["title"] == "clean" and r["titleBrands"] == []  # the list of brands checked for isn't a brand
    assert (r["owners"], r["serviceRecords"], r["lastMileage"]) == (2, 7, 10844)


def test_carfax_damage_with_dates_and_severity():
    r = history.parse(CARFAX_DAMAGE)
    assert r["accidents"] is True and r["damageCount"] == 2 and r["severity"] == "moderate"
    assert r["damageDates"] == ["08/16/2022", "02/14/2023"]
    assert r["owners"] == 1 and r["serviceRecords"] == 2 and r["lastMileage"] == 10


def test_an_autocheck_report():
    r = history.parse(AUTOCHECK)
    assert r["source"] == "autocheck" and r["vin"] == "2C3CDXBG1PH627112"
    assert r["accidents"] is True and r["damageCount"] == 1
    assert r["title"] == "clean" and r["totalLoss"] is False
    assert (r["owners"], r["serviceRecords"], r["lastMileage"], r["lastMileageDate"]) == (2, 1, 33629, "04/16/2026")


def test_a_branded_title_is_named():
    r = history.parse(CARFAX_CLEAN.replace("GUARANTEED - None of these title problems", "Salvage title issued by the DMV. The"))
    assert r["title"] == "branded" and r["titleBrands"] == ["Salvage"]


def test_what_a_report_doesnt_say_stays_unknown():
    r = history.parse("CARFAX report with nothing in it " * 20)
    assert r["accidents"] is None and r["owners"] is None and r["title"] is None


def test_the_odometer_comes_before_trip_clock_and_speed():
    read = [("72'F", 0.9), ("12:45", 0.9), ("60", 0.99), ("MPH", 0.9), ("TRIP A 312.4 mi", 0.8), ("ODO 45,231 mi", 0.9)]
    best = rank(read)
    assert best[0]["value"] == 45231 and best[0]["unit"] == "mi"
    assert all(c["value"] != 3124 for c in best)


def test_nhtsa_model_names_for_an_epa_family():
    assert match_models("UX", ["UX 200", "UX 250H", "NX300"]) == ["UX 200", "UX 250H"]
    assert match_models("M", ["M37", "MKZ"]) == ["M37"]
    assert match_models("Civic", ["CIVIC", "CIVIC HYBRID"]) == ["CIVIC", "CIVIC HYBRID"]
    # "Prius c" and "Prius v" are their own EPA families, so they're not counted as the Prius.
    prius = match_models("Prius", ["PRIUS", "PRIUS C", "PRIUS PLUG-IN HYBRID", "PRIUS V"], ["Prius", "Prius c", "Prius v", "Prius Prime"])
    assert prius == ["PRIUS", "PRIUS PLUG-IN HYBRID"]
