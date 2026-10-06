import { useMemo, useState } from 'react';
import { go, href } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { Spotted } from '../lib/types';
import { SpottedCard, SpottedDialog } from '../ui/Spotted';

/** Every car identified from a photo, as a collection: what it was, when, and tallies. */
export function SpottedPage() {
  const spotted = useGarage((s) => s.spotted);
  const loaded = useGarage((s) => s.loaded);
  const [sort, setSort] = useState<'new' | 'make'>('new');
  const [open, setOpen] = useState<Spotted | null>(null);

  const list = useMemo(
    () => (sort === 'new' ? spotted : [...spotted].sort((a, b) => carName(a.identity, false).localeCompare(carName(b.identity, false)))),
    [spotted, sort],
  );
  const makes = new Set(spotted.map((s) => s.identity.make));
  const top = [...makes].map((m) => [m, spotted.filter((s) => s.identity.make === m).length] as const).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="page wrap spotted">
      <header className="page__head">
        <div>
          <p className="eyebrow">Spotted</p>
          <h1 className="display">{spotted.length ? `${spotted.length} car${spotted.length > 1 ? 's' : ''} spotted` : 'Nothing spotted yet'}</h1>
          <p>Every car you identify from a photo lands here with what it is and its headline figures. Open one for the full spec sheet.</p>
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

      {spotted.length > 0 && (
        <div className="spotted__bar">
          {spotted.length > 1 ? (
            <div className="seg" role="group" aria-label="Sort">
              <button aria-pressed={sort === 'new'} onClick={() => setSort('new')}>
                Newest
              </button>
              <button aria-pressed={sort === 'make'} onClick={() => setSort('make')}>
                By make
              </button>
            </div>
          ) : (
            <span />
          )}
          <a className="btn" href={href({ page: 'identify', quick: true })}>
            Spot more
          </a>
        </div>
      )}

      {list.length > 0 && (
        <div className="spots">
          {list.map((s) => (
            <SpottedCard key={s.id} s={s} onOpen={() => setOpen(s)} />
          ))}
        </div>
      )}
      {loaded && spotted.length === 0 && (
        <div className="empty">
          <p>Identify a car from a photo and it lands here. On your phone, quick spotting keeps the camera open so you can log every car on the street.</p>
          <button className="btn btn--accent" onClick={() => go({ page: 'identify' })}>
            Identify a car
          </button>
        </div>
      )}

      {open && <SpottedDialog s={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
