import { useEffect, useState } from 'react';

/** Pages of a car. */
export const CAR_TABS = ['360', 'specs', 'mods', 'condition', 'sell', 'capture'] as const;
export type CarTab = (typeof CAR_TABS)[number];

export type Route =
  | { page: 'home' }
  | { page: 'identify'; quick?: boolean }
  | { page: 'spotted' }
  | { page: 'garage' }
  | { page: 'about' }
  | { page: 'car'; id: string; tab: CarTab };

const SIMPLE = ['spotted', 'garage', 'about'] as const;

/** '#/car/ab12/specs' → { page: 'car', id: 'ab12', tab: 'specs' }. Unknown paths go home. */
export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, id, tab] = parts;
  if (head === 'car' && id) return { page: 'car', id, tab: (CAR_TABS as readonly string[]).includes(tab) ? (tab as CarTab) : '360' };
  if (head === 'identify') return id === 'quick' ? { page: 'identify', quick: true } : { page: 'identify' };
  // The pages Identify replaced, so old links and bookmarks still land somewhere sensible.
  if (head === 'snap') return { page: 'identify' };
  if (head === 'spotter') return { page: 'identify', quick: true };
  if ((SIMPLE as readonly string[]).includes(head)) return { page: head as (typeof SIMPLE)[number] };
  return { page: 'home' };
}

export function href(r: Route): string {
  if (r.page === 'home') return '#/';
  if (r.page === 'car') return `#/car/${r.id}${r.tab === '360' ? '' : `/${r.tab}`}`;
  if (r.page === 'identify') return r.quick ? '#/identify/quick' : '#/identify';
  return `#/${r.page}`;
}

export function go(r: Route) {
  const h = href(r);
  if (location.hash !== h) location.hash = h;
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
