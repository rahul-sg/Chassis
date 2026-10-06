import numpy as np
from PIL import Image

from garage.vision.studio import BACKDROPS, SIZE, compose


def _car():
    img = Image.new("RGBA", (800, 500), (0, 0, 0, 0))
    a = np.zeros((500, 800, 4), np.uint8)
    a[150:400, 100:700] = (200, 30, 30, 255)  # a red block standing in for a car
    return Image.fromarray(a), [100, 150, 700, 400]


def test_the_car_sits_on_the_backdrop_with_its_colour_kept():
    rgba, box = _car()
    for kind in BACKDROPS:
        out = np.asarray(compose(rgba, box, [], kind))
        assert out.shape == (SIZE[1], SIZE[0], 3)
        centre = out[SIZE[1] // 2 + 100, SIZE[0] // 2]
        assert centre[0] > 150 and centre[1] < 80  # still red in the middle


def test_a_car_cut_off_on_the_right_runs_off_the_right_edge():
    rgba, box = _car()
    out = np.asarray(compose(rgba, box, ["right"], "white"))
    row = out[int(SIZE[1] * 0.7)]
    assert row[-1][0] > 150 and row[-1][1] < 80  # red reaches the last column
