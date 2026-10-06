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


def test_a_job_can_pause_to_ask_then_go_on_or_stop():
    _isolated()
    state = jobs.submit("ask", [("a", "First"), ("b", "Check"), ("c", "Long part")])
    seen = []

    def runner(s):
        jobs.set_step(s["id"], "a", "done")
        jobs.set_step(s["id"], "b", "running")
        if not s.get("confirmed"):
            raise jobs.Paused(["It’s portrait."])
        jobs.set_step(s["id"], "b", "done")
        jobs.set_step(s["id"], "c", "done")
        return {"ok": True}

    jobs.RUNNERS["ask"] = runner
    jobs.RUNNERS["ask:failed"] = lambda s: seen.append(s["status"])
    jobs.run_one(state["id"])
    s = jobs.read(state["id"])
    assert s["status"] == "paused" and s["issues"] == ["It’s portrait."]
    assert [st["status"] for st in s["steps"]] == ["done", "paused", "waiting"]
    assert jobs.next_queued() is None  # a paused job waits for you

    jobs.resume(state["id"])
    assert jobs.next_queued() == state["id"]
    jobs.run_one(state["id"])
    assert jobs.read(state["id"])["status"] == "done"

    other = jobs.submit("ask", [("a", "First"), ("b", "Check")])
    jobs.run_one(other["id"])
    s = jobs.cancel(other["id"], "Stopped so you can film it again.")
    assert s["status"] == "cancelled" and seen == ["cancelled"]
