import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { specValue } from '../lib/listing';
import { go, href } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { SpecSheet } from '../lib/types';
import { fetchSpecs } from '../lib/vehicle';
import { GarageScene, label, type SceneCar } from '../three/GarageScene';
import { CarThumb } from '../ui/CarThumb';

type View = '3d' | 'list';
const VIEW_KEY = 'garage.view';
const SOURCE = { scan: 'measured from its 3D scan', you: 'from the length you entered', class: 'typical for its size class' };
const ROWS = ['Engine', 'Transmission', 'Drive', 'Combined', 'Range', 'Fuel cost', 'Size class', 'Overall'];

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : '3d';
  } catch {
    return '3d';
  }
}

function useSheet(car: SceneCar) {
  const [sheet, setSheet] = useState<SpecSheet | null>(null);
  const i = car.identity;
  useEffect(() => {
    if (!i) return;
    let live = true;
    fetchSpecs({ year: i.year ?? i.yearTo, make: i.make, model: i.model, variant: i.variant, vin: i.vin })
      .then((s) => live && setSheet(s))
      .catch(() => live && setSheet(null));
    return () => {
      live = false;
    };
  }, [i]);
  return sheet;
}

/** Two cars side by side: real sizes as bars, then their spec sheets row by row. */
function Compare({ a, b }: { a: SceneCar; b: SceneCar }) {
  const sa = useSheet(a);
  const sb = useSheet(b);
  const dims: [string, number][] = [
    ['Length', 0],
    ['Width', 1],
    ['Height', 2],
  ];
  const rows = ROWS.filter((r) => specValue(sa, r) || specValue(sb, r));
  return (
    <section className="compare2" aria-label="Comparison">
      <div className="compare2__head">
        <span />
        {[a, b].map((c) => (
          <a key={c.id} href={href({ page: 'car', id: c.id, tab: 'specs' })}>
            {label(c)}
          </a>
        ))}
      </div>
      {dims.map(([name, k]) => {
        const max = Math.max(a.size[k], b.size[k]);
        return (
          <div key={name} className="compare2__row">
            <span>{name}</span>
            {[a, b].map((c) => (
              <span key={c.id} className="compare2__bar">
                <span className="compare2__track">
                  <i style={{ width: `${(c.size[k] / max) * 100}%` }} />
                </span>
                <b>{c.size[k].toFixed(2)} m</b>
              </span>
            ))}
          </div>
        );
      })}
      {rows.map((r) => (
        <div key={r} className="compare2__row">
          <span>{r}</span>
          <span>{specValue(sa, r) ?? '—'}</span>
          <span>{specValue(sb, r) ?? '—'}</span>
        </div>
      ))}
      <p className="muted compare2__note">
        Sizes: {label(a)} {SOURCE[a.sizeSource]}; {label(b)} {SOURCE[b.sizeSource]}.
      </p>
    </section>
  );
}

export function Garage() {
  const cars = useGarage((s) => s.cars);
  const loaded = useGarage((s) => s.loaded);
  const [view, setView] = useState<View>(savedView);
  const [scene, setScene] = useState<SceneCar[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // The scene is made again whenever a car changes (a new scan, a new colour, a new car).
  const version = cars.map((c) => `${c.id}:${c.updatedAt ?? c.createdAt}`).join(',');
  useEffect(() => {
    if (!cars.length) return;
    let live = true;
    api
      .get<SceneCar[]>('/garage/scene')
      .then((s) => live && setScene(s))
      .catch(() => live && setScene([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };
  const pick = (id: string) => {
    if (!comparing) return go({ page: 'car', id, tab: '360' });
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  };
  const pair = useMemo(() => {
    if (!scene || picked.length !== 2) return null;
    const [a, b] = picked.map((id) => scene.find((c) => c.id === id));
    return a && b ? ([a, b] as const) : null;
  }, [scene, picked]);
  const shown = comparing && pair ? [...pair] : scene ?? [];

  return (
    <div className="page wrap garage">
      <header className="page__head">
        <div>
          <p className="eyebrow">My garage</p>
          <h1 className="display">{cars.length ? `${cars.length} car${cars.length > 1 ? 's' : ''}` : 'Your garage'}</h1>
          <p>Every car you add lives here with its specs, its 3D model, mods you’ve tried, its condition record and a listing kit.</p>
        </div>
        <button className="btn btn--accent" onClick={() => go({ page: 'identify' })}>
          Add a car
        </button>
      </header>

      {loaded && cars.length === 0 && (
        <div className="empty">
          <p>No cars yet. Photograph yours, or enter its VIN or make and model, and it lands here with its spec sheet.</p>
          <button className="btn btn--accent" onClick={() => go({ page: 'identify' })}>
            Add your first car
          </button>
        </div>
      )}

      {cars.length > 0 && (
        <div className="garage__bar">
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === '3d'} onClick={() => choose('3d')}>
              3D garage
            </button>
            <button aria-pressed={view === 'list'} onClick={() => choose('list')}>
              List
            </button>
          </div>
          {view === '3d' && cars.length > 1 && (
            <button
              className={`btn btn--sm ${comparing ? 'btn--accent' : ''}`}
              onClick={() => {
                setComparing((c) => !c);
                setPicked([]);
              }}
            >
              {comparing ? 'Done comparing' : 'Compare two cars'}
            </button>
          )}
        </div>
      )}

      {cars.length > 0 && view === '3d' && (
        <>
          {comparing && (
            <div className="garage__pick">
              <p className="muted">{picked.length < 2 ? `Pick ${picked.length ? 'one more car' : 'two cars'} to compare:` : 'Comparing:'}</p>
              <div className="chips">
                {(scene ?? []).map((c) => (
                  <button key={c.id} className="chip" aria-pressed={picked.includes(c.id)} onClick={() => pick(c.id)}>
                    {label(c)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {scene === null ? (
            <div className="viewer viewer--garage viewer--wait">
              <span>Opening the garage…</span>
            </div>
          ) : (
            <GarageScene cars={shown} picked={picked} onPick={pick} />
          )}
          {!comparing && <p className="muted garage__hint">Cars are to scale. Click one to open it; drag to look around.</p>}
          {comparing && pair && <Compare a={pair[0]} b={pair[1]} />}
        </>
      )}

      {cars.length > 0 && view === 'list' && (
        <div className="cars cars--garage">
          {cars.map((c) => {
            const has3d = c.capture?.status === 'done';
            const working = c.capture && ['queued', 'running'].includes(c.capture.status);
            const asking = c.capture?.status === 'paused';
            return (
              <a key={c.id} className="carcard" href={href({ page: 'car', id: c.id, tab: '360' })}>
                <CarThumb car={c} />
                <span className="carcard__name">{c.nickname || carName(c.identity)}</span>
                <span className="carcard__meta">{c.nickname ? carName(c.identity) : c.color?.name ?? ''}</span>
                <span className={`badge ${has3d ? 'badge--good' : working ? 'badge--busy' : asking ? 'badge--ask' : ''}`}>
                  {has3d ? '3D model ready' : working ? 'Building 3D model…' : asking ? 'Video needs a look' : 'No 3D model yet'}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
