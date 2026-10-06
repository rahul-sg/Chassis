import { useEffect, useState } from 'react';

/** Pages of a car. */
export const CAR_TABS = ['360', 'specs', 'mods', 'condition', 'sell', 'capture'] as const;
export type CarTab = (typeof CAR_TABS)[number];

export type Route =
  | { page: 'home' }
  | { page: 'snap' }
  | { page: 'spotter' }
  | { page: 'garage' }
  | { page: 'about' }
  | { page: 'car'; id: string; tab: CarTab };

const SIMPLE = ['snap', 'spotter', 'garage', 'about'] as const;

/** '#/car/ab12/specs' → { page: 'car', id: 'ab12', tab: 'specs' }. Unknown paths go home. */
export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, id, tab] = parts;
  if (head === 'car' && id) return { page: 'car', id, tab: (CAR_TABS as readonly string[]).includes(tab) ? (tab as CarTab) : '360' };
  if ((SIMPLE as readonly string[]).includes(head)) return { page: head as (typeof SIMPLE)[number] };
  return { page: 'home' };
}

export function href(r: Route): string {
  if (r.page === 'home') return '#/';
  if (r.page === 'car') return `#/car/${r.id}${r.tab === '360' ? '' : `/${r.tab}`}`;
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
