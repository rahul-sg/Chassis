"""Runs every test_* function in server/tests/test_*.py and reports what failed.

    server/.venv/bin/python -W ignore server/tests/run.py      (also part of npm test)

A plain runner rather than pytest, so the app has one less dependency.
"""
from __future__ import annotations

import importlib.util
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))


def main() -> int:
    passed, failed = 0, []
    t0 = time.time()
    for path in sorted(HERE.glob("test_*.py")):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in sorted(n for n in dir(module) if n.startswith("test_")):
            try:
                getattr(module, name)()
                passed += 1
            except Exception:
                failed.append((f"{path.stem}.{name}", traceback.format_exc()))
    for name, trace in failed:
        print(f"FAIL {name}\n{trace}")
    print(f"{passed} passed, {len(failed)} failed in {time.time() - t0:.1f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
