import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkAd, driveText, powerText, readAd, type ClaimRow } from '../../lib/adcheck';
import { api } from '../../lib/api';
import { AVERAGE_MILES, fairValue, mileageCheck, priceVerdict, summarise, type Finding, type Section } from '../../lib/buying';
import { type IdentifiedCar } from '../../lib/listing';
import { href } from '../../lib/route';
import { useGarage } from '../../lib/store';
import type { BuyingInfo, Car, CheckAnswer, HistoryFacts, VinDetails } from '../../lib/types';
import { catalog, type VinResult } from '../../lib/vehicle';
import { Copy } from '../../ui/Copy';
import { KbbLink } from '../../ui/KbbLink';
import { VinEntry } from '../../ui/VinEntry';

const num = (v: string) => Number(v.replace(/[^0-9]/g, '')) || undefined;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const miles = (n: number) => n.toLocaleString('en-US');
const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');
const goTo = (s: Section) => document.getElementById(`buy-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function Step({ id, n, title, intro, children }: { id: Section; n: number; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section className="sell__section buy__step" id={`buy-${id}`}>
      <header>
        <h2 className="subhead">
          <span className="buy__n mono">{n}</span>
          {title}
        </h2>
        <p className="muted">{intro}</p>
      </header>
      {children}
    </section>
  );
}

/** A fact with how it reads for a buyer: fine, worth a look, or a problem. */
function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={tone ? `fact fact--${tone}` : 'fact'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ---------- Summary ----------

function Summary({ findings, todo }: { findings: Finding[]; todo: { section: Section; text: string }[] }) {
  const bad = findings.filter((f) => f.tone === 'bad').length;
  const warn = findings.filter((f) => f.tone === 'warn').length;
  const asks = findings.map((f) => f.ask).filter((a): a is string => !!a);
  const headline = !findings.length
    ? 'Check it over before you buy'
    : bad
      ? `${bad} problem${bad > 1 ? 's' : ''} found`
      : warn
        ? `${warn} thing${warn > 1 ? 's' : ''} to look into`
        : 'Nothing worrying so far';
  return (
    <section className="buy__summary">
      <header className="cond__summary">
        <div>
          <p className="eyebrow">Thinking of buying it</p>
          <h2 className="display">{headline}</h2>
        </div>
      </header>
      {findings.length > 0 && (
        <ul className="findings">
          {findings.map((f, k) => (
            <li key={k} className={`finding finding--${f.tone}`}>
              <i aria-hidden />
              <div>
                <p>{f.text}</p>
                {f.detail && <p className="muted">{f.detail}</p>}
              </div>
              <button className="linkbtn finding__go" onClick={() => goTo(f.section)}>
                See
              </button>
            </li>
          ))}
        </ul>
      )}
      {asks.length > 0 && (
        <div className="asks">
          <div className="cond__head">
            <h3 className="subhead">Ask the seller</h3>
            <Copy text={asks.map((a, k) => `${k + 1}. ${a}`).join('\n')} label="Copy the questions" />
          </div>
          <ol>
            {asks.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </div>
      )}
      {todo.length > 0 && (
        <p className="buy__todo">
          <span className="field__label">Still to check</span>
          {todo.map((t) => (
            <button key={t.text} className="chip" onClick={() => goTo(t.section)}>
              {t.text}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}

// ---------- 1. VIN ----------

function VinStep({ car, b, set }: { car: IdentifiedCar; b: BuyingInfo; set: (p: Partial<BuyingInfo>) => void }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [changing, setChanging] = useState(false);
  const i = car.identity;
  const v = b.vin;

  const add = (r: VinResult) => {
    if (!r.family) return;
    const guess = b.photoGuess ?? (i.source === 'photo' ? { make: i.make, model: i.model, yearFrom: i.yearFrom, yearTo: i.yearTo, confidence: i.confidence } : undefined);
    set({ vin: r.details ?? {}, photoGuess: guess });
    void updateCar(car.id, {
      identity: { ...i, make: r.family.make, model: r.family.model, yearFrom: r.family.year, yearTo: r.family.year, year: r.family.year, vin: r.vin, trim: r.trim ?? undefined, source: 'vin', variant: undefined },
    });
    setChanging(false);
  };

  const g = b.photoGuess;
  const differs = g && v && !(same(g.make, i.make) && same(g.model, i.model));
  const engine = v && [v.displacement ? `${v.displacement.toFixed(1)} L` : '', v.cylinders ? (v.config && v.config !== 'I' ? `${v.config}${v.cylinders}` : `${v.cylinders}-cyl`) : '', v.turbo ? 'turbo' : '', v.hp ? `${v.hp} hp` : ''].filter(Boolean).join(' ');
  return (
    <Step id="vin" n={1} title="The VIN" intro="Everything below hangs on it. It’s on a plate at the bottom of the windshield, driver’s side, and on the driver’s door-jamb sticker.">
      {v && !changing ? (
        <>
          <dl className="facts">
            <Fact label="VIN" value={<span className="mono">{i.vin}</span>} />
            <Fact label="Built as" value={`${v.year ?? i.year} ${i.make} ${v.model ?? i.model}${v.trim ? ` ${v.trim}` : ''}`} />
            {engine && <Fact label="Engine" value={engine} />}
            {(v.electrification || v.fuel) && <Fact label="Power" value={powerText(v.electrification, v.fuel)} />}
            {v.drive && <Fact label="Drive" value={driveText(v.drive)} />}
            {v.transmission && <Fact label="Transmission" value={`${v.transmission}${v.speeds ? `, ${v.speeds}-speed` : ''}`} />}
            {v.body && <Fact label="Body" value={`${v.body}${v.doors ? `, ${v.doors} doors` : ''}`} />}
            {v.plant && <Fact label="Built in" value={v.plant} />}
          </dl>
          {g && (
            <p className={differs ? 'note note--bad' : 'muted'}>
              {differs
                ? `The photo looked like a ${g.yearFrom === g.yearTo ? g.yearFrom : `${g.yearFrom}–${String(g.yearTo).slice(-2)}`} ${g.make} ${g.model}, but this VIN is a ${i.make} ${i.model}. Make sure the VIN is from this car.`
                : `Matches the photo, which looked like a ${g.make} ${g.model}.`}
            </p>
          )}
          <p>
            <button className="linkbtn" onClick={() => setChanging(true)}>
              Use a different VIN
            </button>
          </p>
        </>
      ) : (
        <VinEntry onFound={add} />
      )}
    </Step>
  );
}

// ---------- 2. The ad ----------

const VERDICT = { match: 'Matches', differs: 'Doesn’t match', unknown: 'The VIN doesn’t say' };

function AdStep({ b, set, rows, found }: { b: BuyingInfo; set: (p: Partial<BuyingInfo>) => void; rows: ClaimRow[]; found: { price?: number; mileage?: number } }) {
  return (
    <Step id="ad" n={2} title="Does it match the ad?" intro="Paste the listing. Every claim the VIN can settle (year, make, model, engine, drive, transmission, hybrid) is checked against it.">
      <textarea
        className="input input--area"
        rows={5}
        value={b.ad ?? ''}
        onChange={(e) => set({ ad: e.target.value })}
        placeholder="2019 Lexus UX 250h F Sport AWD, 45,000 miles, one owner, $27,500"
        aria-label="The listing"
      />
      {b.ad && !b.vin && <p className="muted">Add the VIN above to check the ad against it.</p>}
      {b.ad && b.vin && rows.length === 0 && <p className="muted">Nothing in the ad that the VIN can check.</p>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="claims">
            <thead>
              <tr>
                <th>Claim</th>
                <th>The ad says</th>
                <th>The VIN says</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={`claim--${r.verdict}`}>
                  <td>{r.label}</td>
                  <td>{r.ad}</td>
                  <td>{r.vin}</td>
                  <td>
                    <span className="claim__verdict">{VERDICT[r.verdict]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(found.price || found.mileage) && (
        <p className="muted">
          Also in the ad: {[found.price ? `asking ${money(found.price)}` : '', found.mileage ? `${miles(found.mileage)} miles` : ''].filter(Boolean).join(', ')}, used in
          the mileage and price checks below.
        </p>
      )}
    </Step>
  );
}

// ---------- 3. Theft, write-offs and recalls ----------

function Answer({ value, onChange, options }: { value?: CheckAnswer; onChange: (a?: CheckAnswer) => void; options: [string, string] }) {
  return (
    <div className="chips" role="group" aria-label="What it said">
      {(['clear', 'found'] as const).map((a, k) => (
        <button key={a} className={`chip chip--${a}`} aria-pressed={value === a} onClick={() => onChange(value === a ? undefined : a)}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

function RecordsStep({ car, b, set }: { car: IdentifiedCar; b: BuyingInfo; set: (p: Partial<BuyingInfo>) => void }) {
  const vin = car.identity.vin;
  const modelRecalls = car.specs?.recalls?.length;
  return (
    <Step id="records" n={3} title="Theft, write-offs and recalls" intro="Two free official checks by VIN. They don’t let other sites look them up for you, so copy the VIN, check, and note what it said.">
      {!vin && <p className="note">Add the VIN first.</p>}
      <div className="buy__checks">
        <div className="buy__check">
          <h3>NICB VINCheck</h3>
          <p className="muted">Theft and insurance total-loss records from most U.S. insurers. Five searches a day.</p>
          <div className="actions">
            {vin && <Copy text={vin} label="Copy the VIN" />}
            <a className="btn btn--sm" href="https://www.nicb.org/vincheck" target="_blank" rel="noopener noreferrer">
              Open NICB ↗
            </a>
          </div>
          <Answer value={b.nicb} onChange={(nicb) => set({ nicb })} options={['Nothing found', 'Record found']} />
        </div>
        <div className="buy__check">
          <h3>NHTSA recall lookup</h3>
          <p className="muted">
            Safety recalls not yet fixed on this exact car, from the last 15 years.
            {modelRecalls ? ` NHTSA lists ${modelRecalls} for the model; this shows which still need doing on this one.` : ''}
          </p>
          <div className="actions">
            {vin && <Copy text={vin} label="Copy the VIN" />}
            <a className="btn btn--sm" href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener noreferrer">
              Open NHTSA ↗
            </a>
          </div>
          <Answer value={b.openRecalls} onChange={(openRecalls) => set({ openRecalls })} options={['No open recalls', 'Open recalls']} />
        </div>
      </div>
      <p className="muted">
        For the official title record and past mileage readings from every state, an{' '}
        <a href="https://vehiclehistory.bja.ojp.gov/nmvtis_vehiclehistory" target="_blank" rel="noopener noreferrer">
          NMVTIS report
        </a>{' '}
        costs about $10 from an approved provider.
      </p>
    </Step>
  );
}

// ---------- 4. History report ----------

const ACCIDENTS: { id: string; label: string; set: Partial<HistoryFacts> }[] = [
  { id: 'none', label: 'None reported', set: { accidents: false, severity: null } },
  { id: 'minor', label: 'Minor', set: { accidents: true, severity: 'minor' } },
  { id: 'moderate', label: 'Moderate', set: { accidents: true, severity: 'moderate' } },
  { id: 'severe', label: 'Severe', set: { accidents: true, severity: 'severe' } },
];

function HistoryStep({ car, b, set }: { car: IdentifiedCar; b: BuyingInfo; set: (p: Partial<BuyingInfo>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const h = b.history;
  const vin = car.identity.vin;

  const read = async (file?: File, text?: string) => {
    setBusy(true);
    setError(null);
    try {
      const facts = file ? await api.upload<HistoryFacts>('/history/read', file, {}, file.name) : await api.upload<HistoryFacts>('/history/read', new Blob([]), { text: text ?? '' }, 'empty');
      set({ history: facts });
      setPaste(null);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const edit = (p: Partial<HistoryFacts>) => set({ history: { source: 'you', accidents: null, title: null, ...h, ...p } });
  const yesNo = (v?: boolean | null, yes = 'Reported', no = 'None reported') => (v == null ? 'Not stated' : v ? yes : no);
  const accidentText = !h
    ? ''
    : h.accidents == null
      ? 'Not stated'
      : h.accidents
        ? [
            h.damageCount && h.damageCount > 1 ? `Reported ${h.damageCount} times` : 'Reported',
            h.severity ? `(${h.severity})` : '',
            h.damageDates?.length ? `on ${h.damageDates.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : 'None reported';
  const accidentId = h?.accidents === false ? 'none' : h?.accidents ? h.severity ?? 'moderate' : undefined;

  return (
    <Step
      id="history"
      n={4}
      title="History report"
      intro="A Carfax or AutoCheck report: dealers often include one, or it costs $30–45. Add the PDF (in the browser, Print → Save as PDF) or paste its text. Only the summary is read, and it stays on this Mac."
    >
      {(!h || editing) && (
        <div className="actions">
          <button className="btn btn--accent" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Reading…' : 'Add the report PDF'}
          </button>
          <button className="btn btn--ghost" disabled={busy} onClick={() => setPaste(paste == null ? '' : null)}>
            Paste its text instead
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void read(f);
            }}
          />
        </div>
      )}
      {paste != null && (
        <div className="buy__paste">
          <textarea className="input input--area" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Select all in the report, copy, paste here" />
          <button className="btn" disabled={busy || paste.trim().length < 200} onClick={() => void read(undefined, paste)}>
            Read it
          </button>
        </div>
      )}
      {error && <p className="note note--bad">{error}</p>}

      {h && !editing && (
        <>
          {h.vin && vin && h.vin !== vin && <p className="note note--bad">This report is for VIN {h.vin}, not this car’s ({vin}).</p>}
          <dl className="facts">
            <Fact label="Accidents and damage" value={accidentText} tone={h.accidents ? (h.structural || h.airbag || h.severity === 'severe' ? 'bad' : 'warn') : h.accidents === false ? 'good' : undefined} />
            {h.structural != null && <Fact label="Structural damage" value={yesNo(h.structural)} tone={h.structural ? 'bad' : 'good'} />}
            {h.airbag != null && <Fact label="Airbags deployed" value={yesNo(h.airbag, 'Yes', 'No')} tone={h.airbag ? 'bad' : 'good'} />}
            {h.totalLoss != null && <Fact label="Insurance total loss" value={yesNo(h.totalLoss)} tone={h.totalLoss ? 'bad' : 'good'} />}
            <Fact
              label="Title"
              value={h.title === 'branded' ? `${h.titleBrands?.join(', ') || 'Branded'}` : h.title === 'clean' ? 'Clean' : 'Not stated'}
              tone={h.title === 'branded' ? 'bad' : h.title === 'clean' ? 'good' : undefined}
            />
            {h.owners != null && <Fact label="Owners" value={h.owners} tone={h.owners >= 4 ? 'warn' : undefined} />}
            {h.serviceRecords != null && <Fact label="Service records" value={h.serviceRecords} tone={h.serviceRecords === 0 ? 'warn' : undefined} />}
            {h.lastMileage != null && (
              <Fact label="Last reported mileage" value={`${miles(h.lastMileage)}${h.lastMileageDate ? ` on ${h.lastMileageDate}` : ''}`} />
            )}
            {h.odometerProblem && <Fact label="Odometer" value="Possible rollback" tone="bad" />}
          </dl>
          <p className="muted">
            {h.source === 'you' ? 'Entered by you.' : `From the ${h.source === 'carfax' ? 'Carfax' : h.source === 'autocheck' ? 'AutoCheck' : ''} report${h.reportDate ? ` of ${h.reportDate}` : ''}.`}{' '}
            {h.file && (
              <>
                <a className="linkbtn" href={h.file} target="_blank" rel="noopener noreferrer">
                  Open the PDF
                </a>{' '}
                ·{' '}
              </>
            )}
            <button className="linkbtn" onClick={() => setEditing(true)}>
              Correct it
            </button>{' '}
            ·{' '}
            <button className="linkbtn" onClick={() => set({ history: undefined })}>
              Remove
            </button>
          </p>
        </>
      )}

      {(!h || editing) && (
        <details className="buy__manual" open={editing}>
          <summary>{h ? 'Correct what it says' : 'No report? Enter what you know'}</summary>
          <div className="form">
            <div className="field form__wide">
              <span className="field__label">Accidents and damage</span>
              <div className="chips">
                {ACCIDENTS.map((a) => (
                  <button key={a.id} className="chip" aria-pressed={accidentId === a.id} onClick={() => edit(a.set)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field__label">Title</span>
              <div className="chips">
                <button className="chip" aria-pressed={h?.title === 'clean'} onClick={() => edit({ title: 'clean', titleBrands: [] })}>
                  Clean
                </button>
                <button className="chip" aria-pressed={h?.title === 'branded'} onClick={() => edit({ title: 'branded' })}>
                  Salvage, rebuilt or other brand
                </button>
              </div>
            </div>
            <label className="field">
              <span className="field__label">Owners</span>
              <input className="input" inputMode="numeric" value={h?.owners ?? ''} onChange={(e) => edit({ owners: num(e.target.value) ?? null })} />
            </label>
            <label className="field">
              <span className="field__label">Service records</span>
              <input className="input" inputMode="numeric" value={h?.serviceRecords ?? ''} onChange={(e) => edit({ serviceRecords: e.target.value === '0' ? 0 : num(e.target.value) ?? null })} />
            </label>
            <label className="field">
              <span className="field__label">Last reported mileage</span>
              <input className="input" inputMode="numeric" value={h?.lastMileage ? miles(h.lastMileage) : ''} onChange={(e) => edit({ lastMileage: num(e.target.value) ?? null })} />
            </label>
          </div>
          {editing && (
            <button className="btn btn--sm" onClick={() => setEditing(false)}>
              Done
            </button>
          )}
        </details>
      )}
    </Step>
  );
}

// ---------- 5. Mileage ----------

function MileageStep({ b, fromAd, set, year }: { b: BuyingInfo; fromAd: boolean; set: (p: Partial<BuyingInfo>) => void; year: number }) {
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<{ value: number; unit: string }[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const m = b.mileage ? mileageCheck(b.mileage, year, new Date(), b.history) : null;
  return (
    <Step id="mileage" n={5} title="Mileage" intro={`What the odometer says now. The average car covers about ${miles(AVERAGE_MILES)} miles a year (FHWA).`}>
      <div className="actions">
        <label className="field buy__odo">
          <span className="field__label">Odometer (miles){fromAd ? ' · from the ad' : ''}</span>
          <input className="input" inputMode="numeric" value={b.mileage ? miles(b.mileage) : ''} onChange={(e) => set({ mileage: num(e.target.value) })} placeholder="45,000" />
        </label>
        <button className="btn btn--ghost" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : 'Read it from a photo'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            try {
              const r = await api.upload<{ candidates: { value: number; unit: string }[] }>('/odometer/read', f, {}, f.name);
              setPicks(r.candidates);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {picks && (
        <div className="field">
          <span className="field__label">{picks.length ? 'Which one is the odometer?' : 'No numbers found in that photo. Type it in.'}</span>
          <div className="chips">
            {picks.map((p) => (
              <button
                key={p.value}
                className="chip"
                onClick={() => {
                  set({ mileage: p.unit === 'km' ? Math.round(p.value * 0.621371) : p.value });
                  setPicks(null);
                }}
              >
                {miles(p.value)} {p.unit}
              </button>
            ))}
          </div>
        </div>
      )}
      {m && (
        <p className={`buy__result buy__result--${m.rollback ? 'bad' : m.band === 'high' ? 'warn' : 'good'}`}>
          {m.rollback
            ? `That’s fewer miles than the ${miles(m.rollback.reported)} already reported${m.rollback.date ? ` on ${m.rollback.date}` : ''}. Odometers don’t go backwards: ask whether the instrument cluster was replaced, and get it in writing.`
            : `About ${miles(m.perYear)} miles a year over ${m.years} years: ${m.band === 'high' ? 'more than most cars' : m.band === 'low' ? 'less than most cars' : 'about average'}.`}
        </p>
      )}
    </Step>
  );
}

// ---------- 6. Price ----------

function PriceStep({
  car,
  b,
  fromAd,
  set,
  rollback,
  config,
}: {
  car: IdentifiedCar;
  b: BuyingInfo;
  fromAd: boolean;
  set: (p: Partial<BuyingInfo>) => void;
  rollback: boolean;
  config?: string;
}) {
  const fair = b.kbb ? fairValue(b.kbb, b.history, rollback) : null;
  const verdict = fair && b.asking && !fair.blocked ? priceVerdict(b.asking, fair) : null;
  return (
    <Step
      id="price"
      n={6}
      title="Price"
      intro="Kelley Blue Book’s private-party value assumes a clean history. Look it up for this mileage, condition and ZIP code, enter it here, and the history above is taken into account."
    >
      <KbbLink identity={car.identity}>{config ? `On KBB, choose the version the VIN shows: ${config}.` : 'Look up the private-party value:'}</KbbLink>
      <div className="form">
        <label className="field">
          <span className="field__label">KBB private-party value ($)</span>
          <input className="input" inputMode="numeric" value={b.kbb ? b.kbb.toLocaleString('en-US') : ''} onChange={(e) => set({ kbb: num(e.target.value) })} placeholder="24,800" />
        </label>
        <label className="field">
          <span className="field__label">Asking price ($){fromAd ? ' · from the ad' : ''}</span>
          <input className="input" inputMode="numeric" value={b.asking ? b.asking.toLocaleString('en-US') : ''} onChange={(e) => set({ asking: num(e.target.value) })} placeholder="27,500" />
        </label>
      </div>
      {fair &&
        (fair.blocked ? (
          <p className="note note--bad">{fair.blocked}</p>
        ) : (
          <div className="buy__price">
            <div>
              <span className="field__label">Fair price</span>
              <p className="buy__range mono">{fair.low === fair.high ? money(fair.low) : `${money(fair.low)} – ${money(fair.high)}`}</p>
              <p className="muted">{fair.reasons.length ? fair.reasons.join(' ') : 'The KBB value: nothing in the history takes it down.'}</p>
            </div>
            {verdict && (
              <div>
                <span className="field__label">Asking {money(b.asking!)}</span>
                <p className={`buy__result buy__result--${verdict.tone}`}>{verdict.text}</p>
              </div>
            )}
          </div>
        ))}
    </Step>
  );
}

// ---------- The tab ----------

function Buying({ car }: { car: IdentifiedCar }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [b, setB] = useState<BuyingInfo>(() => car.buying ?? {});
  const set = (p: Partial<BuyingInfo>) => setB((x) => ({ ...x, ...p }));
  const i = car.identity;
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    void catalog.makes().then(setMakes).catch(() => undefined);
  }, []);
  useEffect(() => {
    void catalog
      .models(i.make)
      .then((ms) => setModels(ms.map((m) => m.model)))
      .catch(() => undefined);
  }, [i.make]);

  // Saved half a second after the last change.
  const latest = useRef(b);
  latest.current = b;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void updateCar(car.id, { buying: latest.current }), 500);
    return () => clearTimeout(t);
  }, [b, car.id, updateCar]);

  const ad = useMemo(() => (b.ad ? readAd(b.ad, makes, models) : null), [b.ad, makes, models]);
  const rows = useMemo(() => (ad && b.vin ? checkAd(ad, b.vin, { make: i.make, model: i.model }) : []), [ad, b.vin, i.make, i.model]);
  // The ad's price and mileage stand in until you enter your own, so they follow the ad as it's edited.
  const asking = b.asking ?? ad?.price;
  const odometer = b.mileage ?? ad?.mileage;
  const shown: BuyingInfo = { ...b, asking, mileage: odometer };

  const year = b.vin?.year ?? i.year ?? i.yearTo;
  const mileage = odometer ? mileageCheck(odometer, year, new Date(), b.history) : undefined;
  const fair = b.kbb ? fairValue(b.kbb, b.history, !!mileage?.rollback) : undefined;
  const verdict = fair && asking && !fair.blocked ? priceVerdict(asking, fair) : undefined;
  const g = b.photoGuess;
  const summary = summarise({
    buying: shown,
    vinName: b.vin ? `${i.make} ${i.model}` : undefined,
    photoName: g && !(same(g.make, i.make) && same(g.model, i.model)) ? `${g.make} ${g.model}` : undefined,
    claims: rows,
    mileage,
    fair,
    verdict,
  });
  const v: VinDetails | undefined = b.vin;
  const config = v && [v.displacement ? `${v.displacement.toFixed(1)} L` : '', v.drive ? driveText(v.drive) : '', v.trim ?? ''].filter(Boolean).join(', ');

  return (
    <div className="sell buy">
      <Summary findings={summary.findings} todo={summary.todo} />
      <VinStep car={car} b={b} set={set} />
      <AdStep b={b} set={set} rows={rows} found={{ price: ad?.price, mileage: ad?.mileage }} />
      <RecordsStep car={car} b={b} set={set} />
      <HistoryStep car={car} b={b} set={set} />
      <MileageStep b={shown} fromAd={b.mileage == null && odometer != null} set={set} year={year} />
      <PriceStep car={car} b={shown} fromAd={b.asking == null && asking != null} set={set} rollback={!!mileage?.rollback} config={config || undefined} />
      <p className="muted buy__foot">
        Note dents and scratches you find at the viewing on the <a href={href({ page: 'car', id: car.id, tab: 'condition' })}>Condition tab</a>. None of this replaces a
        pre-purchase inspection by a mechanic you choose.
      </p>
    </div>
  );
}

export function CarBuying({ car }: { car: Car }) {
  if (!car.identity)
    return (
      <div className="empty">
        <p>
          Identify the car first on the <a href={href({ page: 'car', id: car.id, tab: 'specs' })}>Specs tab</a>.
        </p>
      </div>
    );
  return <Buying car={car as IdentifiedCar} />;
}
