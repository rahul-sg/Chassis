"""Train the Gaussian splat with Brush (runs on the Mac's GPU through Metal).

Brush only draws its progress bar on a terminal, so it runs inside a pseudo-terminal and
the step counter ("1234/12000") is read from that output."""
from __future__ import annotations

import os
import pty
import re
import select
import subprocess
from pathlib import Path

from ..paths import TOOLS

BRUSH = TOOLS / "brush-app-aarch64-apple-darwin" / "brush_app"
ANSI = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]")
STEP = re.compile(r"(\d+)\s*/\s*(\d+)")


def run_in_terminal(cmd: list[str], log: Path, on_text) -> int:
    master, slave = pty.openpty()
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)
    buf = b""
    with log.open("wb") as f:
        while True:
            ready, _, _ = select.select([master], [], [], 1.0)
            if ready:
                try:
                    data = os.read(master, 8192)
                except OSError:
                    data = b""
                if not data:
                    break
                f.write(data)
                buf = (buf + ANSI.sub(b"", data))[-4096:]
                *lines, buf = re.split(rb"[\r\n]", buf)
                for line in lines:
                    on_text(line.decode(errors="ignore"))
            elif proc.poll() is not None:
                break
    os.close(master)
    return proc.wait()


def train(dataset: Path, out: Path, steps: int = 12000, max_resolution: int = 1280, progress=lambda f: None) -> Path:
    if not BRUSH.exists():
        raise RuntimeError("Brush, which trains the 3D model, isn’t installed. Run bash scripts/setup.sh, then retry.")
    out.mkdir(parents=True, exist_ok=True)
    cmd = [str(BRUSH), str(dataset), "--total-steps", str(steps), "--max-resolution", str(max_resolution),
           "--export-every", str(steps), "--export-path", str(out), "--export-name", "splat.ply"]

    def on_text(line: str):
        for a, b in STEP.findall(line):
            if int(b) == steps:
                progress(min(1.0, int(a) / steps))

    if run_in_terminal(cmd, out / "brush.log", on_text) != 0:
        raise RuntimeError(f"Training stopped with an error (see {out / 'brush.log'}).")
    plys = sorted(out.glob("*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        raise RuntimeError("Training finished but wrote no model.")
    return plys[-1]
