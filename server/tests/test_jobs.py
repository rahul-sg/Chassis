import tempfile
from pathlib import Path

from garage import jobs


def _isolated():
    jobs.JOBS = Path(tempfile.mkdtemp())


def test_a_failed_job_marks_its_step_and_can_be_retried():
    _isolated()
    state = jobs.submit("test", [("a", "First"), ("b", "Second")])

    def runner(s):
        jobs.set_step(s["id"], "a", "done")
        jobs.set_step(s["id"], "b", "running")
        raise RuntimeError("\x1b[34mtrain: \x1b[0mno data")

    jobs.RUNNERS["test"] = runner
    jobs.run_one(state["id"])
    s = jobs.read(state["id"])
    assert s["status"] == "failed"
    assert s["error"] == "train: no data"  # terminal colours stripped
    assert [st["status"] for st in s["steps"]] == ["done", "failed"]

    s = jobs.retry(state["id"])
    assert s["status"] == "queued"
    assert [st["status"] for st in s["steps"]] == ["done", "waiting"]  # finished steps are kept


def test_jobs_left_running_are_marked_interrupted():
    _isolated()
    state = jobs.submit("test", [("a", "First")])
    jobs.update(state["id"], status="running")
    jobs.set_step(state["id"], "a", "running")
    jobs.recover()
    s = jobs.read(state["id"])
    assert s["status"] == "failed" and "closed" in s["error"]
    assert s["steps"][0]["status"] == "failed"
