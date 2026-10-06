import { useState } from 'react';
import { go, href, type CarTab } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { Car } from '../lib/types';
import type { VinResult } from '../lib/vehicle';
import { ManualPicker } from '../ui/ManualPicker';
import { SpecSheetView } from '../ui/SpecSheetView';
import { VinEntry } from '../ui/VinEntry';
import { CarCapture } from './car/Capture';
import { Car360 } from './car/Car360';
import { CarCondition } from './car/Condition';
import { CarMods } from './car/Mods';
import { CarSell } from './car/Sell';

const TABS: { id: CarTab; label: string }[] = [
  { id: '360', label: '360' },
  { id: 'specs', label: 'Specs' },
  { id: 'mods', label: 'Mods' },
  { id: 'condition', label: 'Condition' },
  { id: 'sell', label: 'Sell' },
];

function Specs({ car }: { car: Car }) {
  const updateCar = useGarage((s) => s.updateCar);
  const [edit, setEdit] = useState<'vin' | 'manual' | null>(null);
  const i = car.identity;
  if (!i) return null;
  const fromVin = (v: VinResult) => {
    if (!v.family) return;
    void updateCar(car.id, {
      identity: { ...i, make: v.family.make, model: v.family.model, yearFrom: v.family.year, yearTo: v.family.year, year: v.family.year, vin: v.vin, trim: v.trim ?? undefined, source: 'vin', variant: undefined },
    });
    setEdit(null);
  };
  return (
    <div className="carspecs">
      <div className="carspecs__bar">
        <p className="muted">
          {i.source === 'vin'
            ? `Exact, from VIN ${i.vin}.`
            : i.source === 'photo'
              ? `Identified from a photo${i.confidence ? ` (${Math.round(i.confidence * 100)}% match)` : ''}. Add the VIN to be sure of the year and trim.`
              : 'Picked by you.'}
        </p>
        <div className="actions">
          {i.source !== 'vin' && (
            <button className="btn btn--sm" onClick={() => setEdit(edit === 'vin' ? null : 'vin')}>
              Add the VIN
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setEdit(edit === 'manual' ? null : 'manual')}>
            Change car
          </button>
        </div>
      </div>
      {edit && (
        <section className="panelbox">
          {edit === 'vin' ? (
            <VinEntry onFound={fromVin} />
          ) : (
            <ManualPicker
              initial={{ make: i.make, model: i.model, year: i.year }}
              onPick={(p) => {
                void updateCar(car.id, { identity: { ...i, make: p.make, model: p.model, yearFrom: p.year, yearTo: p.year, year: p.year, source: 'manual', variant: undefined } });
                setEdit(null);
              }}
            />
          )}
        </section>
      )}
      <SpecSheetView
        year={i.year ?? i.yearTo}
        make={i.make}
        model={i.model}
        variant={i.variant}
        vin={i.vin}
        onVariant={(v) => void updateCar(car.id, { identity: { ...i, variant: v } })}
        onLoaded={(s) => {
          if (s.variant !== car.specs?.variant || !car.specs) void updateCar(car.id, { specs: s });
        }}
      />
    </div>
  );
}

function Header({ car }: { car: Car }) {
  const updateCar = useGarage((s) => s.updateCar);
  const removeCar = useGarage((s) => s.removeCar);
  const [naming, setNaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(car.nickname ?? '');
  const i = car.identity;
  return (
    <header className="carhead">
      <a className="carhead__back" href={href({ page: 'garage' })}>
        ← My garage
      </a>
      <div className="carhead__row">
        <div>
          {naming ? (
            <form
              className="carhead__name-form"
              onSubmit={(e) => {
                e.preventDefault();
                void updateCar(car.id, { nickname: name.trim() || undefined });
                setNaming(false);
              }}
            >
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={carName(i)} />
              <button className="btn btn--sm">Save</button>
            </form>
          ) : (
            <h1 className="display carhead__name">{car.nickname || carName(i)}</h1>
          )}
          <p className="carhead__meta">
            {car.nickname && <span>{carName(i)}</span>}
            {i?.trim && <span>{i.trim}</span>}
            {car.color && (
              <span className="paint">
                <i style={{ background: car.color.hex }} /> {car.color.name}
              </span>
            )}
            {i?.vin && <span className="tagchip">VIN {i.vin}</span>}
          </p>
        </div>
        <div className="actions">
          {!naming && (
            <button className="btn btn--ghost btn--sm" onClick={() => setNaming(true)}>
              {car.nickname ? 'Rename' : 'Give it a name'}
            </button>
          )}
          {confirm ? (
            <>
              <span className="muted">Remove this car and its photos and 3D model?</span>
              <button
                className="btn btn--sm btn--danger"
                onClick={async () => {
                  await removeCar(car.id);
                  go({ page: 'garage' });
                }}
              >
                Remove
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(true)}>
              Remove
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function CarPage({ id, tab }: { id: string; tab: CarTab }) {
  const car = useGarage((s) => s.cars.find((c) => c.id === id));
  const loaded = useGarage((s) => s.loaded);

  if (!car)
    return (
      <div className="page wrap">
        {loaded && (
          <div className="empty">
            <p>This car isn’t in your garage. It may have been removed.</p>
            <a className="btn" href={href({ page: 'garage' })}>
              Back to my garage
            </a>
          </div>
        )}
      </div>
    );

  const active = tab === 'capture' ? '360' : tab;
  return (
    <div className="page wrap carpage">
      <Header car={car} />
      <nav className="cartabs" aria-label="Car">
        {TABS.map((t) => (
          <a key={t.id} href={href({ page: 'car', id, tab: t.id })} aria-current={active === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      <div className="carbody">
        {tab === '360' && <Car360 car={car} />}
        {tab === 'capture' && <CarCapture car={car} />}
        {tab === 'specs' && <Specs car={car} />}
        {tab === 'mods' && <CarMods car={car} />}
        {tab === 'condition' && <CarCondition car={car} />}
        {tab === 'sell' && <CarSell car={car} />}
      </div>
    </div>
  );
}
