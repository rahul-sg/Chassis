/** The photo with corner brackets around the car that was found. */
export function Detection({
  src,
  box,
  size,
  label,
  scanning = false,
}: {
  src: string;
  box?: [number, number, number, number];
  size?: [number, number];
  label?: string;
  scanning?: boolean;
}) {
  const [w, h] = size ?? [1, 1];
  const c = box ? Math.min(box[2] - box[0], box[3] - box[1]) * 0.12 : 0;
  return (
    <figure className={`detect ${scanning ? 'detect--scanning' : ''}`}>
      <img src={src} alt="The photo you added" />
      {box && size && (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          <rect x={0} y={0} width={w} height={h} className="detect__dim" mask="url(#cut)" />
          <mask id="cut">
            <rect x={0} y={0} width={w} height={h} fill="white" />
            <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} fill="black" />
          </mask>
          {[
            [box[0], box[1], 1, 1],
            [box[2], box[1], -1, 1],
            [box[0], box[3], 1, -1],
            [box[2], box[3], -1, -1],
          ].map(([x, y, sx, sy], i) => (
            <path key={i} d={`M${x} ${y + sy * c} V${y} H${x + sx * c}`} className="detect__corner" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
      {box && size && label && (
        <span className="detect__tag" style={{ left: `${(box[0] / w) * 100}%`, top: `${(box[1] / h) * 100}%` }}>
          {label}
        </span>
      )}
      {scanning && <span className="detect__sweep" aria-hidden />}
    </figure>
  );
}
