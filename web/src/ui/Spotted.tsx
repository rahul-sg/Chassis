import { go } from '../lib/route';
import { carName, useGarage } from '../lib/store';
import type { Spotted } from '../lib/types';
import { Dialog } from './Dialog';
import { SpecSheetView } from './SpecSheetView';

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** One car in the Spotted collection: its photo, what it is, its headline figures and when. */
export function SpottedCard({ s, onOpen }: { s: Spotted; onOpen: () => void }) {
  return (
    <button className="spot" onClick={onOpen}>
      <img src={s.photo} alt="" loading="lazy" />
      <span className="spot__body">
        <span className="spot__name">{carName(s.identity)}</span>
        <span className="spot__meta">
          {s.color && <i className="spot__paint" style={{ background: s.color.hex }} title={s.color.name} />}
          {s.headline?.map((h) => h.value).join(' · ') || s.color?.name}
        </span>
        <span className="spot__time">{ago(s.createdAt)}</span>
      </span>
    </button>
  );
}

/** A spotted car opened up: the full spec sheet, and adding it to the garage or dropping it. */
export function SpottedDialog({ s, onClose, onRemoved }: { s: Spotted; onClose: () => void; onRemoved?: () => void }) {
  const addCar = useGarage((st) => st.addCar);
  const removeSpotted = useGarage((st) => st.removeSpotted);
  return (
    <Dialog title={carName(s.identity)} onClose={onClose} wide>
      <div className="spotdetail">
        <img src={s.photo} alt="" />
        <div className="actions">
          <button
            className="btn btn--accent"
            onClick={async () => {
              const car = await addCar({ identity: s.identity, color: s.color, photo: s.photo, photos: [s.photo] });
              go({ page: 'car', id: car.id, tab: 'specs' });
            }}
          >
            Add to my garage
          </button>
          <button
            className="btn btn--ghost"
            onClick={async () => {
              await removeSpotted(s.id);
              onRemoved?.();
              onClose();
            }}
          >
            Remove from Spotted
          </button>
        </div>
        <SpecSheetView
          year={s.identity.year ?? s.identity.yearTo}
          make={s.identity.make}
          model={s.identity.model}
          variant={s.identity.variant}
          vin={s.identity.vin}
        />
      </div>
    </Dialog>
  );
}
