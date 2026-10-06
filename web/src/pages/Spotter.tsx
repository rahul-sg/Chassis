import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { go } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { Identity, Spotted } from '../lib/types';
import { fetchSpecs, identifyPhoto } from '../lib/vehicle';
import { Camera, type CameraHandle } from '../ui/Camera';
import { Dialog } from '../ui/Dialog';
import { SpecSheetView } from '../ui/SpecSheetView';

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function SpottedCard({ s, onOpen }: { s: Spotted; onOpen: () => void }) {
  return (
    <button className="spot" onClick={onOpen}>
      <img src={s.photo} alt="" loading="lazy" />
      <span className="spot__body">
        <span className="spot__name">{carName(s.identity)}</span>
        <span className="spot__meta">
          {s.color && <i className="spot__paint" style={{ background: s.color.hex }} title={s.color.name} />}
          {s.headline?.map((h) => h.value).join(' · ') || s.color?.name}
        </span>
        <span className="spot__time">{ago(s.createdAt)}</span>
      </span>
    </button>
  );
}

export function Spotter() {
  const spotted = useGarage((s) => s.spotted);
  const addSpotted = useGarage((s) => s.addSpotted);
  const removeSpotted = useGarage((s) => s.removeSpotted);
  const addCar = useGarage((s) => s.addCar);
  const cam = useRef<CameraHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const [camState, setCamState] = useState<string>('starting');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Spotted | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [open, setOpen] = useState<Spotted | null>(null);
  const [sort, setSort] = useState<'new' | 'make'>('new');
  const [lan, setLan] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ lan: string[] }>('/health')
      .then((h) => setLan(h.lan[0] ?? null))
      .catch(() => undefined);
  }, []);

  const spot = async (blob: Blob | null) => {
    if (!blob) return;
    setBusy(true);
    setMiss(null);
    try {
      const r = await identifyPhoto(blob);
      const top = r.candidates[0];
      if (!r.found || !top) {
        setMiss('No car in that shot. Get the whole car in the frame and try again.');
        return;
      }
      const identity: Identity = {
        make: top.make,
        model: top.model,
        yearFrom: top.yearFrom,
        yearTo: top.yearTo,
        year: top.year,
        confidence: top.confidence,
        source: 'photo',
        alternatives: r.candidates.slice(1, 4).map(({ make, model, yearFrom, yearTo, confidence }) => ({ make, model, yearFrom, yearTo, confidence })),
      };
      let headline;
      try {
        const sheet = await fetchSpecs({ year: top.year ?? top.yearTo, make: top.make, model: top.model });
        headline = sheet.groups
          .flatMap((g) => g.items)
          .filter((i) => ['Engine', 'Combined', 'Range'].includes(i.label))
          .slice(0, 2);
      } catch {
        headline = undefined;
      }
      setLast(await addSpotted({ photo: r.photo, identity, color: r.color, headline }));
    } catch (e) {
      setMiss((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = useMemo(
    () => (sort === 'new' ? spotted : [...spotted].sort((a, b) => carName(a.identity, false).localeCompare(carName(b.identity, false)))),
    [spotted, sort],
  );
  const makes = new Set(spotted.map((s) => s.identity.make));
  const top = [...makes].map((m) => [m, spotted.filter((s) => s.identity.make === m).length] as const).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="page wrap spotter">
      <header className="page__head">
        <div>
          <p className="eyebrow">Spotter</p>
          <h1 className="display">Spot every car</h1>
          <p>Point the camera at a car and tap. Each one you spot is saved here with what it is and its headline specs.</p>
        </div>
        {spotted.length > 0 && (
          <dl className="tally">
            <div>
              <dt>Spotted</dt>
              <dd>{spotted.length}</dd>
            </div>
            <div>
              <dt>Makes</dt>
              <dd>{makes.size}</dd>
            </div>
            {top && (
              <div>
                <dt>Most seen</dt>
                <dd>{top[0]}</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <div className="spotter__live">
        <div className="spotter__cam">
          <Camera ref={cam} onState={setCamState} />
          <div className="spotter__bar">
            <button className="shutter" disabled={busy || camState !== 'live'} onClick={async () => spot(await cam.current!.grab())} aria-label="Spot this car">
              <span />
            </button>
            <button className="btn btn--ghost" disabled={busy} onClick={() => file.current?.click()}>
              Add a photo instead
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void spot(f ?? null);
              }}
            />
          </div>
        </div>
        <aside className="spotter__side">
          {busy && <p className="spotter__status">Identifying…</p>}
          {miss && <p className="note">{miss}</p>}
          {last && !busy && (
            <div className="spotter__last">
              <p className="eyebrow">Just spotted</p>
              <img src={last.photo} alt="" />
              <h2 className="display">{carName(last.identity)}</h2>
              <p className="muted">
                {Math.round((last.identity.confidence ?? 0) * 100)}% match{last.color ? ` · ${last.color.name}` : ''}
              </p>
              <div className="actions">
                <button className="btn" onClick={() => setOpen(last)}>
                  Specs
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={async () => {
                    await removeSpotted(last.id);
                    setLast(null);
                  }}
                >
                  Undo
                </button>
              </div>
            </div>
          )}
          {!last && !busy && !miss && (
            <div className="spotter__help">
              <h2 className="subhead">On your phone</h2>
              <p>
                Spotter works best on the street. On this Mac run <code>npm run phone</code>, then on your phone (same Wi-Fi) open{' '}
                <code>https://{lan ?? 'this-mac'}:4312/#/spotter</code>. Accept the certificate warning once: it’s this Mac’s own certificate.
              </p>
            </div>
          )}
        </aside>
      </div>

      <section className="section spotter__list" aria-labelledby="spotted-title">
        <header className="section__head section__head--row">
          <h2 className="subhead" id="spotted-title">
            Your collection
          </h2>
          {spotted.length > 1 && (
            <div className="seg" role="group" aria-label="Sort">
              <button aria-pressed={sort === 'new'} onClick={() => setSort('new')}>
                Newest
              </button>
              <button aria-pressed={sort === 'make'} onClick={() => setSort('make')}>
                By make
              </button>
            </div>
          )}
        </header>
        {list.length ? (
          <div className="spots">
            {list.map((s) => (
              <SpottedCard key={s.id} s={s} onOpen={() => setOpen(s)} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <p>Nothing spotted yet. Tap the shutter with a car in view, or add a photo.</p>
          </div>
        )}
      </section>

      {open && (
        <Dialog title={carName(open.identity)} onClose={() => setOpen(null)} wide>
          <div className="spotdetail">
            <img src={open.photo} alt="" />
            <div className="actions">
              <button
                className="btn btn--accent"
                onClick={async () => {
                  const car = await addCar({ identity: open.identity, color: open.color, photo: open.photo, photos: [open.photo] });
                  go({ page: 'car', id: car.id, tab: 'specs' });
                }}
              >
                Add to my garage
              </button>
              <button
                className="btn btn--ghost"
                onClick={async () => {
                  await removeSpotted(open.id);
                  if (last?.id === open.id) setLast(null);
                  setOpen(null);
                }}
              >
                Remove from collection
              </button>
            </div>
            <SpecSheetView year={open.identity.year ?? open.identity.yearTo} make={open.identity.make} model={open.identity.model} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
