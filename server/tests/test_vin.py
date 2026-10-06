from garage.vision import vin

GOOD = "1HGCM82633A004352"  # the standard worked example: check digit 3


def test_check_digit():
    assert vin.check_digit(GOOD) == "3"
    assert vin.is_valid(GOOD)


def test_one_wrong_character_fails_the_check():
    assert not vin.is_valid(GOOD[:16] + "9")
    assert not vin.is_valid(GOOD[:16])  # too short


def test_letters_vins_never_use_are_rejected():
    assert not vin.is_valid("1HGCM82633AO04352")  # O is never used


def test_candidates_find_the_vin_in_ocr_text():
    found = vin.candidates([f"VIN: {GOOD}", "MADE IN USA"])
    assert found and found[0] == GOOD
