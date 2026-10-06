"""Stand-in for rembg, which TripoSR imports but Chassis doesn't use: the car is cut out
with BiRefNet before TripoSR sees it."""


def new_session(*args, **kwargs):
    return None


def remove(*args, **kwargs):
    raise RuntimeError("Background removal is done with BiRefNet before TripoSR runs.")
