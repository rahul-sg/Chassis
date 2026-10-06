import type { Car, Identity, SellCondition, SellInfo, SpecSheet } from './types';

/** A car whose make and model are known: the listing needs them. */
export type IdentifiedCar = Car & { identity: Identity };

/** A spec value by its label, e.g. "Engine" → "2.5 L 4-cyl". */
export function specValue(sheet: SpecSheet | null | undefined, label: string): string | undefined {
  return sheet?.groups.flatMap((g) => g.items).find((i) => i.label === label)?.value;
}

/** EPA's "Automatic, 8" → "8-speed automatic"; "Automatic, CVT" → "CVT automatic". */
export function gearbox(v?: string): string | undefined {
  if (!v) return undefined;
  const [kind, detail] = v.split(',').map((s) => s.trim());
  const k = kind.toLowerCase();
  if (!detail) return k;
  const speeds = detail.match(/^(?:[A-Z]+)?(\d+)$/);
  if (speeds) return `${speeds[1]}-speed ${k}`;
  if (/cvt/i.test(detail)) return 'CVT automatic';
  return `${k} (${detail})`;
}

const CONDITION: Record<SellCondition, { label: string; line: string }> = {
  excellent: { label: 'Excellent condition', line: 'It’s in excellent condition, inside and out.' },
  good: { label: 'Good condition', line: 'It’s in good condition, with normal wear for its age.' },
  fair: { label: 'Fair condition', line: 'It’s in fair condition: it drives well, with some cosmetic wear.' },
  rough: { label: 'Needs work', line: 'It needs some work, and it’s priced to match.' },
};
export const CONDITIONS = (Object.keys(CONDITION) as SellCondition[]).map((id) => ({ id, label: CONDITION[id].label }));

const money = (n?: number) => (n ? `$${n.toLocaleString('en-US')}` : '');
const miles = (n?: number) => (n ? `${n.toLocaleString('en-US')} miles` : '');
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** The year to list: exact if known, otherwise the range, which the Sell tab asks you to settle. */
export function listingYear(car: IdentifiedCar): string {
  const i = car.identity;
  if (i.year) return String(i.year);
  return i.yearFrom === i.yearTo ? String(i.yearFrom) : `${i.yearFrom}–${i.yearTo}`;
}

export function listingTitle(car: IdentifiedCar, sheet: SpecSheet | null, sell: SellInfo): string {
  const i = car.identity;
  const base = [listingYear(car), i.make, i.model, i.trim].filter(Boolean).join(' ');
  const engine = specValue(sheet, 'Engine');
  return [base, engine, sell.mileage ? `${sell.mileage.toLocaleString('en-US')} mi` : ''].filter(Boolean).join(' · ');
}

/**
 * The listing text, written from the spec sheet and what you entered. Plain rules, no AI: every
 * claim comes from the EPA/NHTSA data or from you, so nothing is made up.
 */
export function writeListing(car: IdentifiedCar, sheet: SpecSheet | null, sell: SellInfo): string {
  const i = car.identity;
  const name = [listingYear(car), i.make, i.model, i.trim].filter(Boolean).join(' ');
  const engine = specValue(sheet, 'Engine');
  const trans = gearbox(specValue(sheet, 'Transmission'));
  const drive = specValue(sheet, 'Drive');
  const combined = specValue(sheet, 'Combined');
  const city = specValue(sheet, 'City');
  const highway = specValue(sheet, 'Highway');
  const range = specValue(sheet, 'Range');
  const overall = specValue(sheet, 'Overall');
  const extras = (sell.extras ?? '')
    .split('\n')
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
  const marks = sell.includeCondition ? (car.condition?.pins ?? []).filter((p) => !p.fixed) : [];
  const colour = car.color?.name;
  const has3d = car.capture?.status === 'done';
  const condition = sell.condition ? CONDITION[sell.condition] : undefined;

  if (sell.style === 'short') {
    const lines = [`${name} for sale${sell.price ? `, ${money(sell.price)}` : ''}.`];
    const first = [miles(sell.mileage), condition?.label, colour].filter(Boolean).join(' · ');
    if (first) lines.push(`• ${first}`);
    const power = [engine, trans, drive && drive.toLowerCase()].filter(Boolean).join(', ');
    if (power) lines.push(`• ${power}`);
    if (range) lines.push(`• ${range} range (EPA)`);
    else if (combined) lines.push(`• ${combined} combined (EPA)`);
    if (overall) lines.push(`• ${overall} overall NHTSA crash rating`);
    if (extras.length) lines.push(`• Extras: ${extras.join(', ')}`);
    if (marks.length) lines.push(`• Known marks: ${marks.map((m) => (m.note ? lower(m.note.replace(/\.$/, '')) : m.kind)).join('; ')}`);
    if (sell.notes?.trim()) lines.push('', sell.notes.trim());
    const end = [sell.location ? `Located in ${sell.location}.` : '', has3d ? 'Full 3D walk-around available.' : ''].filter(Boolean);
    if (end.length) lines.push('', end.join(' '));
    return lines.join('\n');
  }

  const paras: string[] = [];
  paras.push(
    `For sale: ${colour ? `my ${lower(colour)} ` : 'my '}${name}${sell.mileage ? `, with ${miles(sell.mileage)}` : ''}.` +
      (condition ? ` ${condition.line}` : ''),
  );
  const power = [
    engine && `It has the ${engine} engine`,
    trans && `${engine ? 'with' : 'It has'} ${/^[aeiou8]/i.test(trans) ? 'an' : 'a'} ${trans}`,
    drive && `and ${drive.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(' ');
  const economy = range
    ? `The EPA rates its range at ${range}.`
    : combined
      ? `The EPA rates it at ${city && highway ? `${city.replace(' mpg', '')}/${highway} city/highway (${combined} combined)` : `${combined} combined`}.`
      : '';
  if (power || economy) paras.push([power && `${power}.`, economy].filter(Boolean).join(' '));
  if (overall) paras.push(`NHTSA gives the ${i.model} ${overall.replace(' of 5 stars', ' out of 5 stars')} overall in its crash tests.`);
  if (extras.length) paras.push(`Extras: ${list(extras.map(lower))}.`);
  if (marks.length) {
    // The note says it best when there is one ("long scratch along the bed rail"); otherwise the kind.
    const said = marks.map((m) => (m.note ? lower(m.note.replace(/\.$/, '')) : `a ${m.kind}`));
    paras.push(`To be upfront, known marks: ${list(said)}.`);
  }
  if (sell.notes?.trim()) paras.push(sell.notes.trim());
  paras.push(
    [
      sell.price ? `Asking ${money(sell.price)}.` : '',
      sell.location ? `The car is in ${sell.location}.` : '',
      has3d ? 'There’s a full 3D walk-around with the listing, so you can look it over before you visit.' : '',
      'Message me with questions or to arrange a viewing.',
    ]
      .filter(Boolean)
      .join(' '),
  );
  return paras.join('\n\n');
}
