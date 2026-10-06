import type { Car } from '../lib/types';

/** A car's cover photo, or its paint colour behind a side-view outline when there's no photo. */
export function CarThumb({ car }: { car: Car }) {
  if (car.photo) return <img className="thumb" src={car.photo} alt="" loading="lazy" />;
  return (
    <div className="thumb thumb--empty" style={{ ['--paint' as string]: car.color?.hex ?? '#3a3a42' }}>
      <svg viewBox="0 0 120 48" aria-hidden>
        <path d="M6 34c0-4 2-6 6-7l14-3 12-9c3-2 6-3 10-3h24c4 0 7 1 10 4l9 8 15 3c4 1 6 3 6 7v4H6Z" fill="var(--paint)" opacity=".85" />
        <circle cx="30" cy="38" r="7" fill="#0d0d10" stroke="#55555f" strokeWidth="2" />
        <circle cx="92" cy="38" r="7" fill="#0d0d10" stroke="#55555f" strokeWidth="2" />
      </svg>
    </div>
  );
}
