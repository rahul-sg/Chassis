from garage.dimensions import DEFAULT, typical


def test_more_specific_classes_win():
    # "Compact" is inside "Minicompact" and "Subcompact", "Midsize" inside "Midsize Station Wagons".
    assert typical("Minicompact Cars") == (4.10, 1.78, 1.38)
    assert typical("Subcompact Cars") == (4.40, 1.78, 1.45)
    assert typical("Compact Cars") == (4.60, 1.80, 1.45)
    assert typical("Midsize Station Wagons") == (4.80, 1.85, 1.50)
    assert typical("Midsize Cars") == (4.85, 1.84, 1.45)
    assert typical("Minivan - 2WD")[0] == 5.15
    assert typical("Vans, Passenger Type")[0] == 5.50


def test_unknown_class_gets_the_default():
    assert typical(None) == DEFAULT
    assert typical("Hovercraft") == DEFAULT
