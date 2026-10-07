import { describe, expect, it } from 'vitest';
import { checkAd, readAd, vinDrive } from './adcheck';
import type { VinDetails } from './types';

const MAKES = ['Toyota', 'Lexus', 'Land Rover', 'Chevrolet', 'Honda'];

describe('readAd', () => {
  it('reads the usual claims from a listing', () => {
    const ad = readAd('2019 Lexus UX 250h F Sport AWD hybrid, CVT, 45,231 miles, one owner. $27,500 OBO', MAKES, ['UX', 'NX', 'RX']);
    expect(ad).toMatchObject({ year: 2019, make: 'Lexus', model: 'UX', drive: 'awd', gearbox: 'cvt', hybrid: true, mileage: 45231, price: 27500 });
  });

  it('understands short forms: 45k mi, $18.5k, V6, 4x4, Chevy', () => {
    const ad = readAd('Chevy Silverado 4x4 V6 auto, 45k mi, asking $18.5k', MAKES);
    expect(ad).toMatchObject({ make: 'Chevrolet', drive: '4wd', cylinders: 6, gearbox: 'automatic', mileage: 45000, price: 18500 });
  });

  it('prefers the longer make name and reads litres', () => {
    expect(readAd('2016 Land Rover Range Rover 3.0L supercharged', MAKES)).toMatchObject({ make: 'Land Rover', displacement: 3 });
  });

  it("doesn't take a distance or a year for the mileage", () => {
    expect(readAd('2018 Honda Civic, 15 miles from downtown').mileage).toBeUndefined();
  });
});

describe('checkAd', () => {
  const prius: VinDetails = { year: 2013, make: 'Toyota', model: 'Prius', drive: '4x2', cylinders: 4, displacement: 1.8, config: 'I', fuel: 'Gasoline', fuel2: 'Electric', electrification: 'Strong HEV (Hybrid Electric Vehicle)' };

  it('matches what agrees and flags what doesn’t', () => {
    const rows = checkAd({ year: 2014, make: 'Toyota', model: 'Prius', drive: 'awd', displacement: 1.8, hybrid: true }, prius);
    const verdict = Object.fromEntries(rows.map((r) => [r.label, r.verdict]));
    expect(verdict).toEqual({ Year: 'differs', Make: 'match', Model: 'match', Drive: 'differs', Engine: 'match', Hybrid: 'match' });
  });

  it('says unknown when the VIN doesn’t encode it', () => {
    const rows = checkAd({ gearbox: 'manual', turbo: true }, prius);
    expect(rows.map((r) => r.verdict)).toEqual(['unknown', 'unknown']);
  });

  it('treats a CVT as an automatic, not the other way round', () => {
    expect(checkAd({ gearbox: 'automatic' }, { transmission: 'Continuously Variable Transmission (CVT)' })[0].verdict).toBe('match');
    expect(checkAd({ gearbox: 'cvt' }, { transmission: 'Automatic' })[0].verdict).toBe('unknown');
    expect(checkAd({ gearbox: 'manual' }, { transmission: 'Automatic' })[0].verdict).toBe('differs');
  });

  it('reads drive types the way NHTSA writes them', () => {
    expect(vinDrive('AWD/All-Wheel Drive')).toBe('all');
    expect(vinDrive('4WD/4-Wheel Drive/4x4')).toBe('all');
    expect(vinDrive('RWD/Rear-Wheel Drive')).toBe('rwd');
    expect(vinDrive('4x2')).toBe('two');
  });
});
