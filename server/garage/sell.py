"""Sell-my-car kit: studio photos, and the listing as a folder you can host anywhere.

Studio photos are cached twice: the cut-out per source photo (the slow part, about a second
on the GPU) and the finished picture per photo and backdrop, so switching backdrops is quick.

The kit is a static site: index.html with the photos, the listing, the spec sheet and, when
the car has a capture, the 3D model in a small viewer (three.js and Spark copied in, so it
works without a network). It needs a web server rather than a double-click, as browsers
don't load modules or the model from file:// pages; README.txt in the kit says how.
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import zipfile
from pathlib import Path

from PIL import Image

from . import store
from .paths import MEDIA, ROOT

STUDIO_VERSION = 4  # bump when the look changes, so cached pictures are made again
CUTOUT_VERSION = 2  # bump when the cut-out changes
NODE = ROOT / "node_modules"
VIEWER_FILES = {
    "js/three.module.js": NODE / "three/build/three.module.js",
    "js/three.core.js": NODE / "three/build/three.core.js",
    "js/addons/postprocessing/Pass.js": NODE / "three/examples/jsm/postprocessing/Pass.js",
    "js/addons/controls/OrbitControls.js": NODE / "three/examples/jsm/controls/OrbitControls.js",
    "js/spark.module.min.js": NODE / "@sparkjsdev/spark/dist/spark.module.min.js",
}


def _key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:20]


def cutout_cached(photo: str) -> dict | None:
    """The car cut out of a photo ({rgba, box, clipped, method}), from the cache when it's been
    done before. Used for studio photos and as the car's outline for mod previews."""
    from .vision.cutout import cutout

    folder = MEDIA / "cutouts"
    key = _key(photo, CUTOUT_VERSION)
    png, meta = folder / f"{key}.png", folder / f"{key}.json"
    if png.exists() and meta.exists():
        info = json.loads(meta.read_text())
        return {**info, "rgba": Image.open(png)} if info.get("found") else None
    found = cutout(Image.open(store.media_path(photo)).convert("RGB"))
    folder.mkdir(parents=True, exist_ok=True)
    if found is None:
        meta.write_text(json.dumps({"found": False}))
        return None
    found["rgba"].save(png)
    meta.write_text(json.dumps({"found": True, "box": found["box"], "clipped": found["clipped"], "method": found["method"]}))
    return found


def studio(photo: str, backdrop: str) -> dict:
    """{url, clipped, method} for this photo on this backdrop. Raises ValueError without a car."""
    from .vision.studio import BACKDROPS, compose

    if backdrop not in BACKDROPS:
        raise ValueError(f"Unknown backdrop: {backdrop}")
    if not store.media_path(photo).exists():
        raise ValueError("That photo isn't in the garage any more.")
    key = _key(photo, backdrop, STUDIO_VERSION)
    out = MEDIA / "studio" / f"{key}.jpg"
    meta = out.with_suffix(".json")
    if out.exists() and meta.exists():
        return {"url": f"/media/studio/{key}.jpg", **json.loads(meta.read_text())}
    cut = cutout_cached(photo)
    if cut is None:
        raise ValueError("No car found in that photo.")
    img = compose(cut["rgba"], cut["box"], cut["clipped"], backdrop)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=92)
    info = {"clipped": cut["clipped"], "method": cut["method"], "source": photo, "backdrop": backdrop}
    meta.write_text(json.dumps(info))
    return {"url": f"/media/studio/{key}.jpg", **info}


# ---------- The kit ----------

def _name(identity: dict) -> str:
    year = identity.get("year") or (identity["yearFrom"] if identity.get("yearFrom") == identity.get("yearTo") else None)
    trim = identity.get("trim")
    return " ".join(str(p) for p in (year, identity.get("make"), identity.get("model"), trim) if p)


def _money(n) -> str:
    return f"${int(n):,}" if n not in (None, "") else ""


def _specs(car: dict) -> dict | None:
    from .specs import sheet

    i = car.get("identity") or {}
    try:
        return sheet.build(i.get("year") or i.get("yearTo"), i["make"], i["model"], i.get("variant"), i.get("vin"))
    except Exception:  # no EPA match (very old or rare cars): the kit goes out without a spec table
        return None


def _page(car: dict, sell: dict, specs: dict | None, photos: list[str], has_3d: bool) -> str:
    e = html.escape
    identity = car.get("identity") or {}
    name = _name(identity)
    title = car.get("nickname") if sell.get("useNickname") and car.get("nickname") else name
    facts = []
    if sell.get("mileage"):
        facts.append(("Mileage", f"{int(sell['mileage']):,} mi"))
    for group in (specs or {}).get("groups", []):
        for item in group["items"]:
            if item["label"] in ("Engine", "Transmission", "Drive", "Combined", "Range") and len(facts) < 6:
                facts.append((item["label"], item["value"]))
    if car.get("color"):
        facts.append(("Colour", car["color"]["name"]))
    gallery = "".join(
        f'<button class="thumb{" on" if i == 0 else ""}" data-src="{e(p)}"><img src="{e(p)}" alt="Photo {i + 1}" loading="lazy"></button>'
        for i, p in enumerate(photos))
    spec_rows = ""
    for group in (specs or {}).get("groups", []):
        rows = "".join(f"<tr><th>{e(i['label'])}</th><td>{e(i['value'])}</td></tr>" for i in group["items"])
        spec_rows += f'<section class="specs"><h3>{e(group["title"])}</h3><table>{rows}</table></section>'
    recalls = (specs or {}).get("recalls")
    recall_note = ""
    if recalls:
        recall_note = (f'<p class="note">NHTSA lists {len(recalls)} recall campaign{"s" if len(recalls) != 1 else ""} for this model year. '
                       "Ask for the car's recall status by VIN at nhtsa.gov/recalls.</p>")
    pins = [p for p in ((car.get("condition") or {}).get("pins") or []) if not p.get("fixed")]
    known = ""
    if sell.get("includeCondition") and pins:
        items = "".join(f"<li><strong>{e(p['kind'].title())}</strong>{': ' + e(p['note']) if p.get('note') else ''}</li>" for p in pins)
        known = f'<section><h2>Known marks</h2><ul class="marks">{items}</ul></section>'
    listing = "".join(f"<p>{e(par)}</p>" for par in (sell.get("listing") or "").split("\n\n") if par.strip())
    from .capture.record import showing

    capture = showing(car)
    viewer = ""
    if has_3d:
        cfg = {"matrix": capture["transform"], "size": capture["size"], "front": capture.get("front", 1)}
        viewer = f'''<section><h2>See it in 3D</h2><p class="muted">Drag to turn it, scroll or pinch to zoom.</p>
<div id="viewer" data-config='{e(json.dumps(cfg))}'><div class="loading">Loading the 3D model…</div></div></section>'''
    price = _money(sell.get("price"))
    sources = ""
    if specs:
        nhtsa = specs.get("recalls") is not None or specs.get("ratings")
        sources = f"Specifications from fueleconomy.gov (US EPA){' and NHTSA' if nhtsa else ''}. "
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}{" · " + price if price else ""}</title>
<meta name="description" content="{e(name)} for sale{' · ' + price if price else ''}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2318181d'/%3E%3Cg fill='%23d9d9e0'%3E%3Crect x='11' y='10' width='8' height='15' rx='2'/%3E%3Crect x='45' y='10' width='8' height='15' rx='2'/%3E%3Crect x='11' y='39' width='8' height='15' rx='2'/%3E%3Crect x='45' y='39' width='8' height='15' rx='2'/%3E%3C/g%3E%3Cg stroke='%23ff6a1f' stroke-width='4.5' stroke-linecap='round' fill='none'%3E%3Cpath d='M25 8v48M39 8v48'/%3E%3Cpath d='M19 17.5h26M25 32h14M19 46.5h26'/%3E%3C/g%3E%3C/svg%3E">
<style>
:root{{--ink:#141416;--muted:#5f6068;--rule:#e4e4e8;--accent:#ff6a1f;--bg:#fafaf9}}
*{{box-sizing:border-box}}body{{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:var(--ink);background:var(--bg)}}
main{{max-width:1100px;margin:0 auto;padding:40px 20px 64px}}
h1{{margin:0;font-size:clamp(30px,5vw,52px);line-height:1.05;letter-spacing:-.02em}}
h2{{margin:48px 0 12px;font-size:22px}}h3{{margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}}
.top{{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px}}
.price{{font-size:clamp(26px,4vw,40px);font-weight:800}}
.facts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;margin:24px 0;background:var(--rule);border:1px solid var(--rule);border-radius:12px;overflow:hidden}}
.facts div{{padding:14px 16px;background:#fff}}.facts dt{{font-size:12px;color:var(--muted)}}.facts dd{{margin:2px 0 0;font-weight:650}}
.hero{{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:14px;background:#eee}}
.thumbs{{display:flex;gap:8px;margin-top:10px;overflow-x:auto}}.thumb{{flex:none;width:110px;padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;background:none;cursor:pointer}}
.thumb.on{{border-color:var(--accent)}}.thumb img{{display:block;width:100%;aspect-ratio:3/2;object-fit:cover}}
.listing p{{max-width:70ch}}
.specgrid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}}
table{{width:100%;border-collapse:collapse}}th,td{{padding:7px 0;border-top:1px solid var(--rule);text-align:left;vertical-align:top}}th{{width:45%;font-weight:500;color:var(--muted)}}
.note{{padding:12px 14px;background:#fff4ec;border-left:3px solid var(--accent);border-radius:6px}}
.marks{{padding-left:20px}}.muted{{color:var(--muted)}}
#viewer{{position:relative;height:min(70vh,560px);border-radius:14px;overflow:hidden;background:#0a0a0c}}#viewer canvas{{display:block;width:100%;height:100%}}
.loading{{position:absolute;inset:0;display:grid;place-items:center;color:#aaa}}
footer{{margin-top:56px;padding-top:16px;border-top:1px solid var(--rule);font-size:13px;color:var(--muted)}}
</style></head>
<body><main>
<div class="top"><div><h1>{e(title)}</h1>{f'<p class="muted">{e(name)}</p>' if title != name else ""}</div>{f'<div class="price">{price}</div>' if price else ""}</div>
<dl class="facts">{"".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in facts)}</dl>
{f'<img class="hero" id="hero" src="{e(photos[0])}" alt="{e(name)}"><div class="thumbs">{gallery}</div>' if photos else ""}
{f'<section class="listing"><h2>About this car</h2>{listing}</section>' if listing else ""}
{known}
{viewer}
{f'<section><h2>Specifications</h2><div class="specgrid">{spec_rows}</div>{recall_note}</section>' if spec_rows else ""}
<footer>{sources}Made with Chassis.</footer>
</main>
<script>
document.querySelectorAll('.thumb').forEach(b=>b.addEventListener('click',()=>{{document.getElementById('hero').src=b.dataset.src;document.querySelectorAll('.thumb').forEach(t=>t.classList.toggle('on',t===b))}}));
</script>
{'<script type="importmap">{"imports":{"three":"./js/three.module.js","three/addons/":"./js/addons/"}}</script><script type="module" src="./js/viewer.js"></script>' if has_3d else ""}
</body></html>'''


VIEWER_JS = """import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from './spark.module.min.js';

const box = document.getElementById('viewer');
const { matrix, size, front } = JSON.parse(box.dataset.config);
const [L, H] = size;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
box.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a0c');
scene.add(new SparkRenderer({ renderer }));
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
camera.position.set(L * 0.78, H * 0.95, L * 0.86);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, H * 0.45, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.minDistance = L * 0.45;
controls.maxDistance = L * 3.2;
renderer.domElement.addEventListener('pointerdown', () => (controls.autoRotate = false));
const floor = new THREE.Mesh(new THREE.CircleGeometry(Math.max(L, size[2]) * 2.4, 64), new THREE.MeshBasicMaterial({ color: '#0d0d10' }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const car = new SplatMesh({ url: './3d/car.ply', onLoad: () => box.querySelector('.loading')?.remove() });
const m = new THREE.Matrix4().set(...matrix);
if (front === -1) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
car.matrixAutoUpdate = false;
car.matrix.copy(m);
scene.add(car);
function resize() {
  const w = box.clientWidth, h = box.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
"""

README = """{name}: listing kit made with Chassis

Open it: this is a small website. Put the folder on any static host (GitHub Pages,
Netlify Drop, your own server) and share the link. To look at it on this computer, run
this inside the folder and open http://localhost:8000:

    python3 -m http.server 8000

(Double-clicking index.html shows the photos and text, but browsers won't load the 3D
model from a file on disk.)

Contents: index.html (the listing), photos/ (studio photos){extra}
"""


def build_kit(car: dict) -> tuple[bytes, str]:
    """The kit as a zip (bytes) and a file name for it."""
    sell = car.get("sell") or {}
    sources = sell.get("photos") or car.get("photos") or ([car["photo"]] if car.get("photo") else [])
    from .capture.record import showing

    capture = showing(car)
    has_3d = bool(capture.get("status") == "done" and capture.get("splat") and capture.get("transform")
                  and store.media_path(capture["splat"]).exists() and all(p.exists() for p in VIEWER_FILES.values()))
    specs = _specs(car)
    name = _name(car.get("identity") or {}) or "car"
    slug = "-".join("".join(c if c.isalnum() else " " for c in name.lower()).split()) or "car"

    buf = io.BytesIO()
    photos = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, url in enumerate(sources, 1):
            path = store.media_path(url)
            if path.exists():
                rel = f"photos/{i:02d}{path.suffix.lower()}"
                z.write(path, f"{slug}/{rel}", compress_type=zipfile.ZIP_STORED)
                photos.append(rel)
        if has_3d:
            z.write(store.media_path(capture["splat"]), f"{slug}/3d/car.ply")
            for rel, src in VIEWER_FILES.items():
                z.write(src, f"{slug}/{rel}")
            z.writestr(f"{slug}/js/viewer.js", VIEWER_JS)
            for licence, src in (("js/LICENSE-three.txt", NODE / "three/LICENSE"),
                                 ("js/LICENSE-spark.txt", NODE / "@sparkjsdev/spark/LICENSE")):
                if src.exists():
                    z.write(src, f"{slug}/{licence}")
        z.writestr(f"{slug}/index.html", _page(car, sell, specs, photos, has_3d))
        extra = ", 3d/car.ply (the 3D model) and js/ (the viewer: three.js and Spark, MIT licence)" if has_3d else ""
        z.writestr(f"{slug}/README.txt", README.format(name=name, extra=extra))
    return buf.getvalue(), f"{slug}-listing.zip"
