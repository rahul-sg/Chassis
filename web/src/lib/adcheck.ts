import type { VinDetails } from './types';

/**
 * "Does it match the ad?": what a pasted listing claims, read by plain rules, set against what
 * the VIN says the car was built as. Only claims the VIN can settle are judged; when the VIN
 * doesn't say (makers leave fields out), the row says so instead of guessing.
 */

export type Drive = 'awd' | '4wd' | 'fwd' | 'rwd';
export type Gearbox = 'manual' | 'automatic' | 'cvt';

export interface AdClaims {
  year?: number;
  make?: string;
  model?: string;
  drive?: Drive;
  displacement?: number;
  cylinders?: number;
  gearbox?: Gearbox;
  hybrid?: boolean;
  electric?: boolean;
  diesel?: boolean;
  turbo?: boolean;
  mileage?: number;
  price?: number;
}

export type Verdict = 'match' | 'differs' | 'unknown';

export interface ClaimRow {
  label: string;
  ad: string;
  vin: string;
  verdict: Verdict;
}

const ALIASES: Record<string, string> = { chevy: 'Chevrolet', vw: 'Volkswagen', mercedes: 'Mercedes-Benz', benz: 'Mercedes-Benz' };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ')} `;
const num = (s: string) => Number(s.replace(/,/g, ''));

/** "45k", "45.2k", "45,231" → miles or dollars. */
function amount(s: string): number {
  const k = s.match(/^([\d.]+)\s*k$/i);
  return k ? Math.round(Number(k[1]) * 1000) : num(s);
}

/** What a listing claims. `makes` and `models` (for the VIN's make) come from the catalogue. */
export function readAd(text: string, makes: string[] = [], models: string[] = []): AdClaims {
  const t = text.replace(/ /g, ' ');
  const w = words(t);
  const out: AdClaims = {};

  const year = t.match(/\b(19[89]\d|20[0-4]\d)\b/);
  if (year) out.year = Number(year[1]);

  const byLength = (xs: string[]) => [...xs].sort((a, b) => b.length - a.length);
  for (const m of byLength(makes)) {
    if (w.includes(words(m))) {
      out.make = m;
      break;
    }
  }
  if (!out.make)
    for (const [alias, make] of Object.entries(ALIASES))
      if (w.includes(` ${alias} `)) {
        out.make = make;
        break;
      }
  for (const m of byLength(models)) {
    if (w.includes(words(m)) || (norm(m).length >= 4 && norm(t).includes(norm(m)))) {
      out.model = m;
      break;
    }
  }

  if (/\b(awd|all[- ]wheel)/i.test(t)) out.drive = 'awd';
  else if (/\b(4wd|4x4|four[- ]wheel)/i.test(t)) out.drive = '4wd';
  else if (/\b(fwd|front[- ]wheel)/i.test(t)) out.drive = 'fwd';
  else if (/\b(rwd|rear[- ]wheel)/i.test(t)) out.drive = 'rwd';

  const litres = t.match(/\b(\d\.\d)\s*(?:l\b|-?lit(?:er|re))/i);
  if (litres) out.displacement = Number(litres[1]);
  const vee = t.match(/\b[vw](6|8|10|12)\b/i) ?? t.match(/\b(?:i|inline|straight)[- ]?(3|4|5|6)\b/i) ?? t.match(/\b(3|4|5|6|8|10|12)[- ]?cyl/i);
  const named = t.match(/\b(four|six|eight)[- ]cylinder/i);
  if (vee) out.cylinders = Number(vee[1]);
  else if (named) out.cylinders = { four: 4, six: 6, eight: 8 }[named[1].toLowerCase() as 'four' | 'six' | 'eight'];

  if (/\b(cvt|continuously variable)\b/i.test(t)) out.gearbox = 'cvt';
  else if (/\b(manual|stick ?shift|\d-?speed manual|\dmt)\b/i.test(t)) out.gearbox = 'manual';
  else if (/\b(automatic|\d-?speed auto|auto(?! ?(?:shop|body|parts|insurance|loan))\b)/i.test(t)) out.gearbox = 'automatic';

  if (/\b(plug-in|phev|hybrid)\b/i.test(t)) out.hybrid = true;
  if (/\b(all[- ]electric|fully electric|battery electric|\bev\b)/i.test(t) && !out.hybrid) out.electric = true;
  if (/\bdiesel\b|\btdi\b/i.test(t)) out.diesel = true;
  if (/\bturbo/i.test(t)) out.turbo = true;

  // "45,231 miles", "45k mi", "Mileage: 45231"; a bare "15 miles from town" is too short to be one.
  const miles =
    t.match(/(\d{1,3}(?:,\d{3})+|\d{3,6}|\d+(?:\.\d)?\s*k)\s*(?:miles|mi\b)/i) ??
    t.match(/(?:mileage|odometer|odo)\s*[:-]?\s*(\d{1,3}(?:,\d{3})+|\d{2,6}|\d+(?:\.\d)?\s*k)/i);
  if (miles) {
    const m = amount(miles[1].trim());
    if (m < 1_000_000) out.mileage = m;
  }
  const price = t.match(/\$\s*([\d,]+(?:\.\d+)?\s*k?)/i) ?? t.match(/(?:price|asking)\s*[:-]?\s*([\d,]{4,})/i);
  if (price) {
    const p = amount(price[1].trim());
    if (p >= 500) out.price = p;
  }
  return out;
}

const DRIVE_LABEL: Record<Drive, string> = { awd: 'All-wheel drive', '4wd': 'Four-wheel drive', fwd: 'Front-wheel drive', rwd: 'Rear-wheel drive' };

/** NHTSA's drive type in plain words ("4x2" is two-wheel drive, front or rear). */
export function driveText(d: string): string {
  return /^4x2$/i.test(d.trim()) ? '4x2 (two-wheel drive)' : d.replace(/^[A-Z0-9]+\//, '');
}

/** NHTSA's electrification level in plain words. */
export function powerText(electrification?: string, fuel?: string): string | undefined {
  const e = electrification ?? '';
  if (/^BEV/i.test(e)) return 'Electric';
  if (/^PHEV/i.test(e)) return 'Plug-in hybrid';
  if (/mild/i.test(e)) return 'Mild hybrid';
  if (/HEV/i.test(e)) return 'Hybrid';
  return fuel;
}

/** The VIN's drive type as all wheels, front, rear, or two (4x2: front or rear, it doesn't say). */
export function vinDrive(d?: string): 'all' | 'fwd' | 'rwd' | 'two' | undefined {
  if (!d) return undefined;
  if (/awd|all|4wd|4x4|4-wheel/i.test(d)) return 'all';
  if (/fwd|front/i.test(d)) return 'fwd';
  if (/rwd|rear/i.test(d)) return 'rwd';
  if (/4x2|2wd/i.test(d)) return 'two';
  return undefined;
}

function vinGearbox(t?: string): Gearbox | undefined {
  if (!t) return undefined;
  if (/cvt|continuously/i.test(t)) return 'cvt';
  if (/manual|standard/i.test(t)) return 'manual';
  if (/automatic/i.test(t)) return 'automatic';
  return undefined;
}

/** "2.0 L 4-cyl", "6.2 L V8". */
function engine(d: VinDetails): string {
  const cyl = d.cylinders ? (d.config && d.config !== 'I' ? `${d.config}${d.cylinders}` : `${d.cylinders}-cyl`) : '';
  return [d.displacement ? `${d.displacement.toFixed(1)} L` : '', cyl].filter(Boolean).join(' ');
}

/** Each claim the ad makes that the VIN can speak to. `family` is the EPA family the VIN maps to. */
export function checkAd(ad: AdClaims, vin: VinDetails, family?: { make: string; model: string }): ClaimRow[] {
  const rows: ClaimRow[] = [];
  const row = (label: string, adSays: string, vinSays: string | undefined, same: boolean | undefined) =>
    rows.push({ label, ad: adSays, vin: vinSays ?? 'Not in the VIN', verdict: vinSays == null || same == null ? 'unknown' : same ? 'match' : 'differs' });

  if (ad.year) row('Year', String(ad.year), vin.year ? String(vin.year) : undefined, vin.year ? ad.year === vin.year : undefined);
  if (ad.make) row('Make', ad.make, vin.make, vin.make ? norm(ad.make) === norm(vin.make) : undefined);
  if (ad.model) {
    const names = [vin.model, family?.model].filter(Boolean).map((m) => norm(m!));
    const same = names.some((n) => n === norm(ad.model!) || n.startsWith(norm(ad.model!)) || norm(ad.model!).startsWith(n));
    row('Model', ad.model, family?.model ?? vin.model, names.length ? same : undefined);
  }
  if (ad.drive) {
    const v = vinDrive(vin.drive);
    const all = ad.drive === 'awd' || ad.drive === '4wd';
    const same = v == null ? undefined : v === 'all' ? all : v === 'two' ? !all : !all && v === ad.drive;
    row('Drive', DRIVE_LABEL[ad.drive], vin.drive ? driveText(vin.drive) : undefined, same);
  }
  if (ad.displacement || ad.cylinders) {
    const adEngine = [ad.displacement ? `${ad.displacement.toFixed(1)} L` : '', ad.cylinders ? `${ad.cylinders}-cyl` : ''].filter(Boolean).join(' ');
    const checks: boolean[] = [];
    if (ad.displacement && vin.displacement) checks.push(Math.abs(ad.displacement - vin.displacement) <= 0.1);
    if (ad.cylinders && vin.cylinders) checks.push(ad.cylinders === vin.cylinders);
    row('Engine', adEngine, engine(vin) || undefined, checks.length ? checks.every(Boolean) : undefined);
  }
  if (ad.gearbox) {
    const v = vinGearbox(vin.transmission);
    // A CVT is an automatic, and some makers code their CVTs as plain "Automatic".
    const same = v == null ? undefined : v === ad.gearbox || (ad.gearbox === 'automatic' && v === 'cvt') ? true : ad.gearbox === 'cvt' && v === 'automatic' ? undefined : false;
    const label = { manual: 'Manual', automatic: 'Automatic', cvt: 'CVT' }[ad.gearbox];
    row('Transmission', label, vin.transmission ? `${vin.transmission}${vin.speeds ? `, ${vin.speeds}-speed` : ''}` : undefined, same);
  }
  const electrified = /hev|hybrid/i.test(vin.electrification ?? '') || /electric/i.test(vin.fuel2 ?? '');
  const fuelKnown = vin.fuel != null || vin.electrification != null;
  if (ad.hybrid) row('Hybrid', 'Hybrid', fuelKnown ? powerText(vin.electrification, vin.fuel) : undefined, fuelKnown ? electrified : undefined);
  if (ad.electric) row('Electric', 'Electric', vin.fuel, vin.fuel ? /electric/i.test(vin.fuel) : undefined);
  if (ad.diesel) row('Diesel', 'Diesel', vin.fuel, vin.fuel ? /diesel/i.test(vin.fuel) : undefined);
  if (ad.turbo) row('Turbo', 'Turbo', vin.turbo ? 'Turbo' : undefined, vin.turbo ? true : undefined);
  return rows;
}
