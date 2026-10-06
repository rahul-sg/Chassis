"""Capture steps, shared by the API (to describe a new job) and the worker (to run it)."""

STEPS = [
    ("frames", "Picking the sharpest frames"),
    ("masks", "Outlining the car in every frame"),
    ("check", "Checking the video will make a good 3D model"),
    ("cameras", "Working out where the camera was"),
    ("train", "Building the 3D model"),
    ("clean", "Cutting the car out and standing it upright"),
]
