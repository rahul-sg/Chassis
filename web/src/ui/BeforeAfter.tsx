import { useRef, useState } from 'react';

/** Two images, one over the other; drag the handle to compare. */
export function BeforeAfter({ before, after, busy = false }: { before: string; after: string | null; busy?: boolean }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const move = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className={`ba ${busy ? 'ba--busy' : ''}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
    >
      <img src={before} alt="Before" draggable={false} />
      {after && <img className="ba__after" src={after} alt="After" draggable={false} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />}
      {after && (
        <>
          <span className="ba__line" style={{ left: `${pos}%` }}>
            <span className="ba__handle" />
          </span>
          <span className="ba__tag ba__tag--l">Now</span>
          <span className="ba__tag ba__tag--r">Preview</span>
        </>
      )}
      <input
        className="ba__range"
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare before and after"
      />
    </div>
  );
}
