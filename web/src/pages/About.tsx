import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { go } from '../lib/route';
import type { Job } from '../lib/types';
import { JobProgress } from '../ui/JobProgress';

interface Setup {
  partsModel: boolean;
  brush: boolean;
  triposr: boolean;
  triposrWeights: boolean;
  birefnet: boolean;
  epa: { vehicles: number; families: number; yearFrom: number; yearTo: number } | null;
  partsJob: Job | null;
}

/** Measured on 2026-10-06 on an M1 Pro (server/tools/eval_identify.py --skip 600). */
const ACCURACY = {
  images: 600,
  classes: 177,
  top1: '81%',
  top5: '97%',
  make: '96%',
  yearInRange: '86%',
  yearSpan: '4.6',
  seconds: '0.8',
};

const STAGES = [
  {
    name: 'Snap & Spec',
    what: 'Finds the car in your photo, then compares it with every model family in the EPA’s records and picks the closest, with a likely range of model years.',
    how: 'YOLO11 segmentation finds the car · SigLIP (So400m) compares it with 1,454 EPA model families, then with each model year',
    figure: `${ACCURACY.top1} exact model and ${ACCURACY.top5} in the top five, on ${ACCURACY.images} test photos it was never tuned on`,
  },
  {
    name: 'VIN',
    what: 'Reads the VIN from a photo of the windscreen plate or door sticker, checks it the way the VIN standard does, and has NHTSA decode it. A decoded VIN beats any photo guess.',
    how: 'EasyOCR · check digit and model-year code · NHTSA vPIC decoder',
  },
  {
    name: 'Spec sheet',
    what: 'Engine, gearbox, drive, fuel economy, running cost, size class, crash ratings and recalls, each shown with where it came from.',
    how: 'EPA fueleconomy.gov data, stored on this Mac · NHTSA recalls and NCAP ratings, cached so they work offline',
  },
  {
    name: 'Walk-around 360',
    what: 'A 30–60 second video becomes a photoreal 3D model. The sharpest frames are picked, the car is outlined in each, the camera’s path is worked out, and a Gaussian splat is trained on the car alone, then cleaned up and scaled to real size.',
    how: 'ffmpeg · YOLO11 masks · COLMAP (pycolmap) · Brush splat training · clean-up and scaling',
    figure: 'Test truck: 150 of 150 frames placed, 124,000 splats, about 16 minutes of training on an M1 Pro',
  },
  {
    name: 'One photo → 3D',
    what: 'For cars without a video: an AI sketch of the 3D shape from a single photo. It can’t see the far side, so that side is invented; it’s always labelled as a guess.',
    how: 'BiRefNet cut-out · TripoSR',
    figure: 'About 25 seconds once the model is downloaded',
  },
  {
    name: 'Mods',
    what: 'Repaints the car in your photo while keeping its reflections and shadows, with gloss, satin or matte finishes, wheel colours and window tint.',
    how: 'Colour moved in Lab space, weighted by how much each pixel is paint · a car-parts model trained here for wheels, glass and lights',
    figure: 'Car-parts model: 0.70 mask accuracy (mAP50) on photos it didn’t train on',
  },
  {
    name: 'Condition',
    what: 'Pins damage on the 3D model or a photo, and compares a new photo with an old one from the same spot: they’re lined up and anything that changed is outlined. It points out places to look; it doesn’t diagnose damage.',
    how: 'ORB features and a homography, then dense optical flow · an edge comparison that ignores depth edges',
  },
  {
    name: 'Sell kit',
    what: 'Studio photos with the background replaced, a listing written from the spec data and your details, and a small website with the photos, specs and 3D model to host anywhere.',
    how: 'BiRefNet cut-outs · rule-based writing, so nothing is made up · three.js and Spark viewer',
  },
  {
    name: 'Virtual garage',
    what: 'Every car parked side by side at real size: measured from its scan, from the length you entered, or typical for its EPA size class.',
    how: 'React Three Fiber · Spark',
  },
];

const SOURCES = [
  { name: 'EPA fuel economy data', use: 'Model list, specs, economy, size class', licence: 'U.S. government work, public domain' },
  { name: 'NHTSA vPIC, Recalls, NCAP', use: 'VIN decoding, recalls, crash ratings', licence: 'U.S. government work, public domain' },
  { name: 'YOLO11 (Ultralytics)', use: 'Finding cars; the car-parts model', licence: 'AGPL-3.0' },
  { name: 'Ultralytics car-parts dataset', use: 'Training the car-parts model', licence: 'CC BY 4.0' },
  { name: 'SigLIP So400m (Google)', use: 'Identifying the model', licence: 'Apache 2.0' },
  { name: 'EasyOCR', use: 'Reading VINs', licence: 'Apache 2.0' },
  { name: 'COLMAP / pycolmap', use: 'Camera positions for the 3D', licence: 'BSD' },
  { name: 'Brush', use: 'Training the 3D splats', licence: 'Apache 2.0' },
  { name: 'BiRefNet', use: 'Cut-outs for studio photos and mods', licence: 'MIT' },
  { name: 'TripoSR (Tripo AI, Stability AI)', use: 'One photo → 3D', licence: 'MIT' },
  { name: 'three.js, Spark', use: 'Showing the 3D in the browser', licence: 'MIT' },
  { name: 'Stanford Cars', use: 'Measuring identification only, not training', licence: 'Research use' },
];

function Engine() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    api
      .get<Setup>('/setup')
      .then(setSetup)
      .catch(() => setError('The local engine isn’t running. Start everything with npm run dev.'));
  useEffect(() => {
    void refresh();
  }, []);
  if (error) return <p className="note note--bad">{error}</p>;
  if (!setup) return <div className="sheet sheet--loading" />;
  const training = !!setup.partsJob && ['queued', 'running'].includes(setup.partsJob.status);
  const rows = [
    {
      name: 'Spec data (EPA)',
      ok: !!setup.epa,
      state: setup.epa ? `${setup.epa.vehicles.toLocaleString()} vehicles, ${setup.epa.yearFrom}–${setup.epa.yearTo}` : 'Downloads on first start',
    },
    { name: '3D splat trainer (Brush)', ok: setup.brush, state: setup.brush ? 'Installed' : 'Not installed: run bash scripts/setup.sh' },
    { name: 'Cut-out model (BiRefNet)', ok: setup.birefnet, state: setup.birefnet ? 'Installed' : 'Downloads on first use, about 170 MB' },
    {
      name: 'One-photo 3D (TripoSR)',
      ok: setup.triposr && setup.triposrWeights,
      state: !setup.triposr ? 'Not installed: run bash scripts/setup.sh' : setup.triposrWeights ? 'Installed' : 'Downloads on first use, about 1.6 GB',
    },
    { name: 'Car-parts model', ok: setup.partsModel, state: setup.partsModel ? 'Trained' : training ? 'Training…' : 'Not set up' },
  ];
  return (
    <div className="engine">
      <ul className="engine__list">
        {rows.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            <span className={`status ${r.ok ? 'status--ok' : ''}`}>{r.state}</span>
          </li>
        ))}
      </ul>
      {!setup.partsModel && !training && (
        <div className="engine__setup">
          <p>
            Wheel and tint previews need the car-parts model. It’s trained here, once: it downloads about 3,800 labelled photos (CC BY 4.0)
            and takes about two hours on an M1 Pro, in the background.
          </p>
          <button
            className="btn btn--accent"
            onClick={async () => {
              await api.post('/setup/parts', {});
              await refresh();
            }}
          >
            Set up the car-parts model
          </button>
        </div>
      )}
      {training && setup.partsJob && (
        <JobProgress
          jobId={setup.partsJob.id}
          titles={{ running: 'Training the car-parts model', done: 'Car-parts model ready', failed: 'Training stopped' }}
        />
      )}
    </div>
  );
}

export function About() {
  return (
    <div className="page wrap about">
      <header className="page__head">
        <div>
          <p className="eyebrow">How it works</p>
          <h1 className="display">Under the hood</h1>
          <p>
            Everything runs on this Mac: the models, the 3D building and your garage. Here’s what each part does, how well it does it, and
            where the data comes from.
          </p>
        </div>
      </header>

      <section className="section" aria-labelledby="stages-title">
        <h2 className="subhead" id="stages-title">
          The parts
        </h2>
        <ol className="stages">
          {STAGES.map((s, i) => (
            <li key={s.name}>
              <span className="stages__n">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{s.name}</h3>
                <p>{s.what}</p>
                <p className="stages__how">{s.how}</p>
                {s.figure && <p className="stages__figure">{s.figure}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="accuracy-title">
        <h2 className="subhead" id="accuracy-title">
          How accurate is identification?
        </h2>
        <p className="about__lead">
          Measured on {ACCURACY.images} photos from the Stanford Cars test set ({ACCURACY.classes} models sold in the U.S.), none of which
          were used to tune it. Each photo goes through the same steps as yours.
        </p>
        <dl className="figures">
          <div>
            <dt>Exact make and model</dt>
            <dd>{ACCURACY.top1}</dd>
          </div>
          <div>
            <dt>In the top five</dt>
            <dd>{ACCURACY.top5}</dd>
          </div>
          <div>
            <dt>Right make</dt>
            <dd>{ACCURACY.make}</dd>
          </div>
          <div>
            <dt>Year inside the range given</dt>
            <dd>{ACCURACY.yearInRange}</dd>
          </div>
        </dl>
        <p className="muted">
          Year ranges average {ACCURACY.yearSpan} years; a VIN or your own pick makes the year exact. The match percentage means what it
          says: matches shown at 95% or more were right 98% of the time, and those at 50–80% about three times in four. About{' '}
          {ACCURACY.seconds} s a photo on an M1 Pro.
        </p>
      </section>

      <section className="section" aria-labelledby="engine-title">
        <h2 className="subhead" id="engine-title">
          On this Mac
        </h2>
        <Engine />
      </section>

      <section className="section" aria-labelledby="privacy-title">
        <h2 className="subhead" id="privacy-title">
          What leaves this Mac
        </h2>
        <ul className="privacy">
          <li>
            <strong>Stays here:</strong> your photos, videos, 3D models, garage, condition records and listings.
          </li>
          <li>
            <strong>Goes out:</strong> VINs to NHTSA’s decoder, and make, model and year to NHTSA for recalls and ratings. Models download from
            Hugging Face and GitHub the first time they’re needed.
          </li>
          <li>
            <strong>Phone mode</strong> (<code>npm run phone</code>) opens the site to devices on your own Wi-Fi, over this Mac’s own
            certificate.
          </li>
        </ul>
      </section>

      <section className="section" aria-labelledby="sources-title">
        <h2 className="subhead" id="sources-title">
          Data and models
        </h2>
        <div className="tablewrap">
          <table className="licences">
            <thead>
              <tr>
                <th>Source</th>
                <th>Used for</th>
                <th>Licence</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.use}</td>
                  <td>{s.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section about__cta">
        <h2 className="display">Try it on your car</h2>
        <button className="btn btn--accent btn--lg" onClick={() => go({ page: 'snap' })}>
          Snap a car
        </button>
      </section>
    </div>
  );
}
