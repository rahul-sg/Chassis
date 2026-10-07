import type { ClaimRow } from './adcheck';
import type { BuyingInfo, HistoryFacts } from './types';

/**
 * The arithmetic behind the Buying tab: miles a year, a fair price from the KBB value you looked
 * up, and what that means for the asking price. Every adjustment carries its reason and source.
 */

/** Miles a year an average U.S. vehicle covers (FHWA, 2024: 11,327). */
export const AVERAGE_MILES = 11_300;

export interface MileageCheck {
  perYear: number;
  years: number;
  band: 'low' | 'typical' | 'high';
  /** The history report recorded more miles than the odometer shows now. */
  rollback?: { reported: number; date?: string | null };
}

/** How hard it's been used: miles a year since it was new (a model year goes on sale the autumn before). */
export function mileageCheck(miles: number, modelYear: number, now = new Date(), history?: HistoryFacts | null): MileageCheck {
  const years = Math.max(0.5, now.getFullYear() + now.getMonth() / 12 - (modelYear - 0.25));
  const perYear = Math.round(miles / years / 100) * 100;
  const band = perYear < 7000 ? 'low' : perYear > 15000 ? 'high' : 'typical';
  const out: MileageCheck = { perYear, years: Math.round(years * 10) / 10, band };
  if (history?.lastMileage && miles < history.lastMileage - 50) out.rollback = { reported: history.lastMileage, date: history.lastMileageDate };
  return out;
}

export interface FairValue {
  low: number;
  high: number;
  /** Why it's below the KBB value, with where the figure comes from. */
  reasons: string[];
  /** The value can't be judged at all. */
  blocked?: string;
}

const round = (n: number) => Math.round(n / 50) * 50;

/**
 * KBB values assume a clean title and no accident history; this takes off what the history
 * report shows. A branded title or insurance total loss: 20–40% (Kelley Blue Book's rule of
 * thumb). A reported accident: 10–25% (Carfax), less when it was minor, more when it was severe
 * or structural. The worst one applies, not the sum: a branded title already reflects the crash.
 */
export function fairValue(kbb: number, history?: HistoryFacts | null, rollback = false): FairValue {
  if (rollback || history?.odometerProblem)
    return { low: kbb, high: kbb, reasons: [], blocked: 'The mileage may have been rolled back, so no value holds until that’s explained.' };
  let cut: [number, number] = [0, 0];
  const reasons: string[] = [];
  if (history?.title === 'branded' || history?.totalLoss) {
    cut = [0.2, 0.4];
    reasons.push(
      `${history.title === 'branded' ? `${history.titleBrands?.join(', ') || 'Branded'} title` : 'Insurance total loss'}: 20–40% less (Kelley Blue Book’s rule of thumb).`,
    );
  } else if (history?.accidents) {
    const bad = history.structural || history.airbag || history.severity === 'severe';
    cut = history.severity === 'minor' && !bad ? [0.05, 0.1] : bad ? [0.2, 0.3] : [0.1, 0.25];
    const what = bad
      ? history.structural
        ? 'Structural damage reported'
        : history.airbag
          ? 'Accident with airbags deployed'
          : 'Severe damage reported'
      : history.severity === 'minor'
        ? 'Minor damage reported'
        : 'Accident or damage reported';
    const source = bad || history.severity === 'minor' ? 'typical estimate' : 'Carfax’s estimate';
    reasons.push(`${what}: ${Math.round(cut[0] * 100)}–${Math.round(cut[1] * 100)}% less (${source}).`);
  }
  return { low: round(kbb * (1 - cut[1])), high: round(kbb * (1 - cut[0])), reasons };
}

export type PriceVerdict = { tone: 'good' | 'warn' | 'bad'; text: string };

/** The asking price against the fair range. */
export function priceVerdict(asking: number, fair: FairValue): PriceVerdict {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  if (asking <= fair.low) return { tone: 'good', text: `${money(fair.low - asking)} under the fair range.` };
  if (asking <= fair.high) return { tone: 'good', text: 'Within the fair range.' };
  const over = asking - fair.high;
  return { tone: over / fair.high > 0.1 ? 'bad' : 'warn', text: `${money(over)} over the fair range.` };
}

/** The KBB value and asking price are both needed for a verdict. */
export const priced = (b?: BuyingInfo) => !!(b?.kbb && b.asking);

export type Section = 'vin' | 'ad' | 'records' | 'history' | 'mileage' | 'price';

export interface Finding {
  tone: 'good' | 'warn' | 'bad';
  text: string;
  /** What to do about it. */
  detail?: string;
  /** A question for the seller. */
  ask?: string;
  section: Section;
}

export interface Summary {
  findings: Finding[];
  /** Checks not done yet. */
  todo: { section: Section; text: string }[];
}

const nice = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Everything the checks found, worst first, and what's left to check. */
export function summarise(input: {
  buying: BuyingInfo;
  vinName?: string;
  photoName?: string;
  claims: ClaimRow[];
  mileage?: MileageCheck;
  fair?: FairValue;
  verdict?: PriceVerdict;
}): Summary {
  const { buying: b, claims, mileage, fair, verdict } = input;
  const f: Finding[] = [];
  const todo: Summary['todo'] = [];
  const h = b.history;

  if (!b.vin) todo.push({ section: 'vin', text: 'Add the VIN' });
  else if (input.photoName && input.vinName && input.photoName !== input.vinName)
    f.push({
      tone: 'bad',
      section: 'vin',
      text: `The VIN is for a ${input.vinName}, but the photo looked like a ${input.photoName}.`,
      ask: 'Is the VIN I was given from this car?',
    });

  if (!b.ad) todo.push({ section: 'ad', text: 'Paste the ad' });
  else if (b.vin) {
    const off = claims.filter((c) => c.verdict === 'differs');
    for (const c of off)
      f.push({
        tone: ['Year', 'Make', 'Model'].includes(c.label) ? 'bad' : 'warn',
        section: 'ad',
        text: ['Year', 'Make', 'Model'].includes(c.label)
          ? `The ad says the ${c.label.toLowerCase()} is ${c.ad}; the VIN says ${c.vin}.`
          : `The ad says ${c.label === 'Drive' ? c.ad.toLowerCase() : c.ad}; the VIN says ${c.vin}.`,
        ask: `The ad says ${c.label === 'Drive' ? c.ad.toLowerCase() : c.ad}, but the VIN says ${c.vin}. Which is right?`,
      });
    const ok = claims.filter((c) => c.verdict === 'match').length;
    if (!off.length && ok) f.push({ tone: 'good', section: 'ad', text: `The ad matches the VIN on ${ok} point${ok > 1 ? 's' : ''}.` });
  }

  if (b.nicb === 'found')
    f.push({ tone: 'bad', section: 'records', text: 'NICB has a theft or insurance total-loss record for this VIN.', ask: 'Why does NICB have a theft or total-loss record for it?' });
  else if (b.nicb === 'clear') f.push({ tone: 'good', section: 'records', text: 'No theft or total-loss record at NICB.' });
  else todo.push({ section: 'records', text: 'Check NICB' });
  if (b.openRecalls === 'found')
    f.push({
      tone: 'warn',
      section: 'records',
      text: 'It has safety recalls that haven’t been fixed.',
      detail: 'Recall repairs are free at any dealer for the brand, whoever owns the car.',
      ask: 'Will you have the open recalls fixed before the sale?',
    });
  else if (b.openRecalls === 'clear') f.push({ tone: 'good', section: 'records', text: 'No unfixed safety recalls.' });
  else todo.push({ section: 'records', text: 'Check open recalls' });

  if (!h) todo.push({ section: 'history', text: 'Add the history report' });
  else {
    if (h.title === 'branded')
      f.push({
        tone: 'bad',
        section: 'history',
        text: `${h.titleBrands?.length ? h.titleBrands.map(nice).join(', ') : 'Branded'} title.`,
        ask: 'Why is the title branded, and do you have the repair records?',
      });
    else if (h.title === 'clean') f.push({ tone: 'good', section: 'history', text: 'Clean title.' });
    if (h.totalLoss) f.push({ tone: 'bad', section: 'history', text: 'An insurer declared it a total loss.', ask: 'It was a total loss: who rebuilt it, and how?' });
    if (h.odometerProblem) f.push({ tone: 'bad', section: 'history', text: 'The report flags a possible odometer rollback.' });
    if (h.accidents) {
      const serious = h.structural || h.airbag || h.severity === 'severe';
      const times = h.damageCount && h.damageCount > 1 ? `${h.damageCount} times` : '';
      const how = h.structural ? 'structural damage' : h.airbag ? 'airbags deployed' : h.severity ? `${h.severity} damage` : '';
      f.push({
        tone: serious ? 'bad' : 'warn',
        section: 'history',
        text: `Accident or damage reported${times ? ` ${times}` : ''}${how ? ` (${how})` : ''}.`,
        detail:
          'Have a body shop look it over, or check the panels with a paint thickness gauge (about $30): repainted panels read thicker than the rest.',
        ask: 'What was damaged, and who repaired it? Can I see the invoice?',
      });
    } else if (h.accidents === false) f.push({ tone: 'good', section: 'history', text: 'No accidents or damage reported.' });
    if (h.owners != null && h.owners >= 4)
      f.push({ tone: 'warn', section: 'history', text: `${h.owners} owners so far.`, ask: 'Why has it changed hands so often?' });
    else if (h.owners === 1) f.push({ tone: 'good', section: 'history', text: 'One owner.' });
    if (h.serviceRecords === 0 || (h.serviceRecords == null && h.source === 'you'))
      f.push({ tone: 'warn', section: 'history', text: 'No service records reported.', ask: 'Do you have the service records?' });
    else if (h.serviceRecords) f.push({ tone: 'good', section: 'history', text: `${h.serviceRecords} service record${h.serviceRecords > 1 ? 's' : ''}.` });
  }

  if (!mileage) todo.push({ section: 'mileage', text: 'Enter the mileage' });
  else if (mileage.rollback)
    f.push({
      tone: 'bad',
      section: 'mileage',
      text: `The odometer shows fewer miles than the ${mileage.rollback.reported.toLocaleString('en-US')} already reported${mileage.rollback.date ? ` on ${mileage.rollback.date}` : ''}.`,
      ask: 'The odometer reads lower than the mileage on record. Has the instrument cluster been replaced?',
    });
  else if (mileage.band === 'high')
    f.push({ tone: 'warn', section: 'mileage', text: `High mileage: about ${mileage.perYear.toLocaleString('en-US')} miles a year.` });
  else f.push({ tone: 'good', section: 'mileage', text: `${mileage.band === 'low' ? 'Low' : 'Average'} mileage: about ${mileage.perYear.toLocaleString('en-US')} miles a year.` });

  if (fair?.blocked) {
    // Already a finding under the mileage or the history report.
  } else if (verdict) f.push({ tone: verdict.tone, section: 'price', text: `Asking price: ${verdict.text.charAt(0).toLowerCase()}${verdict.text.slice(1)}` });
  else todo.push({ section: 'price', text: 'Check the price' });

  const order = { bad: 0, warn: 1, good: 2 };
  return { findings: f.sort((a, b) => order[a.tone] - order[b.tone]), todo };
}
