import type { Identity } from './types';

/** Kelley Blue Book doesn't price cars older than this. */
const FIRST_YEAR = 1992;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Kelley Blue Book's page for a car: kbb.com/<make>/<model>/<year>/, where you enter mileage,
 * condition and ZIP code for its values. Only a link: their terms allow direct links, and nothing
 * is fetched from or copied off their site. Null for cars too old for them to price.
 */
export function kbbUrl(i: Identity): string | null {
  const year = i.year ?? (i.yearFrom === i.yearTo ? i.yearFrom : undefined);
  if ((year ?? i.yearTo) < FIRST_YEAR || !i.make || !i.model) return null;
  return `https://www.kbb.com/${slug(i.make)}/${slug(i.model)}/${year ? `${year}/` : ''}`;
}
