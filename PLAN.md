# Chassis: build plan

Take a photo of a real car, and Chassis tells you what it is and everything about it. Film a 30-second walk-around, and it rebuilds the car as a photoreal 3D model you can spin, restyle, inspect, sell and park in your own virtual garage. Runs locally on a Mac; personal use.

The old concept configurator (Atlas GT) lives in `prototype/` for reference.

---

## 1. The site, end to end

One product, one design language, every page linked from every other.

| Page | URL | What it does |
|---|---|---|
| **Home** | `#/` | The front door. A captured car turning in 3D behind the pitch; what you can do; your garage at a glance; how accurate it is; where the data comes from. |
| **Snap** | `#/snap` | Snap & Spec. Drop or take a photo (optionally the VIN). Get make, model, year range, colour and a full spec card in seconds. Add it to your garage or to your spotted cars. |
| **Spotter** | `#/spotter` | Street mode. Live camera (laptop, or phone over the local network), tap to identify, keep a collection of every car you've spotted. |
| **Garage** | `#/garage` | Your cars parked side by side in a 3D garage (to scale), plus a list view. |
| **Car** | `#/car/<id>` | One car, in tabs: **360** (photoreal capture with spec hotspots) · **Specs** (full sheet, recalls, crash ratings, running costs) · **Mods** (paint, wheels, tint) · **Condition** (damage pins and before/after reports) · **Sell** (listing kit). |
| **Capture** | `#/car/<id>/capture` | Upload a walk-around video and watch it become a 3D model, step by step. Shooting guide included. |
| **About** | `#/about` | How each part works, what's measured vs. estimated, accuracy numbers, data sources and licences. |

Shared everywhere: header (logo → Home, nav, About), footer, one empty state per page that tells you the next step, hash links per page so back/forward and sharing work.

---

## 2. Features and how they work

### 2.1 Snap & Spec (photo → identity → specs)
1. **Find the car**: YOLO11 segmentation finds the largest car and its outline; everything else is cropped away.
2. **Identify**: SigLIP (Google's image–text model, run locally) compares the crop with text descriptions of every make and model sold in the US since 1984 (from the EPA database), then narrows to a year range. Returns the top matches with confidence so you can pick if it's wrong.
3. **Colour**: median colour of the body pixels (glass, tyres and shadows excluded), mapped to a paint name.
4. **VIN (optional, exact)**: OCR reads a photo of the windshield plate or door sticker; the VIN check digit picks the right reading and fixes look-alike characters (O/0, I/1, S/5, B/8). NHTSA's decoder then gives the exact year, trim, engine and plant.
5. **Specs**: merged from free U.S. government sources, each value labelled with where it came from:
   - EPA fuel economy database: engine, cylinders, displacement, transmission, drive, MPG, range, fuel type, yearly fuel cost, CO₂, size class.
   - NHTSA vPIC (VIN decode): trim, horsepower when listed, body, plant.
   - NHTSA recalls and NCAP crash ratings.
6. **Honest output**: "Looks like a 2016–2018 Honda Civic (82%)" with alternatives, never a confident guess presented as fact.

### 2.2 Spotter
Same pipeline, tuned for speed: live camera → identify → a card in your **Spotted** collection (photo, name, year range, headline specs, when). Phone use over the home network via a local HTTPS address (phones only allow the camera on secure pages).

### 2.3 Walk-around → Showroom 360
1. **Frames**: ffmpeg pulls ~200 frames from the video; blurry ones are dropped.
2. **Masks**: YOLO11 segmentation outlines the car in every frame.
3. **Camera positions**: COLMAP (pycolmap) works out where the phone was for each frame.
4. **3D model**: Brush trains a Gaussian splat on the Mac's GPU (Metal).
5. **Clean-up**: keep only the car (the masks vote on which splats belong to it), stand it upright (the camera path circles the car, so its plane gives "up"), centre it, compress for the web.
6. **Viewer**: Spark renders it in the browser on a studio floor; **hotspots** (wheels, lights, badge, engine) are placed by projecting the car-parts model's detections from the frames into 3D. Tap one for the matching spec.

### 2.4 One photo → 3D (AI guess)
For cars you can't walk around: an image-to-3D model generates a full model from a single photo. The unseen sides are invented, so it's labelled "AI guess" everywhere. Candidates, in order: run-on-Mac open models (TripoSR, SF3D, Hunyuan3D mini); paid APIs (Meshy, Tripo) only with your own key.

### 2.5 Mod preview
- **Car-parts model**: YOLO11 segmentation trained here on the Ultralytics car-parts dataset (wheels, windows, lights, doors, bumpers, mirrors…). It powers mods, hotspots and condition pins.
- **Photo mods**: repaint (colour and finish; brightness is kept so reflections stay), wheel finish (black, gunmetal, bronze, chrome), window tint, all with a before/after slider. Save looks to the car.
- **3D mods**: repaint the capture itself by recolouring the splats that belong to the paint.

### 2.6 Condition report
- **Pins**: tap the 3D model or a photo to pin a scratch or dent with a note and close-up photo.
- **Before/after**: take the same views again (rental return, after a parking lot); photos are aligned and differences are highlighted.
- **Damage detection** (optional): a damage model trained on a public dataset you download (e.g. CarDD); without it, reports use pins and before/after.
- Export a dated report.

### 2.7 Sell-my-car kit
Studio photos (car cut out with BiRefNet, placed on a clean backdrop with a soft shadow), spec sheet, the 360, and a written listing built from the specs plus what you enter (mileage, condition, price, extras). Export as a self-contained folder you can host anywhere.

### 2.8 Virtual garage
A 3D garage with every car parked side by side: captured cars as their splats, others as a stand-in body in their colour, all scaled to real size (measured, or typical for the EPA size class). Click a car to open it; compare two side by side.

---

## 3. Architecture

```
web/      React 18 + TypeScript + Vite · three.js + React Three Fiber · Spark (splats) · zustand
server/   Python 3.10 (Apple Silicon) · FastAPI · PyTorch (MPS) · Ultralytics YOLO11 · open_clip (SigLIP)
          EasyOCR · pycolmap · Brush (binary) · BiRefNet · SQLite (EPA data, API cache)
data/     your cars, photos, captures, spotted cars (local, not in git)
tools/    downloaded binaries (Brush)
```

- The browser talks to the local API (`/api/...`, proxied by Vite). Long jobs (3D capture, training the parts model) run in the background with progress streamed to the page.
- Government APIs are cached in SQLite so pages load instantly the second time and work offline.
- `npm run dev` starts both servers; `Start Garage.command` does the same with a double-click.

### Data model (data/garage.json + files)
- **Car**: id, nickname, identity (year/range, make, model, trim, VIN, confidence, source), colour, specs (with sources), photos, capture (status, splat, hotspots, scale), looks (saved mods), condition (pins, reports), listing.
- **Spotted**: id, photo, identity, colour, headline specs, time.

---

## 4. Build order (each step ends working end to end)

| # | Step | Done when |
|---|---|---|
| 0 | **Foundation**: app shell, design system, Home, About, routing, API skeleton, local store, one-command start | Site runs, every page reachable, empty states guide you |
| 1 | **Snap & Spec**: EPA import, car detection, SigLIP identification, colour, VIN OCR + decode, recalls, ratings, spec card, add to garage | A photo becomes a spec card; accuracy measured on a public test set |
| 2 | **Spotter**: camera capture, spotted collection, phone over local HTTPS | Point, tap, card saved |
| 3 | **Walk-around 360**: frames, masks, COLMAP, Brush, clean-up, Spark viewer, hotspots, job progress | Your walk-around video becomes a spinnable car with hotspots |
| 4 | **Car-parts model + Mods**: train parts segmentation, photo mods, splat repaint | Before/after slider on your car |
| 5 | **Condition**: pins, before/after alignment, report export, optional damage model | A dated report with pins and highlighted changes |
| 6 | **Sell kit**: studio cut-outs, listing writer, static export | A folder you can open or host |
| 7 | **Virtual garage**: 3D garage, to-scale cars, compare | All cars parked, click to open |
| 8 | **One photo → 3D** | An "AI guess" model from a single photo |
| 9 | **Measure, test, document**: accuracy numbers, tests, README end to end | README matches the product |

## 5. Risks and how they're handled
- **Shiny paint and glass** confuse 3D capture → shooting guide (overcast/shade, slow loop, two heights), masks, and honest failure messages.
- **Exact year/trim from a photo** is often impossible (same body for years) → show a range; the VIN gives the exact answer.
- **No horsepower in EPA data** → from VIN decode when NHTSA lists it, otherwise shown as unknown, never guessed.
- **16 GB memory** → frame count and image size are capped; one heavy job at a time.
- **Licences**: EPA/NHTSA data is public domain; SigLIP (Apache 2.0), YOLO11 (AGPL-3.0, fine for personal use), Brush (Apache 2.0), Spark (MIT). Captures and photos stay on this computer.
