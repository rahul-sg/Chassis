const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Logo mark: a 360° arrow around a hub. */
/** A ladder-frame chassis seen from above: two rails, three crossmembers, four wheels. */
export const Mark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="mark">
    <rect width="64" height="64" rx="12" fill="#18181d" />
    <g fill="#d9d9e0">
      <rect x="11" y="10" width="8" height="15" rx="2" />
      <rect x="45" y="10" width="8" height="15" rx="2" />
      <rect x="11" y="39" width="8" height="15" rx="2" />
      <rect x="45" y="39" width="8" height="15" rx="2" />
    </g>
    <g stroke="#ff6a1f" strokeWidth="4.5" strokeLinecap="round" fill="none">
      <path d="M25 8v48M39 8v48" />
      <path d="M19 17.5h26M25 32h14M19 46.5h26" />
    </g>
  </svg>
);

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const SpotIcon = () => (
  <svg {...base}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M7 14.5l1.2-3.2a1.5 1.5 0 0 1 1.4-1h4.8a1.5 1.5 0 0 1 1.4 1l1.2 3.2v2H7Z" />
  </svg>
);
export const OrbitIcon = () => (
  <svg {...base}>
    <ellipse cx="12" cy="13" rx="9" ry="4" />
    <path d="M7.5 12.5l1-2.5a1.5 1.5 0 0 1 1.4-1h4.2a1.5 1.5 0 0 1 1.4 1l1 2.5" />
    <path d="M18 7.5l2.5.5-.5 2.5" />
  </svg>
);
export const PaintIcon = () => (
  <svg {...base}>
    <path d="M5 4h11a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M17 6.5h2a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-7v3" />
    <rect x="10.5" y="15" width="3" height="6" rx="1" />
  </svg>
);
export const ReportIcon = () => (
  <svg {...base}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M9.5 9h5M9.5 12.5h5M9.5 16h3" />
  </svg>
);
export const TagIcon = () => (
  <svg {...base}>
    <path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5L20.5 11.5a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0Z" />
    <circle cx="8" cy="8" r="1.5" />
  </svg>
);
export const GarageIcon = () => (
  <svg {...base}>
    <path d="M3 10l9-6 9 6v10H3Z" />
    <path d="M7 20v-6h10v6M7 17h10" />
  </svg>
);
export const ArrowIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const UploadIcon = () => (
  <svg {...base}>
    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
);
