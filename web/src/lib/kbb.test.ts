import { describe, expect, it } from 'vitest';
import { kbbUrl } from './kbb';

const car = (make: string, model: string, yearFrom: number, yearTo = yearFrom, year?: number) => ({
  make,
  model,
  yearFrom,
  yearTo,
  year,
  source: 'manual' as const,
});

describe('kbbUrl', () => {
  it('builds KBB’s make/model/year address', () => {
    expect(kbbUrl(car('Lexus', 'UX', 2019))).toBe('https://www.kbb.com/lexus/ux/2019/');
    expect(kbbUrl(car('BMW', '3 Series', 2019))).toBe('https://www.kbb.com/bmw/3-series/2019/');
    expect(kbbUrl(car('Honda', 'CR-V', 2020))).toBe('https://www.kbb.com/honda/cr-v/2020/');
  });
  it('goes to the model page when the year is still a range', () => {
    expect(kbbUrl(car('Lexus', 'UX', 2019, 2023))).toBe('https://www.kbb.com/lexus/ux/');
  });
  it('gives nothing for cars too old for KBB to price', () => {
    expect(kbbUrl(car('Chevrolet', 'Pickup', 1957))).toBeNull();
  });
});
