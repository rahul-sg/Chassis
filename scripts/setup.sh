#!/usr/bin/env bash
# One-time setup on an Apple Silicon Mac. Safe to run again: finished steps are skipped.
#
#   bash scripts/setup.sh
#
# Needs: Node 18+, and an arm64 Python 3.10 with ffmpeg, e.g. from miniforge:
#   https://github.com/conda-forge/miniforge  →  ~/miniforge3/bin/conda install -y python=3.10 ffmpeg
# Set PYTHON=/path/to/python3.10 to use a different one.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-$HOME/miniforge3/bin/python3}"
BRUSH_VERSION=v0.3.0
BRUSH_SHA256=65b2631398c839be3c1d4d7160fe2326389dec87830aac0710985e6690a1048c
TRIPOSR_COMMIT=107cefdc244c39106fa830359024f6a2f1c78871

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "Checking this Mac"
[ "$(uname -m)" = "arm64" ] || { echo "This needs an Apple Silicon Mac (M1 or later)."; exit 1; }
[ -x "$PY" ] || { echo "No Python at $PY. Install miniforge, or set PYTHON=..."; exit 1; }
"$PY" -c 'import platform, sys; assert platform.machine() == "arm64", "Python must be arm64, not Intel"; assert sys.version_info[:2] == (3, 10), "Python 3.10 needed"'
command -v node >/dev/null || { echo "Node isn't installed (nodejs.org)."; exit 1; }
command -v ffmpeg >/dev/null || [ -x "$(dirname "$PY")/ffmpeg" ] || echo "Note: ffmpeg not found; walk-around videos need it."

step "Python packages (server/.venv)"
[ -x server/.venv/bin/python ] || "$PY" -m venv server/.venv
server/.venv/bin/pip install -q --upgrade pip
server/.venv/bin/pip install -q -r server/requirements.txt

step "Web packages"
npm install --no-audit --no-fund

mkdir -p tools
step "Brush $BRUSH_VERSION (trains the 3D splats)"
if [ -x tools/brush-app-aarch64-apple-darwin/brush_app ]; then
  echo "already installed"
else
  curl -fL -o tools/brush.tar.xz "https://github.com/ArthurBrussee/brush/releases/download/$BRUSH_VERSION/brush-app-aarch64-apple-darwin.tar.xz"
  echo "$BRUSH_SHA256  tools/brush.tar.xz" | shasum -a 256 -c -
  tar -xJf tools/brush.tar.xz -C tools
fi

step "TripoSR (one photo → 3D)"
if [ -f tools/TripoSR/tsr/system.py ]; then
  echo "already installed"
else
  git clone -q https://github.com/VAST-AI-Research/TripoSR.git tools/TripoSR
  git -C tools/TripoSR checkout -q "$TRIPOSR_COMMIT"
fi

step "Done"
echo "Start it with: npm run dev   (then open http://localhost:4311)"
echo "Models download the first time each is used; the car-parts model is set up from the How it works page."
