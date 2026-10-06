import { useEffect, useState } from 'react';
import { catalog } from '../lib/vehicle';

export interface Pick {
  make: string;
  model: string;
  year: number;
}

/** Make → model → year, from the EPA list of every car sold in the U.S. since 1984. */
export function ManualPicker({ initial, onPick }: { initial?: Partial<Pick>; onPick: (p: Pick) => void }) {
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<{ model: string; yearFrom: number; yearTo: number }[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState<number | ''>(initial?.year ?? '');

  useEffect(() => {
    void catalog.makes().then(setMakes);
  }, []);
  useEffect(() => {
    setModels([]);
    if (make) void catalog.models(make).then(setModels);
  }, [make]);
  useEffect(() => {
    setYears([]);
    if (make && model) void catalog.years(make, model).then((y) => setYears([...y].reverse()));
  }, [make, model]);

  return (
    <div className="picker">
      <label className="field">
        <span className="field__label">Make</span>
        <select className="select" value={make} onChange={(e) => (setMake(e.target.value), setModel(''), setYear(''))}>
          <option value="">Choose…</option>
          {makes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Model</span>
        <select className="select" value={model} disabled={!models.length} onChange={(e) => (setModel(e.target.value), setYear(''))}>
          <option value="">Choose…</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.yearFrom}–{m.yearTo})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Year</span>
        <select className="select" value={year} disabled={!years.length} onChange={(e) => setYear(Number(e.target.value))}>
          <option value="">Choose…</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>
      <button className="btn" disabled={!make || !model || !year} onClick={() => onPick({ make, model, year: Number(year) })}>
        Use this car
      </button>
    </div>
  );
}
