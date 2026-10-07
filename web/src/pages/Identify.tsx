import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { go, href } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { Identity, PaintColor, SpecSheet, Spotted } from '../lib/types';
import { catalog, fetchSpecs, headlineSpecs, identifyPhoto, identityFrom, type IdentifyResult, type VinResult } from '../lib/vehicle';
import { Camera, type CameraHandle } from '../ui/Camera';
import { Detection } from '../ui/Detection';
import { ManualPicker } from '../ui/ManualPicker';
import { PhotoDrop } from '../ui/PhotoDrop';
import { SpecSheetView } from '../ui/SpecSheetView';
import { SpottedCard, SpottedDialog } from '../ui/Spotted';
import { VinEntry } from '../ui/VinEntry';

const STEPS = ['Finding the car', 'Comparing it with every model since 1984', 'Narrowing down the years', 'Reading the paint'];

/**
 * How the photo comes in: a photo from the library, one shot from the camera (both open the full
 * result), or quick spotting, which keeps the camera open and logs each car to Spotted.
 */
type Mode = 'photo' | 'camera' | 'quick';

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

function useSteps(active: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return setI(0);
    const t = setInterval(() => setI((x) => Math.min(STEPS.length - 1, x + 1)), 1400);
    return () => clearInterval(t);
  }, [active]);
  return i;
}

function YearSelect({ identity, onYear }: { identity: Identity; onYear: (y: number) => void }) {
  const [years, setYears] = useState<number[]>([]);
  useEffect(() => {
    void catalog.years(identity.make, identity.model).then((y) => setYears([...y].reverse()));
  }, [identity.make, identity.model]);
  const likely = (y: number) => y >= identity.yearFrom && y <= identity.yearTo;
  return (
    <label className="field field--inline">
      <span className="field__label">Model year</span>
      <select className="select" value={identity.year ?? ''} onChange={(e) => onYear(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
            {identity.source === 'photo' && likely(y) ? ' · likely' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** How to open this page on a phone, where spotting makes most sense. */
function PhoneTip() {
  const [lan, setLan] = useState<string | null>(null);
  useEffect(() => {
    void api
      .get<{ lan: string[] }>('/health')
      .then((h) => setLan(h.lan[0] ?? null))
      .catch(() => undefined);
  }, []);
  return (
    <div className="identify__help">
      <h2 className="subhead">On your phone</h2>
      <p>
        Quick spotting works best on the street. On this Mac run <code>npm run phone</code>, then on your phone (same Wi-Fi) open{' '}
        <code>https://{lan ?? 'this-mac'}:4312/#/identify/quick</code>. Accept the certificate warning once: it’s this Mac’s own certificate.
      </p>
    </div>
  );
}

export function Identify({ quick: startQuick = false }: { quick?: boolean }) {
  const addCar = useGarage((s) => s.addCar);
  const spotted = useGarage((s) => s.spotted);
  const addSpotted = useGarage((s) => s.addSpotted);
  const updateSpotted = useGarage((s) => s.updateSpotted);
  const removeSpotted = useGarage((s) => s.removeSpotted);
  const [mode, setMode] = useState<Mode>(() => (startQuick ? 'quick' : touch() ? 'camera' : 'photo'));
  const cam = useRef<CameraHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const [camState, setCamState] = useState<string>('starting');

  // One car, in full.
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [color, setColor] = useState<PaintColor | undefined>();
  const [sheet, setSheet] = useState<SpecSheet | null>(null);
  const [panel, setPanel] = useState<'vin' | 'manual' | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null); // this car's entry in Spotted
  const run = useRef(0);
  const step = useSteps(busy);

  // Quick spotting.
  const [spotting, setSpotting] = useState(false);
  const [last, setLast] = useState<Spotted | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [open, setOpen] = useState<Spotted | null>(null);

  const reset = () => {
    run.current++;
    setPreview(null);
    setResult(null);
    setIdentity(null);
    setColor(undefined);
    setSheet(null);
    setError(null);
    setPanel(null);
    setSavedId(null);
  };

  const analyse = async (photo: Blob) => {
    reset();
    const mine = run.current;
    setPreview(URL.createObjectURL(photo));
    setBusy(true);
    try {
      const r = await identifyPhoto(photo);
      if (mine !== run.current) return;
      setResult(r);
      setColor(r.color);
      const found = identityFrom(r);
      if (found) {
        setIdentity(found);
        // Every car identified from a photo goes into Spotted; corrections below update the entry.
        void addSpotted({ photo: r.photo, identity: found, color: r.color })
          .then((s) => mine === run.current && setSavedId(s.id))
          .catch(() => undefined);
      }
    } catch (e) {
      if (mine === run.current) setError((e as Error).message);
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };

  // Keep the Spotted entry in step with what the car turned out to be (another match, the year,
  // the VIN), and with its headline figures once the spec sheet for that car has loaded.
  useEffect(() => {
    if (!savedId || !identity) return;
    const fits = sheet && sheet.make === identity.make && sheet.model === identity.model && sheet.year === identity.year;
    void updateSpotted(savedId, { identity, color, ...(fits ? { headline: headlineSpecs(sheet) } : {}) }).catch(() => undefined);
  }, [savedId, identity, color, sheet, updateSpotted]);

  const spot = async (photo: Blob | null) => {
    if (!photo) return;
    setSpotting(true);
    setMiss(null);
    try {
      const r = await identifyPhoto(photo);
      const found = identityFrom(r);
      if (!found) {
        setMiss('No car in that shot. Get the whole car in the frame and try again.');
        return;
      }
      let headline;
      try {
        headline = headlineSpecs(await fetchSpecs({ year: found.year ?? found.yearTo, make: found.make, model: found.model }));
      } catch {
        headline = undefined;
      }
      setLast(await addSpotted({ photo: r.photo, identity: found, color: r.color, headline }));
    } catch (e) {
      setMiss((e as Error).message);
    } finally {
      setSpotting(false);
    }
  };

  const take = (photo: Blob | null) => (mode === 'quick' ? spot(photo) : photo ? analyse(photo) : undefined);

  const fromVin = (v: VinResult) => {
    if (!v.family) return;
    setIdentity({
      make: v.family.make,
      model: v.family.model,
      yearFrom: v.family.year,
      yearTo: v.family.year,
      year: v.family.year,
      vin: v.vin,
      trim: v.trim ?? undefined,
      source: 'vin',
    });
    setPanel(null);
  };

  const choose = (c: { make: string; model: string; yearFrom: number; yearTo: number; confidence: number }) =>
    identity &&
    setIdentity({
      ...identity,
      make: c.make,
      model: c.model,
      yearFrom: c.yearFrom,
      yearTo: c.yearTo,
      year: c.yearTo,
      confidence: c.confidence,
      variant: undefined,
      alternatives: [
        { make: identity.make, model: identity.model, yearFrom: identity.yearFrom, yearTo: identity.yearTo, confidence: identity.confidence ?? 0 },
        ...(identity.alternatives ?? []).filter((a) => a.make !== c.make || a.model !== c.model),
      ],
    });

  const toGarage = async (status?: 'considering') => {
    if (!identity) return;
    const car = await addCar({
      identity: { ...identity, variant: sheet?.variant },
      color,
      photo: result?.photo,
      photos: result?.photo ? [result.photo] : [],
      specs: sheet ?? undefined,
      status,
    });
    go({ page: 'car', id: car.id, tab: status ? 'buying' : 'specs' });
  };

  const pct = identity?.confidence != null ? Math.round(identity.confidence * 100) : null;
  const years = identity
    ? identity.source !== 'photo' && identity.year
      ? `${identity.year}`
      : identity.yearFrom === identity.yearTo
        ? `${identity.yearFrom}`
        : `${identity.yearFrom}–${String(identity.yearTo).slice(-2)}`
    : '';

  const picker = (
    <ManualPicker
      initial={identity ?? undefined}
      onPick={(p) => {
        setIdentity({ make: p.make, model: p.model, yearFrom: p.year, yearTo: p.year, year: p.year, source: 'manual' });
        setPanel(null);
      }}
    />
  );

  const showing = preview || identity;

  // Beside the camera: the car just spotted, or how to spot from a phone.
  let side: ReactNode = null;
  if (mode === 'quick' && (spotting || miss || last)) {
    side = (
      <>
        {spotting && <p className="identify__status">Identifying…</p>}
        {miss && <p className="note">{miss}</p>}
        {last && !spotting && (
          <div className="identify__last">
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
      </>
    );
  } else if (!touch()) {
    side = <PhoneTip />;
  }

  return (
    <div className="page wrap identify">
      <header className="page__head">
        <div>
          <p className="eyebrow">Identify</p>
          <h1 className="display">What car is that?</h1>
          <p>
            Photograph a car, or point the camera at one. You get the make, model, years and colour, then the full spec sheet. Every car you
            identify is kept in <a href={href({ page: 'spotted' })}>Spotted</a>.
          </p>
        </div>
        {showing && (
          <button className="btn" onClick={reset}>
            Identify another
          </button>
        )}
      </header>

      {!showing && (
        <>
          <div className="identify__modes">
            <div className="seg" role="group" aria-label="How to add the car">
              <button aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}>
                Photo
              </button>
              <button aria-pressed={mode === 'camera'} onClick={() => setMode('camera')}>
                Camera
              </button>
              <button aria-pressed={mode === 'quick'} onClick={() => setMode('quick')}>
                Quick spotting
              </button>
            </div>
            <p className="muted">
              {mode === 'quick'
                ? 'The camera stays open: point, tap, next car. Each one is saved to Spotted.'
                : mode === 'camera'
                  ? 'Take one shot and get the full result.'
                  : 'Drop or choose a photo and get the full result.'}
            </p>
          </div>

          <div className={`identify__live ${side ? '' : 'identify__live--solo'}`}>
            <div>
              {mode === 'photo' ? (
                <PhotoDrop onFile={analyse} />
              ) : (
                <div className="identify__cam">
                  <Camera ref={cam} onState={setCamState} />
                  <div className="identify__bar">
                    <button
                      className="shutter"
                      disabled={spotting || camState !== 'live'}
                      onClick={async () => take((await cam.current?.grab()) ?? null)}
                      aria-label={mode === 'quick' ? 'Spot this car' : 'Identify this car'}
                    >
                      <span />
                    </button>
                    <button className="btn btn--ghost" disabled={spotting} onClick={() => file.current?.click()}>
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
                        void take(f ?? null);
                      }}
                    />
                  </div>
                </div>
              )}
              {mode !== 'quick' && (
                <>
                  <div className="identify__alt">
                    <button className="btn btn--ghost" onClick={() => setPanel(panel === 'vin' ? null : 'vin')} aria-expanded={panel === 'vin'}>
                      I have the VIN
                    </button>
                    <button
                      className="btn btn--ghost"
                      onClick={() => setPanel(panel === 'manual' ? null : 'manual')}
                      aria-expanded={panel === 'manual'}
                    >
                      Pick make and model myself
                    </button>
                  </div>
                  {panel && <section className="panelbox">{panel === 'vin' ? <VinEntry onFound={fromVin} /> : picker}</section>}
                </>
              )}
            </div>
            {side && <aside className="identify__side">{side}</aside>}
          </div>

          {spotted.length > 0 && (
            <section className="section identify__recent" aria-labelledby="recent-title">
              <header className="section__head section__head--row">
                <h2 className="subhead" id="recent-title">
                  Recently spotted
                </h2>
                <a className="btn btn--ghost" href={href({ page: 'spotted' })}>
                  All {spotted.length} in Spotted
                </a>
              </header>
              <div className="spots">
                {spotted.slice(0, 4).map((s) => (
                  <SpottedCard key={s.id} s={s} onOpen={() => setOpen(s)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {showing && (
        <div className="identify__grid">
          <div className="identify__photo">
            {preview ? (
              <Detection
                src={preview}
                box={result?.box}
                size={result?.size}
                scanning={busy}
                label={result?.found ? (result.kind === 'motorcycle' ? 'Motorcycle found' : 'Car found') : undefined}
              />
            ) : (
              <div className="detect detect--empty">
                <p>No photo yet. You can add one later from the car’s page.</p>
              </div>
            )}
            {busy && (
              <ol className="progress" aria-live="polite">
                {STEPS.map((s, i) => (
                  <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
                    {s}
                  </li>
                ))}
              </ol>
            )}
            {result && <p className="muted identify__ms">Analysed on this Mac in {(result.ms / 1000).toFixed(1)} s</p>}
          </div>

          <div className="identify__result">
            {error && <p className="note note--bad">{error}</p>}
            {result && !result.found && !identity && (
              <p className="note">No car found in this photo. Try one where the car fills more of the frame, or pick the make and model yourself.</p>
            )}
            {identity && (
              <section className="ident">
                <p className="eyebrow">
                  {identity.source === 'vin' ? 'Decoded from the VIN' : identity.source === 'manual' ? 'You picked' : 'Looks like'}
                </p>
                <h2 className="display ident__name">
                  <span className="ident__years">{years}</span> {identity.make} {identity.model}
                </h2>
                {identity.trim && <p className="ident__trim">{identity.trim}</p>}
                <div className="ident__meta">
                  {pct != null && identity.source === 'photo' && (
                    <span className="meter" title="How sure the match is">
                      <span className="meter__bar">
                        <i style={{ width: `${Math.max(4, pct)}%` }} />
                      </span>
                      {pct}% match
                    </span>
                  )}
                  {identity.vin && <span className="tagchip">VIN {identity.vin}</span>}
                  {color && (
                    <span className="paint">
                      <i style={{ background: color.hex }} /> {color.name}
                    </span>
                  )}
                </div>
                {identity.source === 'photo' && pct != null && pct < 35 && (
                  <p className="note">Not sure about this one. Check the other matches, or add the VIN for a certain answer.</p>
                )}
                {identity.source === 'photo' && (identity.alternatives?.length ?? 0) > 0 && (
                  <div className="alts">
                    <span className="field__label">Other matches</span>
                    <div className="chips">
                      {identity.alternatives!.slice(0, 4).map((a) => (
                        <button key={`${a.make}${a.model}`} className="chip" onClick={() => choose(a)}>
                          {a.make} {a.model} <small>{Math.round(a.confidence * 100)}%</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ident__row">
                  <YearSelect identity={identity} onYear={(y) => setIdentity({ ...identity, year: y, variant: undefined })} />
                  <div className="actions">
                    <button className="btn btn--accent" onClick={() => void toGarage()}>
                      Add to my garage
                    </button>
                    <button className="btn" onClick={() => void toGarage('considering')}>
                      Thinking of buying it?
                    </button>
                  </div>
                </div>
                {savedId && (
                  <p className="muted identify__saved">
                    Saved to <a href={href({ page: 'spotted' })}>Spotted</a>.{' '}
                    <button
                      className="linkbtn"
                      onClick={async () => {
                        const id = savedId;
                        setSavedId(null);
                        await removeSpotted(id);
                      }}
                    >
                      Remove
                    </button>
                  </p>
                )}
                <div className="identify__alt identify__alt--inline">
                  {identity.source !== 'vin' && (
                    <button className="btn btn--ghost btn--sm" onClick={() => setPanel(panel === 'vin' ? null : 'vin')}>
                      Add the VIN for the exact trim
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => setPanel(panel === 'manual' ? null : 'manual')}>
                    Not right? Pick it yourself
                  </button>
                </div>
              </section>
            )}
            {panel && <section className="panelbox">{panel === 'vin' ? <VinEntry onFound={fromVin} /> : picker}</section>}
            {identity?.year && (
              <section className="identify__sheet">
                <h2 className="subhead">Spec sheet</h2>
                <SpecSheetView
                  year={identity.year}
                  make={identity.make}
                  model={identity.model}
                  variant={identity.variant}
                  vin={identity.vin}
                  onLoaded={setSheet}
                  onVariant={(v) => setIdentity({ ...identity, variant: v })}
                />
              </section>
            )}
          </div>
        </div>
      )}

      {open && (
        <SpottedDialog
          s={open}
          onClose={() => setOpen(null)}
          onRemoved={() => {
            if (last?.id === open.id) setLast(null);
          }}
        />
      )}
    </div>
  );
}
