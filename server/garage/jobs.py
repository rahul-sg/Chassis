"""Long jobs (3D capture, model training). The API only writes a job's state file
(data/jobs/<id>/state.json); a separate worker process (python -m garage.worker) runs
queued jobs one at a time, so restarting the API never cuts a job off. A job cut off by
quitting the app says so instead of looking stuck, and can be retried: steps whose results
are already on disk are skipped."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import traceback
from pathlib import Path
from typing import Callable

from . import store
from .paths import DATA

JOBS = DATA / "jobs"
JOBS.mkdir(parents=True, exist_ok=True)
RUNNERS: dict[str, Callable] = {}
_lock = threading.Lock()


def folder(job_id: str) -> Path:
    return JOBS / job_id


def read(job_id: str) -> dict | None:
    f = folder(job_id) / "state.json"
    return json.loads(f.read_text()) if f.exists() else None


def write(state: dict) -> dict:
    state["updatedAt"] = round(time.time(), 2)
    f = folder(state["id"]) / "state.json"
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    os.replace(tmp, f)
    return state


def update(job_id: str, **patch) -> dict:
    with _lock:
        state = read(job_id) or {"id": job_id}
        state.update(patch)
        return write(state)


def set_step(job_id: str, key: str, status: str, progress: float | None = None, detail: str | None = None) -> dict:
    with _lock:
        state = read(job_id)
        for s in state["steps"]:
            if s["key"] == key:
                s["status"] = status
                if progress is not None:
                    s["progress"] = round(progress, 3)
                if detail is not None:
                    s["detail"] = detail
                if status == "running" and "startedAt" not in s:
                    s["startedAt"] = round(time.time(), 2)
                if status == "done":
                    s["progress"] = 1.0
                    s["seconds"] = round(time.time() - s.get("startedAt", time.time()), 1)
        state["step"] = key
        return write(state)


def submit(kind: str, steps: list[tuple[str, str]], **payload) -> dict:
    job_id = store.new_id()
    folder(job_id).mkdir(parents=True)
    return write({
        "id": job_id, "kind": kind, "status": "queued", "createdAt": round(time.time(), 2), "error": None,
        "steps": [{"key": k, "label": label, "status": "waiting", "progress": 0.0} for k, label in steps], **payload,
    })


def retry(job_id: str) -> dict | None:
    """Queue a failed job again; finished steps keep their results and are skipped."""
    with _lock:
        state = read(job_id)
        if not state or state["status"] not in ("failed", "done"):
            return state
        for st in state["steps"]:
            if st["status"] != "done":
                st.update(status="waiting", progress=0.0)
                st.pop("startedAt", None)
        state.update(status="queued", error=None)
        return write(state)


class Paused(Exception):
    """Raised by a job that needs you before going on (e.g. a video that looks likely to fail)."""

    def __init__(self, issues: list[str]):
        super().__init__("; ".join(issues))
        self.issues = issues


def resume(job_id: str) -> dict | None:
    """Go on with a paused job: what it asked about is confirmed, finished steps are kept."""
    with _lock:
        state = read(job_id)
        if not state or state["status"] != "paused":
            return state
        for st in state["steps"]:
            if st["status"] == "paused":
                st.update(status="waiting", progress=0.0)
                st.pop("startedAt", None)
        state.update(status="queued", confirmed=True, issues=None)
        return write(state)


def cancel(job_id: str, reason: str) -> dict | None:
    """Stop a paused or waiting job. Its failure hook runs, as for a job that failed."""
    with _lock:
        state = read(job_id)
        if not state or state["status"] not in ("paused", "queued"):
            return state
        for st in state["steps"]:
            if st["status"] in ("paused", "running"):
                st["status"] = "failed"
        state.update(status="cancelled", error=reason, finishedAt=round(time.time(), 2))
        write(state)
    hook = RUNNERS.get(f"{state['kind']}:failed")
    if hook:
        hook(state)
    return state


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _fail(state: dict, error: str) -> dict:
    """Mark the job failed and the step it was on, so the UI shows where it stopped."""
    for st in state.get("steps", []):
        if st["status"] == "running":
            st["status"] = "failed"
    state.update(status="failed", error=ANSI.sub("", error).strip(), finishedAt=round(time.time(), 2))
    return write(state)


def run_one(job_id: str) -> None:
    state = read(job_id)
    update(job_id, status="running", startedAt=round(time.time(), 2))
    try:
        result = RUNNERS[state["kind"]](state)
        update(job_id, status="done", result=result, finishedAt=round(time.time(), 2))
    except Paused as p:
        paused = read(job_id)
        for st in paused["steps"]:
            if st["status"] == "running":
                st["status"] = "paused"
        paused.update(status="paused", issues=p.issues)
        write(paused)
    except Exception as e:  # the job's own message is meant for people; keep the trace in the log
        (folder(job_id) / "error.log").write_text(traceback.format_exc())
        _fail(read(job_id), str(e))
        hook = RUNNERS.get(f"{state['kind']}:failed")
        if hook:
            hook(read(job_id))


def next_queued() -> str | None:
    queued = [json.loads(f.read_text()) for f in JOBS.glob("*/state.json")]
    queued = [q for q in queued if q.get("status") == "queued"]
    return min(queued, key=lambda q: q["createdAt"])["id"] if queued else None


def recover() -> None:
    """Run by the worker when it starts: jobs it was running when it last stopped can't
    continue mid-step, so they're marked interrupted (and can be retried)."""
    for f in JOBS.glob("*/state.json"):
        state = json.loads(f.read_text())
        if state.get("status") == "running":
            state = _fail(state, "The app was closed while this was running. Retry to pick up where it stopped.")
            hook = RUNNERS.get(f"{state['kind']}:failed")
            if hook:
                hook(state)
