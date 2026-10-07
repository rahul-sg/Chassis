import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Complaints as Data } from '../lib/types';

/** What owners of this model year have reported to NHTSA, most-reported parts first. */
export function Complaints({ year, make, model }: { year: number; make: string; model: string }) {
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setData(undefined);
    const q = new URLSearchParams({ year: String(year), make, model });
    api
      .get<Data>(`/complaints?${q}`)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [year, make, model]);

  const serious = data
    ? [data.crashes && `${data.crashes} involved a crash`, data.fires && `${data.fires} a fire`, data.injuries && `${data.injuries} injur${data.injuries > 1 ? 'ies' : 'y'}`]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <section className="sheet__group sheet__recalls">
      <h3>
        Owner complaints <span className="count">{data ? data.count : data === null ? '—' : '…'}</span>
      </h3>
      {data === undefined ? (
        <p className="muted">Looking up what owners have reported to NHTSA…</p>
      ) : data === null ? (
        <p className="muted">NHTSA’s complaints service couldn’t be reached. Try again when you’re online.</p>
      ) : data.count === 0 ? (
        <p className="muted">
          No owner complaints to NHTSA about the {year} {make} {model}.
        </p>
      ) : (
        <>
          <p className="muted">
            What owners of the {year} {make} {model} told NHTSA, by the part involved. Popular cars get more complaints, so the parts matter more than the
            total.
          </p>
          <div className="chips">
            {data.components.map((c) => (
              <span key={c.name} className="chip chip--static">
                {c.name} <small>{c.count}</small>
              </span>
            ))}
          </div>
          {serious && <p className="muted">{serious}.</p>}
          <ul className="recalls">
            {data.latest.slice(0, 3).map((c, k) => (
              <li key={k}>
                <button className="recall" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
                  <span className="recall__what">{c.components.split(',')[0]}</span>
                  <span className="recall__when">{c.date}</span>
                </button>
                {open === k && (
                  <div className="recall__body">
                    <p>{c.summary}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
