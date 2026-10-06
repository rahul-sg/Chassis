"""Runs queued jobs (3D captures, one-photo 3D guesses, model training) one at a time.

    server/.venv/bin/python -m garage.worker      (started by npm run dev)
"""
from __future__ import annotations

import time

from . import guess3d  # noqa: F401  registers the one-photo 3D job
from . import jobs
from . import partsmodel  # noqa: F401  registers the parts-model job
from .capture import pipeline  # noqa: F401  registers the capture job


def main() -> None:
    jobs.recover()
    print("Chassis worker: waiting for jobs", flush=True)
    while True:
        job_id = jobs.next_queued()
        if job_id:
            print(f"job {job_id}: start", flush=True)
            jobs.run_one(job_id)
            print(f"job {job_id}: {jobs.read(job_id)['status']}", flush=True)
        else:
            time.sleep(1.0)


if __name__ == "__main__":
    main()
