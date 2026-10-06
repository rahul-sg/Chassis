# Garage 360

A separate, local 3D car configuration prototype with an original **Atlas GT** concept model.

## Open it

Double-click **Start Garage.command**, then open **http://localhost:4311**. Keep Terminal open while using the app; Control-C stops the server.

**Open Garage.html** remains an optional standalone fallback.

For development with Node 18 or newer:

```sh
npm run dev
```

Open http://127.0.0.1:4311. No npm install is needed. `PORT=4321 npm run dev` selects another port. Run `npm run build` after editing source files to regenerate the standalone launcher; `npm run check` checks JavaScript syntax.

## Included

- 360° orbit, zoom, front/rear presets, and a modeled cockpit view.
- Six paints, a metallic/matte color treatment, and three visible wheel/spoke designs.
- Touring, Sport and Track packages with caliper and spoiler/wing changes.
- Animated door panels and night/day/warm studio background settings.
- Selectable hotspots for wheels/brakes, powertrain, aerodynamics and cabin information.
- A fictional build-cost breakdown and budget comparison.
- Save, load and remove up to 30 builds in this browser's local storage. No cloud account or synchronization.
- Keyboard camera controls and responsive desktop/mobile layout.

Save builds on a consistent browser and origin. File-based browser storage behavior varies; use the development server for a stable origin. If storage is unavailable, the app reports that saves are limited to the current session. Clearing browser data removes local saves.

## Source

- `dist/index.html` and `dist/style.css` — interface.
- `dist/app.js` — concept mesh, configuration, component details, budget and saved builds.
- `dist/scene.js` — dependency-free WebGL renderer and orbit controls.
- `server.mjs` — localhost-only development server.
- `build.mjs` — rebuilds the standalone HTML launcher.

The geometry is an original procedural design, not a licensed manufacturer model. Paint treatments are simplified color/lighting changes, not physically accurate material simulation. Lighting presets change the studio background. Doors are independent animated panels rather than manufacturer-accurate hinges. All prices are **fictional planning examples**. No horsepower, tuning, acceleration or downforce estimates are calculated.

## Next development stages

1. Introduce a high-quality, properly licensed glTF model and material-based paint finishes.
2. Add physical studio lights, environment reflections and exact door pivots.
3. Connect vehicle/component records with sourced prices and compatibility data.
4. Introduce performance estimates only with a defensible model and validation.

## Verification

JavaScript syntax and standalone bundle parsing passed. A Node smoke harness checked configuration changes and invalid input, budget math, camera state, door state, and saving/loading/removing builds. Its DOM and WebGL calls were mocked. **Browser visual QA is outstanding** because local preview servers and browser access were unavailable in this session. Optional WebMCP registration is feature-detected but has not been validated in a supported browser context.
