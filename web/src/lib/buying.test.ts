import { describe, expect, it } from 'vitest';
import { fairValue, mileageCheck, priceVerdict, summarise } from './buying';
import type { HistoryFacts } from './types';

const clean: HistoryFacts = { source: 'carfax', accidents: false, title: 'clean', owners: 2, serviceRecords: 7, lastMileage: 40000 };

describe('mileageCheck', () => {
  const oct2026 = new Date(2026, 9, 6);
  it('works out miles a year since the car went on sale', () => {
    const m = mileageCheck(80000, 2019, oct2026);
    expect(m.band).toBe('typical');
    expect(m.perYear).toBeGreaterThan(9000);
    expect(m.perYear).toBeLessThan(11000);
  });
  it('flags high and low use', () => {
    expect(mileageCheck(150000, 2020, oct2026).band).toBe('high');
    expect(mileageCheck(12000, 2018, oct2026).band).toBe('low');
  });
  it('catches an odometer showing less than a reported reading', () => {
    expect(mileageCheck(35000, 2019, oct2026, clean).rollback).toEqual({ reported: 40000, date: undefined });
    expect(mileageCheck(41000, 2019, oct2026, clean).rollback).toBeUndefined();
  });
});

describe('fairValue', () => {
  it('leaves a clean car at the KBB value', () => {
    expect(fairValue(20000, clean)).toEqual({ low: 20000, high: 20000, reasons: [] });
  });
  it('takes 10–25% off for a reported accident', () => {
    const v = fairValue(20000, { ...clean, accidents: true });
    expect([v.low, v.high]).toEqual([15000, 18000]);
    expect(v.reasons[0]).toMatch(/Carfax/);
  });
  it('takes 20–40% off for a branded title, and doesn’t add the accident on top', () => {
    const v = fairValue(20000, { ...clean, accidents: true, title: 'branded', titleBrands: ['Salvage'] });
    expect([v.low, v.high]).toEqual([12000, 16000]);
    expect(v.reasons).toHaveLength(1);
  });
  it('refuses to value a car whose mileage may be rolled back', () => {
    expect(fairValue(20000, clean, true).blocked).toBeTruthy();
  });
});

describe('priceVerdict', () => {
  const fair = { low: 15000, high: 18000, reasons: [] };
  it('compares the asking price with the range', () => {
    expect(priceVerdict(17000, fair).tone).toBe('good');
    expect(priceVerdict(18900, fair)).toEqual({ tone: 'warn', text: '$900 over the fair range.' });
    expect(priceVerdict(21000, fair).tone).toBe('bad');
  });
});

describe('summarise', () => {
  it('lists problems first, with questions for the seller, and what’s left to check', () => {
    const s = summarise({
      buying: { vin: { year: 2019 }, history: { ...clean, accidents: true, severity: 'moderate' }, nicb: 'clear' },
      claims: [{ label: 'Drive', ad: 'All-wheel drive', vin: '4x2', verdict: 'differs' }],
    });
    expect(s.findings[0].tone).not.toBe('good');
    expect(s.findings.some((f) => f.ask?.includes('invoice'))).toBe(true);
    expect(s.todo.map((t) => t.section)).toEqual(['ad', 'records', 'mileage', 'price']);
  });
  it('flags a VIN that belongs to a different car than the photo', () => {
    const s = summarise({ buying: { vin: {} }, vinName: 'Toyota Camry', photoName: 'Lexus ES', claims: [] });
    expect(s.findings[0]).toMatchObject({ tone: 'bad', section: 'vin' });
  });
});
