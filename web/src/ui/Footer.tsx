import { href } from '../lib/route';
import { Mark } from './icons';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <a className="brand" href={href({ page: 'home' })}>
            <Mark size={22} />
            <span>Chassis</span>
          </a>
          <p>Know any car from a photo. Turn yours into 3D.</p>
        </div>
        <nav className="footer__links" aria-label="Pages">
          <a href={href({ page: 'snap' })}>Snap &amp; Spec</a>
          <a href={href({ page: 'spotter' })}>Spotter</a>
          <a href={href({ page: 'garage' })}>My garage</a>
          <a href={href({ page: 'about' })}>How it works</a>
        </nav>
      </div>
      <p className="footer__legal">
        A personal project that runs on this computer: photos, videos and 3D captures never leave it. Vehicle data from the U.S. EPA
        (fueleconomy.gov) and NHTSA, both public domain. Not affiliated with any carmaker.
      </p>
    </footer>
  );
}
