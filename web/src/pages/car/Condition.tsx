import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { carName, useGarage } from '../../lib/store';
import type { Car, Comparison, DamageKind, Pin } from '../../lib/types';
import { SplatViewer, type Marker } from '../../three/SplatViewer';

const KINDS: { id: DamageKind; label: string }[] = [
  { id: 'scratch', label: 'Scratch' },
  { id: 'dent', label: 'Dent' },
  { id: 'chip', label: 'Paint chip' },
  { id: 'scuff', label: 'Scuff' },
  { id: 'crack', label: 'Crack' },
  { id: 'other', label: 'Other' },
];
const kindLabel = (k: DamageKind) => KINDS.find((x) => x.id === k)?.label ?? k;
const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const uid = () => Math.random().toString(36).slice(2, 10);

type Draft = { at?: [number, number, number]; photo?: string; spot?: [number, number] };

/** A 3D pin's position for the model's current front setting. */
function pinAt(p: Pin, front: 1 | -1): [number, number, number] {
  const [x, y, z] = p.at!;
  return (p.front ?? 1) === front ? [x, y, z] : [-x, y, -z];
}

function DraftForm({ car, draft, onDone }: { car: Car; draft: Draft; onDone: () => void }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [kind, setKind] = useState<DamageKind>('scratch');
  const [note, setNote] = useState('');
  const [closeup, setCloseup] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    const pin: Pin = { id: uid(), kind, note: note.trim(), ...draft, front: car.capture?.front ?? 1, closeup: closeup ?? undefined, createdAt: Date.now() / 1000 };
    const cond = car.condition ?? {};
    await updateCar(car.id, { condition: { ...cond, pins: [...(cond.pins ?? []), pin] } });
    onDone();
  };
  return (
    <div className="draft">
      <p className="field__label">New mark</p>
      <div className="chips">
        {KINDS.map((k) => (
          <button key={k.id} className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. 10 cm scratch on the rear door" />
      <div className="actions">
        <button className="btn btn--sm" onClick={() => input.current?.click()}>
          {closeup ? 'Close-up added' : 'Add a close-up photo'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setCloseup((await api.upload<{ url: string }>('/media', f, {}, f.name)).url);
          }}
        />
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn--accent btn--sm" onClick={save}>
          Save mark
        </button>
      </div>
    </div>
  );
}

/** A photo with its pins, numbered as in the list below. */
function PhotoPins({
  car,
  photo,
  pins,
  draft,
  onPick,
}: {
  car: Car;
  photo: string;
  pins: Pin[];
  draft?: [number, number];
  onPick: (spot: [number, number]) => void;
}) {
  return (
    <div className="pinphoto" data-car={car.id}>
      <img
        src={photo}
        alt="Tap where the damage is"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
        }}
      />
      {pins.map((p, i) =>
        p.photo === photo && p.spot ? (
          <span key={p.id} className={`pinphoto__pin ${p.fixed ? 'is-fixed' : ''}`} style={{ left: `${p.spot[0] * 100}%`, top: `${p.spot[1] * 100}%` }}>
            {i + 1}
          </span>
        ) : null,
      )}
      {draft && (
        <span className="pinphoto__pin is-draft" style={{ left: `${draft[0] * 100}%`, top: `${draft[1] * 100}%` }}>
          +
        </span>
      )}
    </div>
  );
}

const VIEWPOINT = {
  same: 'Taken from the same spot.',
  close: 'Taken from nearly the same spot.',
  different: 'Taken from a different spot: small outlines near edges, glass and wheels may just be the change in angle.',
};

function Compare({ car }: { car: Car }) {
  const load = useGarage((s) => s.load);
  const updateCar = useGarage((s) => s.updateCar);
  const comparisons = car.condition?.comparisons ?? [];
  const photos = car.photos?.length ? car.photos : car.photo ? [car.photo] : [];
  const [before, setBefore] = useState<string | null>(photos[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = async (after: File) => {
    if (!before) return;
    setBusy(true);
    setError(null);
    try {
      await api.upload<Comparison>(`/cars/${car.id}/condition/compare`, after, { beforeUrl: before }, after.name);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cond__section">
      <header className="cond__head">
        <div>
          <h2 className="subhead">Before and after</h2>
          <p className="muted">
            Pick an earlier photo, then add a new one from the same spot. They’re lined up and anything that changed is outlined: places to
            look at, not a diagnosis.
          </p>
        </div>
      </header>
      {photos.length === 0 ? (
        <p className="muted">Add photos of the car first (360 tab), so there’s something to compare against.</p>
      ) : (
        <div className="compare">
          <div className="thumbs" role="group" aria-label="Before photo">
            {photos.map((p) => (
              <button key={p} className={p === before ? 'is-on' : ''} onClick={() => setBefore(p)}>
                <img src={p} alt="" />
              </button>
            ))}
          </div>
          <div className="actions">
            <button className="btn btn--accent" disabled={!before || busy} onClick={() => input.current?.click()}>
              {busy ? 'Comparing…' : 'Add the after photo'}
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void run(f);
              }}
            />
          </div>
          {error && <p className="note note--bad">{error}</p>}
        </div>
      )}
      {comparisons.map((c) => (
        <figure key={c.id} className="cmp">
          <div className="cmp__imgs">
            <span>
              <img src={c.before} alt="Before" />
              <i>Before</i>
            </span>
            <span>
              <img src={c.overlay} alt="After, with changes outlined" />
              <i>After{c.regions.length ? ', changes outlined' : ''}</i>
            </span>
          </div>
          <figcaption>
            <div>
              <strong>{day(c.createdAt)}</strong> ·{' '}
              {c.regions.length ? `${c.regions.length} area${c.regions.length > 1 ? 's' : ''} changed, numbered on the right.` : 'No clear changes found.'}
              {c.viewpoint && <span className="muted"> {VIEWPOINT[c.viewpoint]}</span>}
            </div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void updateCar(car.id, { condition: { ...car.condition, comparisons: comparisons.filter((x) => x.id !== c.id) } })}
            >
              Delete
            </button>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

export function CarCondition({ car }: { car: Car }) {
  const updateCar = useGarage((s) => s.updateCar);
  const pins = useMemo(() => car.condition?.pins ?? [], [car.condition]);
  const photos = car.photos?.length ? car.photos : car.photo ? [car.photo] : [];
  const has3d = car.capture?.status === 'done' && car.capture.splat && car.capture.transform && car.capture.size;
  const [mode, setMode] = useState<'3d' | 'photo'>(has3d ? '3d' : 'photo');
  const [photo, setPhoto] = useState(photos[0] ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const front = car.capture?.front ?? 1;
  const open = pins.filter((p) => !p.fixed);

  const setPins = (next: Pin[]) => void updateCar(car.id, { condition: { ...(car.condition ?? {}), pins: next } });

  const markers: Marker[] = pins
    .filter((p) => p.at)
    .map((p) => ({
      id: p.id,
      at: pinAt(p, front),
      label: `${pins.indexOf(p) + 1}. ${kindLabel(p.kind)}${p.fixed ? ' (fixed)' : ''}`,
      tone: p.fixed ? 'done' : 'note',
      body: (
        <>
          {p.note && <p>{p.note}</p>}
          {p.closeup && <img className="hotspot__img" src={p.closeup} alt="" />}
          <p className="muted">{day(p.createdAt)}</p>
        </>
      ),
    }));

  if (draft?.at) markers.push({ id: 'draft', at: draft.at, label: 'New mark', tone: 'accent' });

  return (
    <div className="cond">
      <header className="cond__summary">
        <div>
          <p className="eyebrow">Condition record</p>
          <h2 className="display">{open.length ? `${open.length} open mark${open.length > 1 ? 's' : ''}` : 'No open marks'}</h2>
        </div>
        <button className="btn" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </header>

      <section className="cond__section">
        <header className="cond__head">
          <div>
            <h2 className="subhead">
              <span className="screen-only">Mark damage</span>
              <span className="print-only">Damage marks</span>
            </h2>
            <p className="muted screen-only">{mode === '3d' ? 'Tap the car where the damage is.' : 'Tap the photo where the damage is.'}</p>
          </div>
          {has3d && (
            <div className="seg" role="group" aria-label="Mark on">
              <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
                3D model
              </button>
              <button aria-pressed={mode === 'photo'} onClick={() => setMode('photo')} disabled={!photos.length}>
                Photos
              </button>
            </div>
          )}
        </header>
        {mode === '3d' && has3d ? (
          <SplatViewer
            url={car.capture!.splat!}
            matrix={car.capture!.transform!}
            size={car.capture!.size!}
            front={front}
            markers={markers}
            onPick={(at) => setDraft({ at })}
          />
        ) : photo ? (
          <>
            <PhotoPins car={car} photo={photo} pins={pins} draft={draft?.photo === photo ? draft.spot : undefined} onPick={(spot) => setDraft({ photo, spot })} />
            {photos.length > 1 && (
              <div className="thumbs">
                {photos.map((p) => (
                  <button key={p} className={p === photo ? 'is-on' : ''} onClick={() => setPhoto(p)}>
                    <img src={p} alt="" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">Add photos of the car (360 tab) or film a walk-around to mark damage on it.</p>
        )}
        {draft && <DraftForm car={car} draft={draft} onDone={() => setDraft(null)} />}
        {pins.length > 0 && (
          <ol className="pins">
            {pins.map((p, i) => (
              <li key={p.id} className={p.fixed ? 'is-fixed' : ''}>
                <span className="pins__n">{i + 1}</span>
                <div>
                  <p className="pins__what">
                    {kindLabel(p.kind)} <span className="muted">· {p.at ? 'on the 3D model' : 'on a photo'} · {day(p.createdAt)}</span>
                  </p>
                  {p.note && <p className="pins__note">{p.note}</p>}
                </div>
                {p.closeup && <img src={p.closeup} alt="Close-up" />}
                <div className="actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => setPins(pins.map((x) => (x.id === p.id ? { ...x, fixed: !x.fixed } : x)))}>
                    {p.fixed ? 'Reopen' : 'Mark fixed'}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setPins(pins.filter((x) => x.id !== p.id))}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Compare car={car} />

      <p className="print-only cond__footer">
        Condition record for {car.nickname || carName(car.identity)}
        {car.identity?.vin ? `, VIN ${car.identity.vin}` : ''}. Printed {day(Date.now() / 1000)} from Chassis.
      </p>
    </div>
  );
}
