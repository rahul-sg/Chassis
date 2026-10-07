import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { go } from '../../lib/route';
import { useGarage } from '../../lib/store';
import type { Capture, Car } from '../../lib/types';
import { GuessViewer } from '../../three/GuessViewer';
import { SplatViewer, type Marker } from '../../three/SplatViewer';
import { JobProgress } from '../../ui/JobProgress';

export const GUIDE = [
  { title: 'Soft light', text: 'An overcast day or open shade. Low sun puts moving reflections on glossy paint, and they come out as blotches.' },
  { title: 'Whole car in frame', text: 'Hold the phone sideways (landscape) and stand about 2 m (6 ft) back, so the whole car stays in the picture all the way round.' },
  { title: 'Two slow loops', text: 'One loop at chest height, then one crouched lower. 30–60 seconds in all; slow is better than fast.' },
  { title: 'Keep it steady', text: 'Walk, don’t pivot on the spot. No zooming. Clear space round the car; people walking through briefly is fine.' },
];

function Photos({ car }: { car: Car }) {
  const updateCar = useGarage((s) => s.updateCar);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photos = car.photos ?? (car.photo ? [car.photo] : []);
  return (
    <section className="photos">
      <header className="photos__head">
        <h2 className="subhead">Photos</h2>
        <button className="btn btn--sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Adding…' : 'Add photos'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (!files.length) return;
            setBusy(true);
            try {
              const urls = await Promise.all(files.map((f) => api.upload<{ url: string }>('/media', f, {}, f.name).then((r) => r.url)));
              await updateCar(car.id, { photos: [...photos, ...urls], photo: car.photo ?? urls[0] });
            } finally {
              setBusy(false);
            }
          }}
        />
      </header>
      {photos.length ? (
        <div className="photos__grid">
          {photos.map((p) => (
            <figure key={p} className={p === car.photo ? 'is-cover' : ''}>
              <img src={p} alt="" loading="lazy" />
              <figcaption>
                {p === car.photo ? (
                  <span className="badge badge--good">Cover</span>
                ) : (
                  <button className="btn btn--ghost btn--sm" onClick={() => void updateCar(car.id, { photo: p })}>
                    Make cover
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    const rest = photos.filter((x) => x !== p);
                    void updateCar(car.id, { photos: rest, photo: car.photo === p ? rest[0] : car.photo });
                  }}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="muted">No photos yet. Photos are used for mods, the condition record and the listing.</p>
      )}
    </section>
  );
}

function specValues(car: Car, labels: string[]) {
  const items = car.specs?.groups.flatMap((g) => g.items) ?? [];
  return labels.map((l) => items.find((i) => i.label === l)).filter((i): i is NonNullable<typeof i> => !!i);
}

/** Spec hotspots placed on the car's bounding box (front is +x). */
function markers(car: Car, cap: Capture): Marker[] {
  const [L, H, W] = cap.size!;
  const list = (labels: string[]) => {
    const v = specValues(car, labels);
    return v.length ? (
      <dl className="hotspot__specs">
        {v.map((i) => (
          <div key={i.label}>
            <dt>{i.label}</dt>
            <dd>{i.value}</dd>
          </div>
        ))}
      </dl>
    ) : (
      <p className="muted">Open the Specs tab to load the spec sheet.</p>
    );
  };
  return [
    { id: 'engine', at: [L * 0.36, H * 0.72, 0], label: 'Engine', body: list(['Engine', 'Horsepower', 'Fuel', 'Electric motor']) },
    { id: 'wheel', at: [L * 0.31, H * 0.28, W * 0.52], label: 'Wheels and drive', body: list(['Drive', 'Transmission']) },
    { id: 'lights', at: [L * 0.49, H * 0.5, W * 0.33], label: 'Crash ratings', body: list(['Overall', 'Frontal crash', 'Side crash', 'Rollover']) },
    { id: 'cabin', at: [-L * 0.04, H * 1.02, 0], label: 'Body', body: list(['Size class', 'Body', 'Doors', 'Trim']) },
    { id: 'rear', at: [-L * 0.5, H * 0.55, 0], label: 'Fuel and running costs', body: list(['Combined', 'Range', 'Fuel cost', 'CO₂']) },
  ];
}

/** The 3D model. readOnly while it's the earlier model shown during a retake (edits would go to the new one). */
function Showroom({ car, cap, readOnly = false }: { car: Car; cap: Capture; readOnly?: boolean }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [editing, setEditing] = useState(false);
  const [length, setLength] = useState(String(cap.length ?? ''));
  const [L, H, W] = cap.size!;
  const front = cap.front ?? 1;
  const setCapture = (patch: Partial<NonNullable<Car['capture']>>) => updateCar(car.id, { capture: { ...cap, ...patch } });
  return (
    <section className="showroom">
      <SplatViewer
        url={cap.splat!}
        matrix={cap.transform!}
        size={cap.size!}
        front={front}
        core={cap.core}
        markers={markers(car, cap)}
        overlay={
          !readOnly && (
            <button className="btn btn--sm" onClick={() => void setCapture({ front: front === 1 ? -1 : 1 })}>
              Front and back swapped?
            </button>
          )
        }
      />
      <div className="showroom__info">
        <dl className="showroom__dims">
          <div>
            <dt>Length</dt>
            <dd>{L.toFixed(2)} m</dd>
          </div>
          <div>
            <dt>Width</dt>
            <dd>{W.toFixed(2)} m</dd>
          </div>
          <div>
            <dt>Height</dt>
            <dd>{H.toFixed(2)} m</dd>
          </div>
        </dl>
        <div className="muted showroom__scale">
          {cap.lengthSource === 'you'
            ? 'Scaled to the length you entered.'
            : cap.lengthSource === 'camera'
              ? 'Scaled from the height you filmed at (a phone at chest height), so within a few percent.'
              : 'Scaled to a typical length for its size class, so only roughly.'}{' '}
          {readOnly ? null : editing ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number(length);
                if (!(v > 2 && v < 8)) return;
                const k = v / L;
                const m = cap.transform!.map((x, i) => (i < 12 ? x * k : x));
                void setCapture({ transform: m, size: [L * k, H * k, W * k], length: v, lengthSource: 'you' });
                setEditing(false);
              }}
            >
              <input className="input" value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" aria-label="Length in metres" />
              <span>m</span>
              <button className="btn btn--sm">Save</button>
            </form>
          ) : (
            <button className="linkbtn" onClick={() => setEditing(true)}>
              Enter the exact length
            </button>
          )}
        </div>
        {cap.stats && (
          <p className="muted">
            Built on this Mac in {cap.stats.minutes} min from {cap.stats.placed} of {cap.stats.frames} frames, {cap.stats.splats.toLocaleString()} splats
            {cap.stats.turntable ? ' (turntable video)' : ''}.
          </p>
        )}
        {!readOnly && (
          <div className="showroom__again">
            <span className="muted">Not happy with how it came out? A new video replaces it once it’s built; until then this one stays.</span>
            <button className="btn btn--sm" onClick={() => go({ page: 'car', id: car.id, tab: 'capture' })}>
              Film it again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** One photo → 3D: a quick AI guess at the shape, for cars without a walk-around. */
function QuickGuess({ car }: { car: Car }) {
  const load = useGarage((s) => s.load);
  const photos = car.photos?.length ? car.photos : car.photo ? [car.photo] : [];
  const guess = car.guess;
  const [photo, setPhoto] = useState<string | undefined>(guess?.photo ?? photos[0]);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const busy = guess?.status === 'queued' || guess?.status === 'running';

  const start = async () => {
    setError(null);
    try {
      await api.post(`/cars/${car.id}/guess`, { photo });
      setAgain(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const picker = (
    <div className="guess__pick">
      <div className="thumbs" role="group" aria-label="Photo to use">
        {photos.map((p) => (
          <button key={p} className={p === photo ? 'is-on' : ''} onClick={() => setPhoto(p)}>
            <img src={p} alt="" />
          </button>
        ))}
      </div>
      <button className="btn btn--accent" disabled={!photo} onClick={start}>
        Guess the 3D shape
      </button>
      {error && <p className="note note--bad">{error}</p>}
    </div>
  );

  if (guess?.status === 'done' && guess.model && !again)
    return (
      <section className="guess">
        <GuessViewer url={guess.model} />
        <div className="guess__foot">
          <p className="muted">
            An AI model (TripoSR) guessed this shape from one photo. It never saw the other side, so that part is invented: treat it as a
            sketch. A walk-around video gives you the real car.
          </p>
          {photos.length > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={() => setAgain(true)}>
              Try another photo
            </button>
          )}
        </div>
      </section>
    );
  if ((busy || guess?.status === 'failed') && guess?.job && !again)
    return (
      <section className="guess">
        <JobProgress jobId={guess.job} titles={{ running: 'Guessing the 3D shape', done: '3D guess ready', failed: 'The guess didn’t work' }} />
      </section>
    );
  return (
    <section className="guess guess--offer">
      <div>
        <p className="eyebrow">No video? Quick look</p>
        <h2 className="subhead">A 3D guess from one photo</h2>
        <p className="muted">
          An AI model sketches the car in 3D from a single photo in a few minutes. The side it can’t see is made up, so it’s a rough
          preview, not a scan. Side or three-quarter photos with the whole car in view work best.
        </p>
      </div>
      {photos.length ? picker : <p className="muted">Add a photo of the car below first.</p>}
    </section>
  );
}

type ReadyCapture = Capture & { status: 'done'; splat: string; transform: number[]; size: [number, number, number] };
const ready = (c?: Capture | null): c is ReadyCapture => !!(c && c.status === 'done' && c.splat && c.transform && c.size);

export function Car360({ car }: { car: Car }) {
  const capture = car.capture;
  if (ready(capture))
    return (
      <div className="car360">
        {capture.retakeError && (
          <p className="note">
            The new video didn’t make a model, so this is still the earlier one. {capture.retakeError}{' '}
            <button className="linkbtn" onClick={() => go({ page: 'car', id: car.id, tab: 'capture' })}>
              Try another video
            </button>
          </p>
        )}
        <Showroom car={car} cap={capture} />
        <Photos car={car} />
      </div>
    );
  // Filmed again: the earlier model stays on show while the new one is built.
  if (ready(car.previousCapture) && (capture?.status === 'queued' || capture?.status === 'running' || capture?.status === 'paused'))
    return (
      <div className="car360">
        <div className={`rebuild ${capture.status === 'paused' ? 'rebuild--ask' : ''}`}>
          <span className="rebuild__dot" aria-hidden />
          <p>
            {capture.status === 'paused'
              ? 'Your new video needs a quick look before the 3D model is built. Until then, this is the earlier one.'
              : 'Building a new 3D model from your new video. Until it’s ready, this is the earlier one.'}
          </p>
          <button className="btn btn--sm" onClick={() => go({ page: 'car', id: car.id, tab: 'capture' })}>
            {capture.status === 'paused' ? 'Take a look' : 'See progress'}
          </button>
        </div>
        <Showroom car={car} cap={car.previousCapture} readOnly />
        <Photos car={car} />
      </div>
    );
  const guessed = car.guess?.status === 'done';
  return (
    <div className="car360">
      {guessed && <QuickGuess car={car} />}
      {!capture || capture.status === 'failed' ? (
        <section className="capture-cta">
          <div className="capture-cta__copy">
            <p className="eyebrow">Walk-around 360</p>
            <h2 className="display">See this car in 3D</h2>
            <p>
              Film a short walk-around and it becomes a photoreal 3D model you can spin, zoom into and tap for specs. It’s built on this Mac
              and takes about 15–30 minutes.
            </p>
            {capture?.status === 'failed' && <p className="note note--bad">The last capture didn’t work: {capture.error}</p>}
            <button className="btn btn--accent btn--lg" onClick={() => go({ page: 'car', id: car.id, tab: 'capture' })}>
              {capture ? 'Try another video' : 'Add a walk-around video'}
            </button>
          </div>
          <ol className="guide">
            {GUIDE.map((g, i) => (
              <li key={g.title}>
                <span className="steps__n">0{i + 1}</span>
                <h3>{g.title}</h3>
                <p>{g.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="capture-cta">
          <div className="capture-cta__copy">
            <p className="eyebrow">Walk-around 360</p>
            <h2 className="display">{capture.status === 'paused' ? 'Your video needs a quick look' : 'Building the 3D model'}</h2>
            <button className="btn" onClick={() => go({ page: 'car', id: car.id, tab: 'capture' })}>
              {capture.status === 'paused' ? 'Take a look' : 'See progress'}
            </button>
          </div>
        </section>
      )}
      {!guessed && <QuickGuess car={car} />}
      <Photos car={car} />
    </div>
  );
}
