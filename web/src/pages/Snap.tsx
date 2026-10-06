import { useEffect, useState } from 'react';
import { go, href } from '../lib/route';
import { useGarage } from '../lib/store';
import type { Identity, PaintColor, SpecSheet } from '../lib/types';
import { catalog, identifyPhoto, type IdentifyResult, type VinResult } from '../lib/vehicle';
import { Detection } from '../ui/Detection';
import { ManualPicker } from '../ui/ManualPicker';
import { PhotoDrop } from '../ui/PhotoDrop';
import { SpecSheetView } from '../ui/SpecSheetView';
import { VinEntry } from '../ui/VinEntry';

const STEPS = ['Finding the car', 'Comparing it with every model since 1984', 'Narrowing down the years', 'Reading the paint'];

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

export function Snap() {
  const addCar = useGarage((s) => s.addCar);
  const addSpotted = useGarage((s) => s.addSpotted);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [color, setColor] = useState<PaintColor | undefined>();
  const [sheet, setSheet] = useState<SpecSheet | null>(null);
  const [panel, setPanel] = useState<'vin' | 'manual' | null>(null);
  const [saved, setSaved] = useState<'spotted' | null>(null);
  const step = useSteps(busy);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setIdentity(null);
    setColor(undefined);
    setSheet(null);
    setError(null);
    setSaved(null);
  };

  const analyse = async (file: File) => {
    reset();
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const r = await identifyPhoto(file);
      setResult(r);
      setColor(r.color);
      const top = r.candidates[0];
      if (top) {
        setIdentity({
          make: top.make,
          model: top.model,
          yearFrom: top.yearFrom,
          yearTo: top.yearTo,
          year: top.year ?? top.yearTo,
          confidence: top.confidence,
          source: 'photo',
          alternatives: r.candidates.slice(1).map(({ make, model, yearFrom, yearTo, confidence }) => ({ make, model, yearFrom, yearTo, confidence })),
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  const toGarage = async () => {
    if (!identity) return;
    const car = await addCar({
      identity: { ...identity, variant: sheet?.variant },
      color,
      photo: result?.photo,
      photos: result?.photo ? [result.photo] : [],
      specs: sheet ?? undefined,
    });
    go({ page: 'car', id: car.id, tab: 'specs' });
  };

  const toSpotted = async () => {
    if (!identity || !result) return;
    const headline = sheet?.groups
      .flatMap((g) => g.items)
      .filter((i) => ['Engine', 'Combined', 'Range', 'Horsepower'].includes(i.label))
      .slice(0, 3);
    await addSpotted({ photo: result.photo, identity, color, headline });
    setSaved('spotted');
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

  return (
    <div className="page wrap snap">
      <header className="page__head">
        <div>
          <p className="eyebrow">Snap &amp; Spec</p>
          <h1 className="display">What car is that?</h1>
          <p>
            Add a photo of any car to see its make, model, model years and colour, then the full spec sheet. Add the VIN for the exact year
            and trim.
          </p>
        </div>
        {(preview || identity) && (
          <button className="btn" onClick={reset}>
            Start over
          </button>
        )}
      </header>

      {!preview && !identity && (
        <>
          <PhotoDrop onFile={analyse} />
          <div className="snap__alt">
            <button className="btn btn--ghost" onClick={() => setPanel(panel === 'vin' ? null : 'vin')} aria-expanded={panel === 'vin'}>
              I have the VIN
            </button>
            <button className="btn btn--ghost" onClick={() => setPanel(panel === 'manual' ? null : 'manual')} aria-expanded={panel === 'manual'}>
              Pick make and model myself
            </button>
          </div>
          {panel && <section className="panelbox panelbox--solo">{panel === 'vin' ? <VinEntry onFound={fromVin} /> : picker}</section>}
        </>
      )}

      {(preview || identity) && (
        <div className="snap__grid">
          <div className="snap__photo">
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
            {result && <p className="muted snap__ms">Analysed on this Mac in {(result.ms / 1000).toFixed(1)} s</p>}
          </div>

          <div className="snap__result">
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
                    <button className="btn btn--accent" onClick={toGarage}>
                      Add to my garage
                    </button>
                    {result?.photo && (
                      <button className="btn" onClick={toSpotted} disabled={saved === 'spotted'}>
                        {saved === 'spotted' ? 'Saved to Spotted' : 'Save to Spotted'}
                      </button>
                    )}
                  </div>
                </div>
                {saved === 'spotted' && (
                  <p className="muted">
                    Saved. See it with the rest in <a href={href({ page: 'spotter' })}>Spotter</a>.
                  </p>
                )}
                <div className="snap__alt snap__alt--inline">
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
              <section className="snap__sheet">
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
    </div>
  );
}
