import { kbbUrl } from '../lib/kbb';
import type { Identity } from '../lib/types';

/** "What's it worth?" pointing to Kelley Blue Book. Hidden for cars KBB doesn't price. */
export function KbbLink({ identity, children }: { identity: Identity; children?: React.ReactNode }) {
  const url = kbbUrl(identity);
  if (!url) return null;
  return (
    <p className="kbb">
      {children ?? 'What’s it worth? Kelley Blue Book prices it by mileage, condition and ZIP code.'}{' '}
      <a href={url} target="_blank" rel="noopener noreferrer">
        Check on Kelley Blue Book <span aria-hidden>↗</span>
      </a>
      <span className="muted"> (opens kbb.com)</span>
    </p>
  );
}
