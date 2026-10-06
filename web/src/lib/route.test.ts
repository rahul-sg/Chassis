import { describe, expect, it } from 'vitest';
import { CAR_TABS, href, parse, type Route } from './route';

describe('routes', () => {
  it('round-trips every page and car tab', () => {
    const routes: Route[] = [
      { page: 'home' },
      { page: 'snap' },
      { page: 'spotter' },
      { page: 'garage' },
      { page: 'about' },
      ...CAR_TABS.map((tab) => ({ page: 'car' as const, id: 'ab12cd34ef', tab })),
    ];
    for (const r of routes) expect(parse(href(r))).toEqual(r);
  });

  it('opens a car on its 360 tab by default, and on 360 for unknown tabs', () => {
    expect(parse('#/car/x1')).toEqual({ page: 'car', id: 'x1', tab: '360' });
    expect(parse('#/car/x1/nope')).toEqual({ page: 'car', id: 'x1', tab: '360' });
    expect(href({ page: 'car', id: 'x1', tab: '360' })).toBe('#/car/x1');
  });

  it('sends unknown or empty paths home', () => {
    expect(parse('')).toEqual({ page: 'home' });
    expect(parse('#/')).toEqual({ page: 'home' });
    expect(parse('#/somewhere/else')).toEqual({ page: 'home' });
    expect(parse('#/car')).toEqual({ page: 'home' });
  });
});
