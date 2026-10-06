import { useRef, useState } from 'react';
import { cleanVin, lookupVin, readVinPhoto, type VinResult } from '../lib/vehicle';

/** Type a VIN or photograph it; it's checked against NHTSA's decoder either way. */
export function VinEntry({ onFound }: { onFound: (v: VinResult) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'type' | 'photo' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const done = (r: VinResult) => {
    if (r.decoded && r.family) {
      setNote(null);
      setText(r.vin);
      onFound(r);
    } else if (r.decoded) setNote(`NHTSA knows this VIN (${r.year} ${r.make} ${r.model ?? ''}) but it isn’t in the EPA data, so there’s no spec sheet.`);
    else setNote('NHTSA couldn’t decode that VIN. Check the characters and try again.');
  };

  return (
    <div className="vin">
      <div className="vin__row">
        <input
          className="input vin__input"
          value={text}
          onChange={(e) => setText(cleanVin(e.target.value))}
          placeholder="17-character VIN"
          aria-label="VIN"
          spellCheck={false}
          autoCapitalize="characters"
        />
        <span className="vin__count">{text.length}/17</span>
        <button
          className="btn"
          disabled={text.length !== 17 || busy !== null}
          onClick={async () => {
            setBusy('type');
            try {
              done(await lookupVin(text));
            } catch (e) {
              setNote((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === 'type' ? 'Checking…' : 'Look up'}
        </button>
        <button className="btn btn--ghost" disabled={busy !== null} onClick={() => input.current?.click()}>
          {busy === 'photo' ? 'Reading…' : 'Scan a photo of it'}
        </button>
      </div>
      <p className="vin__hint">
        It’s on a plate at the bottom of the windshield (driver’s side), on the driver’s door-jamb sticker, and on your registration.
      </p>
      {note && <p className="note">{note}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy('photo');
          setNote(null);
          try {
            const r = await readVinPhoto(f);
            if (r.found) done(r);
            else setNote('No VIN found in that photo. Get closer so the 17 characters fill the frame, or type it in.');
          } catch (err) {
            setNote((err as Error).message);
          } finally {
            setBusy(null);
          }
        }}
      />
    </div>
  );
}
