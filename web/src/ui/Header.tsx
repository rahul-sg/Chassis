import { go, href, type Route } from '../lib/route';
import { useGarage } from '../lib/store';
import { Mark } from './icons';

const NAV: { page: 'identify' | 'spotted' | 'garage'; label: string }[] = [
  { page: 'identify', label: 'Identify' },
  { page: 'spotted', label: 'Spotted' },
  { page: 'garage', label: 'My garage' },
];

export function Header({ route }: { route: Route }) {
  const online = useGarage((s) => s.online);
  const active = route.page === 'car' ? 'garage' : route.page;
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <a className="brand" href={href({ page: 'home' })} aria-label="Chassis home">
            <Mark />
            <span>Chassis</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.page} className="nav__link" href={href({ page: n.page })} aria-current={active === n.page ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="topbar__end">
            <a className="nav__link" href={href({ page: 'about' })} aria-current={active === 'about' ? 'page' : undefined}>
              How it works
            </a>
            <button className="btn btn--accent btn--sm" onClick={() => go({ page: 'identify' })}>
              Identify a car
            </button>
          </div>
        </div>
      </header>
      {online === false && (
        <div className="offline" role="status">
          The local engine isn’t running, so photos can’t be analysed and your garage can’t load. Start everything with{' '}
          <code>npm run dev</code> in the garage-360 folder.
        </div>
      )}
    </>
  );
}
