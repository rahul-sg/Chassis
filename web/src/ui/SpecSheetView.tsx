import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { fetchSpecs } from '../lib/vehicle';
import type { SpecSheet } from '../lib/types';
import { Complaints } from './Complaints';
import { Copy } from './Copy';

interface Props {
  year: number;
  make: string;
  model: string;
  variant?: number | null;
  vin?: string | null;
  onLoaded?: (s: SpecSheet) => void;
  onVariant?: (id: number) => void;
}

const stars = (v: string) => {
  const n = Number(v.match(/^\d/)?.[0] ?? 0);
  return n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : v;
};

/** The full spec sheet for a model year: version picker, grouped values with sources, recalls. */
export function SpecSheetView({ year, make, model, variant, vin, onLoaded, onVariant }: Props) {
  const [sheet, setSheet] = useState<SpecSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setMissing(false);
    fetchSpecs({ year, make, model, variant, vin })
      .then((s) => {
        if (!live) return;
        setSheet(s);
        onLoaded?.(s);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e.message);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, make, model, variant, vin]);

  if (missing)
    return (
      <div className="sheet-missing">
        <p className="subhead">No spec sheet for this one</p>
        <p className="muted">
          {year < 1984
            ? `The EPA’s records start with 1984 models, so there’s no official data for a ${year} ${make} ${model}.`
            : `The EPA has no record of a ${year} ${make} ${model}. It covers cars and light trucks sold in the U.S. since 1984; imports, heavy trucks and very rare cars aren’t rated.`}{' '}
          Everything else still works: the 3D, mods, condition and the listing.
        </p>
      </div>
    );
  if (error) return <p className="note note--bad">{error}</p>;
  if (!sheet) return <div className="sheet sheet--loading" aria-busy="true" />;
  const recalls = sheet.recalls ?? [];

  return (
    <div className="sheet">
      {sheet.variants.length > 1 && (
        <label className="field">
          <span className="field__label">Version ({sheet.variants.length} for {year})</span>
          <select className="select" value={sheet.variant} onChange={(e) => onVariant?.(Number(e.target.value))}>
            {sheet.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="sheet__groups">
        {sheet.groups.map((g) => (
          <section className="sheet__group" key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map((i) => (
                <div key={i.label}>
                  <dt>{i.label}</dt>
                  <dd>
                    <span className={g.title === 'Crash ratings' ? 'stars' : undefined} title={i.value}>
                      {g.title === 'Crash ratings' ? stars(i.value) : i.value}
                    </span>
                    <small>{i.source}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <section className="sheet__group sheet__recalls">
        <h3>
          Safety recalls <span className={`count ${recalls.length ? 'count--warn' : ''}`}>{sheet.recalls === null ? '—' : recalls.length}</span>
        </h3>
        {sheet.recalls === null ? (
          <p className="muted">The recall service couldn’t be reached. Try again when you’re online.</p>
        ) : recalls.length === 0 ? (
          <p className="muted">NHTSA lists no recalls for the {year} {make} {model}.</p>
        ) : (
          <>
            <p className="muted">
              For every {year} {make} {model}. Whether a particular car still needs the fix depends on its VIN
              {vin ? ': copy it, then look it up on NHTSA.' : '.'}
            </p>
            <div className="actions">
              {vin && <Copy text={vin} label="Copy the VIN" />}
              <a className="btn btn--sm" href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener noreferrer">
                Check {vin ? 'this car' : 'a VIN'} on NHTSA ↗
              </a>
            </div>
            <ul className="recalls">
              {recalls.map((r, i) => (
                <li key={r.campaign}>
                  <button className="recall" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    <span className="recall__what">{r.component.split(':')[0]}</span>
                    <span className="recall__when">{r.date}</span>
                  </button>
                  {open === i && (
                    <div className="recall__body">
                      <p>{r.summary}</p>
                      {r.remedy && (
                        <p>
                          <strong>Fix:</strong> {r.remedy}
                        </p>
                      )}
                      <p className="muted">Campaign {r.campaign}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Complaints year={year} make={make} model={model} />
      <p className="sheet__sources">Sources: {sheet.sources.join(' · ')}</p>
    </div>
  );
}
