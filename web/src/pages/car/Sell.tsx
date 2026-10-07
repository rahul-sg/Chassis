import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CONDITIONS, listingTitle, writeListing, type IdentifiedCar } from '../../lib/listing';
import { href } from '../../lib/route';
import { carName, useGarage } from '../../lib/store';
import type { Backdrop, Car, SellInfo, SpecSheet, StudioShot } from '../../lib/types';
import { fetchSpecs } from '../../lib/vehicle';
import { Copy } from '../../ui/Copy';
import { KbbLink } from '../../ui/KbbLink';

const BACKDROPS: { id: Backdrop; label: string; swatch: string }[] = [
  { id: 'studio', label: 'Studio grey', swatch: 'linear-gradient(#eeeeec, #d4d4d2)' },
  { id: 'graphite', label: 'Graphite', swatch: 'linear-gradient(#2c2c31, #141417)' },
  { id: 'white', label: 'White', swatch: '#fbfbfb' },
];
const num = (v: string) => Number(v.replace(/[^0-9]/g, '')) || undefined;

function Shot({ url, order, note, onToggle }: { url: string; order: number; note?: string; onToggle: () => void }) {
  return (
    <button className={`shot ${order >= 0 ? 'is-on' : ''}`} onClick={onToggle} aria-pressed={order >= 0}>
      <img src={url} alt="" loading="lazy" />
      <span className="shot__badge">{order >= 0 ? order + 1 : '+'}</span>
      {note && <span className="shot__note">{note}</span>}
    </button>
  );
}

function StudioPhotos({ car, sell, set }: { car: Car; sell: SellInfo; set: (p: Partial<SellInfo>) => void }) {
  const sources = car.photos?.length ? car.photos : car.photo ? [car.photo] : [];
  const backdrop = sell.backdrop ?? 'studio';
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shots = (sell.shots ?? []).filter((s) => s.backdrop === backdrop && sources.includes(s.source));
  const chosen = sell.photos ?? [];
  const toggle = (url: string) => set({ photos: chosen.includes(url) ? chosen.filter((u) => u !== url) : [...chosen, url] });

  const make = async () => {
    setError(null);
    const made: StudioShot[] = [];
    const failed: number[] = [];
    for (const [n, photo] of sources.entries()) {
      setBusy(`Cutting out photo ${n + 1} of ${sources.length}…`);
      try {
        made.push(await api.post<StudioShot>(`/cars/${car.id}/studio`, { photo, backdrop }));
      } catch {
        failed.push(n + 1);
      }
    }
    setBusy(null);
    if (failed.length) setError(`No car found in photo ${failed.join(', ')}, so ${failed.length > 1 ? 'they’re' : 'it’s'} left out.`);
    const others = (sell.shots ?? []).filter((s) => s.backdrop !== backdrop);
    // The new shots go in the listing in place of studio shots it had on another backdrop.
    const kept = chosen.filter((u) => !(sell.shots ?? []).some((s) => s.url === u));
    // Whole-car shots lead the listing; ones where the car runs off the photo go last.
    const cut = (s: StudioShot) => s.clipped.some((c) => c === 'left' || c === 'right');
    const order = [...made.filter((s) => !cut(s)), ...made.filter(cut)];
    set({ shots: [...others, ...made], photos: [...order.map((s) => s.url), ...kept] });
  };

  return (
    <section className="sell__section">
      <header className="cond__head">
        <div>
          <h2 className="subhead">Studio photos</h2>
          <p className="muted">
            Your photos with the background swapped for a clean studio and a soft shadow. Tap photos to put them in the listing; the numbers
            are their order.
          </p>
        </div>
      </header>
      {sources.length === 0 ? (
        <p className="muted">
          Add photos of the car on the <a href={href({ page: 'car', id: car.id, tab: '360' })}>360 tab</a> first.
        </p>
      ) : (
        <>
          <div className="actions">
            <div className="chips" role="group" aria-label="Backdrop">
              {BACKDROPS.map((b) => (
                <button key={b.id} className="chip" aria-pressed={backdrop === b.id} onClick={() => set({ backdrop: b.id })}>
                  <i className="swatch" style={{ background: b.swatch }} />
                  {b.label}
                </button>
              ))}
            </div>
            <button className="btn btn--accent" disabled={!!busy} onClick={make}>
              {busy ?? (shots.length ? 'Make them again' : `Make ${sources.length} studio photo${sources.length > 1 ? 's' : ''}`)}
            </button>
          </div>
          {error && <p className="note">{error}</p>}
          {shots.length > 0 && (
            <div className="shots">
              {shots.map((s) => (
                <Shot
                  key={s.url}
                  url={s.url}
                  order={chosen.indexOf(s.url)}
                  onToggle={() => toggle(s.url)}
                  note={s.clipped.some((c) => c === 'left' || c === 'right') ? 'Car cut off in the original' : undefined}
                />
              ))}
            </div>
          )}
          <p className="field__label sell__sub">Original photos</p>
          <div className="shots shots--small">
            {sources.map((p) => (
              <Shot key={p} url={p} order={chosen.indexOf(p)} onToggle={() => toggle(p)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SellKit({ car }: { car: IdentifiedCar }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [sell, setSell] = useState<SellInfo>(() => ({ style: 'detailed', backdrop: 'studio', ...car.sell }));
  const [sheet, setSheet] = useState<SpecSheet | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const i = car.identity;
  const set = (p: Partial<SellInfo>) => setSell((s) => ({ ...s, ...p }));

  useEffect(() => {
    let live = true;
    fetchSpecs({ year: i.year ?? i.yearTo, make: i.make, model: i.model, variant: i.variant, vin: i.vin })
      .then((s) => live && setSheet(s))
      .catch(() => live && setSheet(null));
    return () => {
      live = false;
    };
  }, [i.year, i.yearTo, i.make, i.model, i.variant, i.vin]);

  const generated = useMemo(() => writeListing(car, sheet ?? null, sell), [car, sheet, sell]);
  const text = sell.edited && sell.listing != null ? sell.listing : generated;
  const title = useMemo(() => listingTitle(car, sheet ?? null, sell), [car, sheet, sell]);
  const latest = useRef<SellInfo>({ ...sell, listing: text });
  latest.current = { ...sell, listing: text };

  // Saved as you type, half a second after the last change.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void updateCar(car.id, { sell: latest.current }), 500);
    return () => clearTimeout(t);
  }, [sell, text, car.id, updateCar]);

  const openMarks = (car.condition?.pins ?? []).filter((p) => !p.fixed).length;
  const exactYear = i.year != null || i.yearFrom === i.yearTo;
  const has3d = car.capture?.status === 'done';
  const count = sell.photos?.length ?? 0;

  return (
    <div className="sell">
      <header className="cond__summary">
        <div>
          <p className="eyebrow">Sell kit</p>
          <h2 className="display">Everything to list it</h2>
        </div>
      </header>

      <StudioPhotos car={car} sell={sell} set={set} />

      <section className="sell__section">
        <h2 className="subhead">Details</h2>
        {!exactYear && (
          <p className="note">
            The year is still a range ({i.yearFrom}–{i.yearTo}). Set the exact year on the{' '}
            <a href={href({ page: 'car', id: car.id, tab: 'specs' })}>Specs tab</a> so the listing is accurate.
          </p>
        )}
        <div className="form">
          <label className="field">
            <span className="field__label">Asking price ($)</span>
            <input
              className="input"
              inputMode="numeric"
              value={sell.price?.toLocaleString('en-US') ?? ''}
              onChange={(e) => set({ price: num(e.target.value) })}
              placeholder="18,500"
            />
          </label>
          <label className="field">
            <span className="field__label">Mileage</span>
            <input
              className="input"
              inputMode="numeric"
              value={sell.mileage?.toLocaleString('en-US') ?? ''}
              onChange={(e) => set({ mileage: num(e.target.value) })}
              placeholder="52,000"
            />
          </label>
          <label className="field">
            <span className="field__label">Location</span>
            <input className="input" value={sell.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="Atlanta, GA" />
          </label>
          <div className="field form__wide">
            <span className="field__label">Condition</span>
            <div className="chips">
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  className="chip"
                  aria-pressed={sell.condition === c.id}
                  onClick={() => set({ condition: sell.condition === c.id ? undefined : c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field form__wide">
            <span className="field__label">Extras, one per line</span>
            <textarea
              className="input input--area"
              rows={3}
              value={sell.extras ?? ''}
              onChange={(e) => set({ extras: e.target.value })}
              placeholder={'New tyres (2025)\nRoof rack'}
            />
          </label>
          <label className="field form__wide">
            <span className="field__label">Anything else</span>
            <textarea
              className="input input--area"
              rows={3}
              value={sell.notes ?? ''}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Service history, why you’re selling…"
            />
          </label>
        </div>
        <KbbLink identity={i}>Not sure what to ask? Kelley Blue Book gives trade-in and private-party values for your mileage and ZIP code.</KbbLink>
        <div className="checks">
          <label className={openMarks ? '' : 'is-off'}>
            <input
              type="checkbox"
              disabled={!openMarks}
              checked={!!sell.includeCondition && !!openMarks}
              onChange={(e) => set({ includeCondition: e.target.checked })}
            />
            {openMarks
              ? `Mention the ${openMarks} open mark${openMarks === 1 ? '' : 's'} from the Condition tab`
              : 'Mention open marks from the Condition tab (there are none)'}
          </label>
          {car.nickname && car.nickname !== carName(car.identity) && (
            <label>
              <input type="checkbox" checked={!!sell.useNickname} onChange={(e) => set({ useNickname: e.target.checked })} />
              Use “{car.nickname}” as the listing page’s title
            </label>
          )}
        </div>
      </section>

      <section className="sell__section">
        <header className="cond__head">
          <div>
            <h2 className="subhead">Listing</h2>
            <p className="muted">Written from the EPA and NHTSA data and your details, so nothing is made up. Edit it as you like.</p>
          </div>
          <div className="seg" role="group" aria-label="Length">
            <button aria-pressed={sell.style === 'short'} onClick={() => set({ style: 'short' })}>
              Short
            </button>
            <button aria-pressed={sell.style !== 'short'} onClick={() => set({ style: 'detailed' })}>
              Detailed
            </button>
          </div>
        </header>
        <div className="listing">
          <div className="listing__title">
            <span>{title}</span>
            <Copy text={title} label="Copy title" />
          </div>
          <textarea
            className="listing__text"
            value={text}
            rows={Math.min(18, Math.max(5, Math.ceil(text.length / 120) + text.split('\n').length))}
            onChange={(e) => set({ listing: e.target.value, edited: true })}
            aria-label="Listing text"
          />
          <div className="actions">
            <Copy text={text} label="Copy text" />
            {sell.edited && (
              <button className="btn btn--ghost btn--sm" onClick={() => set({ edited: false, listing: undefined })}>
                Rewrite from the details
              </button>
            )}
            {sheet === null && <span className="muted">No EPA spec sheet for this car, so the listing uses your details only.</span>}
          </div>
        </div>
      </section>

      <section className="sell__section kit">
        <div>
          <h2 className="subhead">Listing kit</h2>
          <p>
            A small website with all of it:{' '}
            {[count ? `${count} photo${count > 1 ? 's' : ''}` : 'your photos', 'the listing', sheet ? 'the full spec sheet' : '', has3d ? 'the 3D model, which buyers can spin' : '']
              .filter(Boolean)
              .join(', ')
              .replace(/, ([^,]*)$/, ' and $1')}
            . Put the folder on any static host (GitHub Pages, Netlify Drop) and share
            the link.
          </p>
          <p className="muted">
            To look at it on this Mac, unzip it, run <code>python3 -m http.server</code> inside the folder, then open <code>localhost:8000</code>.
          </p>
        </div>
        <button
          className="btn btn--accent btn--lg"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await updateCar(car.id, { sell: latest.current });
              window.location.href = `/api/cars/${car.id}/kit`;
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Download the kit (.zip)'}
        </button>
      </section>
    </div>
  );
}

export function CarSell({ car }: { car: Car }) {
  if (!car.identity) {
    return (
      <div className="empty">
        <p>
          Identify the car first: the listing is written from its make, model and specs. Go to the{' '}
          <a href={href({ page: 'car', id: car.id, tab: 'specs' })}>Specs tab</a>.
        </p>
      </div>
    );
  }
  return <SellKit car={car as IdentifiedCar} />;
}
