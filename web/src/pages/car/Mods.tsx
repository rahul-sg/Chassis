import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { go } from '../../lib/route';
import { useGarage } from '../../lib/store';
import type { Car, Look } from '../../lib/types';
import { BeforeAfter } from '../../ui/BeforeAfter';

const PAINTS = [
  { name: 'Chalk white', hex: '#e8e6df' },
  { name: 'Cement grey', hex: '#8d9196' },
  { name: 'Graphite', hex: '#3a3d42' },
  { name: 'Gloss black', hex: '#141416' },
  { name: 'Race red', hex: '#c1121f' },
  { name: 'Papaya', hex: '#ff7a1a' },
  { name: 'Sunburst yellow', hex: '#f2c12e' },
  { name: 'Lime', hex: '#9bd12a' },
  { name: 'British green', hex: '#1f4d36' },
  { name: 'Gulf blue', hex: '#7fb4d9' },
  { name: 'Riviera blue', hex: '#1e88e5' },
  { name: 'Midnight blue', hex: '#1a2340' },
  { name: 'Royal purple', hex: '#5b2a86' },
  { name: 'Champagne', hex: '#c9b58c' },
];
const FINISHES = ['gloss', 'satin', 'matte'] as const;
const WHEELS = [
  { id: null, name: 'As is' },
  { id: 'black', name: 'Gloss black' },
  { id: 'gunmetal', name: 'Gunmetal' },
  { id: 'bronze', name: 'Bronze' },
  { id: 'silver', name: 'Silver' },
  { id: 'gold', name: 'Gold' },
];

interface Preview {
  url: string;
  applied: { paint: boolean; wheels: boolean; tint: boolean; partsModel: boolean };
}

export function CarMods({ car }: { car: Car }) {
  const updateCar = useGarage((s) => s.updateCar);
  const photos = car.photos?.length ? car.photos : car.photo ? [car.photo] : [];
  const [photo, setPhoto] = useState(photos[0] ?? null);
  const [paint, setPaint] = useState(car.color ?? PAINTS[0]);
  const [finish, setFinish] = useState<(typeof FINISHES)[number]>('gloss');
  const [wheel, setWheel] = useState<string | null>(null);
  const [tint, setTint] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!photo) return;
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.post<Preview>(`/cars/${car.id}/mods`, { photo, paint: paint.hex, finish, wheel, tint: tint / 100 });
        if (n === seq.current) {
          setPreview(r);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError((e as Error).message);
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [car.id, photo, paint, finish, wheel, tint]);

  if (!photos.length)
    return (
      <div className="empty">
        <p>Mods are previewed on a photo of your car. Add one first: a side or three-quarter view works best.</p>
        <button className="btn btn--accent" onClick={() => go({ page: 'car', id: car.id, tab: '360' })}>
          Add photos
        </button>
      </div>
    );

  const partsReady = preview?.applied.partsModel ?? false;
  const saveLook = async () => {
    if (!preview || !photo) return;
    const look: Look = {
      id: Math.random().toString(36).slice(2, 10),
      name: `${paint.name}${finish !== 'gloss' ? ` ${finish}` : ''}${wheel ? `, ${WHEELS.find((w) => w.id === wheel)?.name.toLowerCase()} wheels` : ''}${tint ? `, ${tint}% tint` : ''}`,
      photo,
      image: preview.url,
      paint,
      finish,
      wheel,
      tint: tint / 100,
      createdAt: Date.now() / 1000,
    };
    await updateCar(car.id, { looks: [look, ...(car.looks ?? [])] });
  };

  return (
    <div className="mods">
      <div className="mods__stage">
        {photo && <BeforeAfter before={photo} after={preview?.url ?? null} busy={busy} />}
        {error && <p className="note note--bad">{error}</p>}
        {photos.length > 1 && (
          <div className="thumbs" role="group" aria-label="Photo">
            {photos.map((p) => (
              <button key={p} className={p === photo ? 'is-on' : ''} onClick={() => setPhoto(p)}>
                <img src={p} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="mods__panel">
        <section>
          <h3 className="field__label">Paint</h3>
          <div className="swatches">
            {PAINTS.map((p) => (
              <button
                key={p.hex}
                className="swatchbtn"
                style={{ background: p.hex }}
                aria-pressed={paint.hex === p.hex}
                title={p.name}
                aria-label={p.name}
                onClick={() => setPaint(p)}
              />
            ))}
            <label className="swatchbtn swatchbtn--custom" title="Any colour">
              <input type="color" value={paint.hex} onChange={(e) => setPaint({ name: 'Custom', hex: e.target.value })} aria-label="Custom colour" />
            </label>
          </div>
          <p className="mods__name">{paint.name}</p>
        </section>
        <section>
          <h3 className="field__label">Finish</h3>
          <div className="seg" role="group" aria-label="Finish">
            {FINISHES.map((f) => (
              <button key={f} aria-pressed={finish === f} onClick={() => setFinish(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </section>
        <section className={partsReady ? '' : 'is-locked'}>
          <h3 className="field__label">Wheels</h3>
          <div className="chips">
            {WHEELS.map((w) => (
              <button key={w.name} className="chip" aria-pressed={wheel === w.id} disabled={!partsReady} onClick={() => setWheel(w.id)}>
                {w.name}
              </button>
            ))}
          </div>
        </section>
        <section className={partsReady ? '' : 'is-locked'}>
          <h3 className="field__label">Window tint · {tint}%</h3>
          <input className="range" type="range" min={0} max={90} step={5} value={tint} disabled={!partsReady} onChange={(e) => setTint(Number(e.target.value))} />
        </section>
        {!partsReady && (
          <p className="muted mods__locked">
            Wheel and tint previews need the car-parts model, which finds wheels and windows. Set it up once from{' '}
            <a href="#/about">How it works</a>.
          </p>
        )}
        <div className="actions">
          <button className="btn btn--accent" disabled={!preview || busy} onClick={saveLook}>
            Save this look
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setPaint(car.color ?? PAINTS[0]);
              setFinish('gloss');
              setWheel(null);
              setTint(0);
            }}
          >
            Reset
          </button>
        </div>
      </aside>
      {(car.looks?.length ?? 0) > 0 && (
        <section className="looks">
          <h2 className="subhead">Saved looks</h2>
          <div className="looks__grid">
            {car.looks!.map((l) => (
              <figure key={l.id}>
                <img src={l.image} alt={l.name} loading="lazy" />
                <figcaption>
                  <span>
                    <i className="spot__paint" style={{ background: l.paint.hex }} /> {l.name}
                  </span>
                  <button className="btn btn--ghost btn--sm" onClick={() => void updateCar(car.id, { looks: car.looks!.filter((x) => x.id !== l.id) })}>
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
