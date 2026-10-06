import { describe, expect, it } from 'vitest';
import { gearbox, listingTitle, specValue, writeListing, type IdentifiedCar } from './listing';
import type { SpecSheet } from './types';

const camry: SpecSheet = {
  year: 2019,
  make: 'Toyota',
  model: 'Camry',
  variants: [],
  groups: [
    {
      title: 'Powertrain',
      items: [
        { label: 'Engine', value: '2.5 L 4-cyl', source: 'EPA' },
        { label: 'Transmission', value: 'Automatic, 8', source: 'EPA' },
        { label: 'Drive', value: 'Front-Wheel Drive', source: 'EPA' },
      ],
    },
    {
      title: 'Fuel economy',
      items: [
        { label: 'City', value: '29 mpg', source: 'EPA' },
        { label: 'Highway', value: '41 mpg', source: 'EPA' },
        { label: 'Combined', value: '34 mpg', source: 'EPA' },
      ],
    },
    { title: 'Crash ratings', items: [{ label: 'Overall', value: '5 of 5 stars', source: 'NHTSA' }] },
  ],
  recalls: [],
  ratings: [],
  sources: [],
};

const car: IdentifiedCar = {
  id: 'c1',
  createdAt: 0,
  identity: { make: 'Toyota', model: 'Camry', yearFrom: 2019, yearTo: 2019, year: 2019, source: 'manual' },
  color: { name: 'Red', hex: '#b3202a' },
  condition: {
    pins: [
      { id: 'p1', kind: 'scratch', note: 'Long scratch on the rear bumper.', createdAt: 0 },
      { id: 'p2', kind: 'dent', note: '', createdAt: 0, fixed: true },
    ],
  },
};

describe('gearbox', () => {
  it('reads EPA transmission strings as people say them', () => {
    expect(gearbox('Automatic, 8')).toBe('8-speed automatic');
    expect(gearbox('Manual, 6')).toBe('6-speed manual');
    expect(gearbox('Automatic, S10')).toBe('10-speed automatic');
    expect(gearbox('Automatic, CVT')).toBe('CVT automatic');
    expect(gearbox(undefined)).toBeUndefined();
  });
});

describe('listing', () => {
  it('writes the detailed listing from the specs and the details', () => {
    const text = writeListing(car, camry, { style: 'detailed', price: 18500, mileage: 52000, condition: 'good', location: 'Atlanta, GA' });
    expect(text).toContain('For sale: my red 2019 Toyota Camry, with 52,000 miles.');
    expect(text).toContain('It has the 2.5 L 4-cyl engine with an 8-speed automatic and front-wheel drive.');
    expect(text).toContain('29/41 mpg city/highway (34 mpg combined)');
    expect(text).toContain('5 out of 5 stars overall');
    expect(text).toContain('Asking $18,500.');
    expect(text).not.toContain('known marks');
  });

  it('mentions only open condition marks, and only when asked', () => {
    const text = writeListing(car, camry, { style: 'detailed', includeCondition: true });
    expect(text).toContain('known marks: long scratch on the rear bumper.');
    expect(text).not.toContain('dent');
  });

  it('writes a short listing as bullet lines', () => {
    const text = writeListing(car, camry, { style: 'short', price: 18500, mileage: 52000, extras: 'Roof rack\n- New tyres' });
    expect(text.split('\n')[0]).toBe('2019 Toyota Camry for sale, $18,500.');
    expect(text).toContain('• 2.5 L 4-cyl, 8-speed automatic, front-wheel drive');
    expect(text).toContain('• Extras: Roof rack, New tyres');
  });

  it('still writes something sensible without a spec sheet', () => {
    const text = writeListing(car, null, { style: 'detailed', mileage: 1000 });
    expect(text).toContain('2019 Toyota Camry, with 1,000 miles.');
    expect(text).not.toContain('undefined');
  });

  it('builds the title from the year, model, engine and mileage', () => {
    expect(listingTitle(car, camry, { mileage: 52000 })).toBe('2019 Toyota Camry · 2.5 L 4-cyl · 52,000 mi');
    expect(specValue(camry, 'Combined')).toBe('34 mpg');
  });
});
