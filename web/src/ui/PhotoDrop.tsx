import { useRef, useState, type ReactNode } from 'react';
import { UploadIcon } from './icons';

/** Drop a photo, choose one, or (on a phone) take one. */
export function PhotoDrop({
  onFile,
  title = 'Drop a photo of a car',
  hint = 'or choose one. A side or three-quarter view where the car fills most of the frame works best.',
  accept = 'image/*',
  compact = false,
  children,
}: {
  onFile: (f: File) => void;
  title?: string;
  hint?: string;
  accept?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${over ? 'drop--over' : ''} ${compact ? 'drop--compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <span className="drop__icon">
        <UploadIcon />
      </span>
      <p className="drop__title">{title}</p>
      {!compact && <p className="drop__hint">{hint}</p>}
      <div className="actions">
        <button className="btn btn--accent" onClick={() => input.current?.click()}>
          Choose a photo
        </button>
        {children}
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
