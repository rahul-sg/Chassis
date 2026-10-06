from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"          # your garage: not in git
MEDIA = DATA / "media"        # photos, videos, captures
CACHE = DATA / "cache"        # government data and API responses
TOOLS = ROOT / "tools"        # downloaded binaries (Brush)
for d in (DATA, MEDIA, CACHE, TOOLS):
    d.mkdir(parents=True, exist_ok=True)
