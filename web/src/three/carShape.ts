/**
 * A generic car as a point cloud: the shape a 3D scan of a sports sedan might give.
 * Units are metres; x runs nose (+) to tail (−), y is up, z is across.
 * Each point has a kind so the renderer can tint glass, tyres, rims and lights.
 */
export const KIND = { body: 0, glass: 1, tire: 2, rim: 3, headlight: 4, taillight: 5 } as const;

export const CAR = { length: 4.55, width: 1.86, height: 1.4 };
const HALF = CAR.length / 2;
const AXLES = [1.33, -1.39];
const WHEEL_R = 0.335;
const TIRE_W = 0.23;
const CABIN: [number, number] = [-1.28, 0.82]; // greenhouse, tail → windshield base
const ROOF: [number, number] = [-0.6, 0.1];
const ROOF_HW = 0.62;

// Side profile: top of the car and the underside, tail to nose.
const TOP: [number, number][] = [
  [-2.275, 0.62], [-2.2, 0.84], [-1.85, 0.93], [-1.28, 1.0], [-0.6, 1.36], [0.1, 1.4],
  [0.82, 1.03], [1.5, 0.92], [2.08, 0.83], [2.275, 0.6],
];
const BOTTOM: [number, number][] = [[-2.275, 0.34], [-2.0, 0.22], [-1.6, 0.18], [1.6, 0.18], [2.0, 0.21], [2.275, 0.3]];

/** Monotone cubic interpolation (no overshoot between profile points). */
function profile(pts: [number, number][]) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const top = profile(TOP);
const bottom = profile(BOTTOM);
/** Half-width in plan view: full through the middle, rounded at nose and tail. */
const halfWidth = (x: number) => (CAR.width / 2) * Math.pow(1 - Math.pow(Math.min(1, Math.abs(x) / 2.3), 10), 0.22);
const inCabin = (x: number) => x > CABIN[0] && x < CABIN[1];
const belt = (x: number) => (inCabin(x) ? 0.99 + ((x - CABIN[0]) / (CABIN[1] - CABIN[0])) * 0.04 : top(x));
const inArch = (x: number, y: number) => AXLES.some((a) => Math.hypot(x - a, y - WHEEL_R) < 0.4);

export function carPoints(density = 1): { positions: Float32Array; kinds: Float32Array } {
  const P: number[] = [];
  const K: number[] = [];
  const add = (x: number, y: number, z: number, k: number) => {
    P.push(x, y, z);
    K.push(k);
  };
  const jitter = () => (Math.random() - 0.5) * 0.008;
  const stations = Math.round(230 * density);

  for (let i = 0; i <= stations; i++) {
    const x = -HALF + (i / stations) * CAR.length + jitter();
    const hw = halfWidth(x);
    const b = bottom(x);
    const t = top(x);
    const bl = belt(x);

    // Body sides, from the sill up to the beltline, bulging slightly through the middle.
    const sideRows = Math.round(26 * density);
    for (let j = 0; j <= sideRows; j++) {
      const v = j / sideRows;
      const y = b + v * (bl - b);
      if (inArch(x, y)) continue;
      const z = hw * (0.92 + 0.08 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
      for (const s of [-1, 1]) add(x, y + jitter(), s * z, KIND.body);
    }

    // Hood, roof and trunk lid, with a slight crown.
    const cabin = inCabin(x);
    const across = cabin ? ROOF_HW : hw * 0.95;
    const topCols = Math.round(34 * density);
    for (let j = 0; j <= topCols; j++) {
      const u = (j / topCols) * 2 - 1;
      const z = u * across;
      const y = t - 0.04 * u * u;
      const windshield = x > ROOF[1] + 0.06 && x < CABIN[1] - 0.04;
      const rearGlass = x > CABIN[0] + 0.06 && x < ROOF[0] - 0.06;
      const glass = cabin && (windshield || rearGlass) && Math.abs(u) < 0.86;
      add(x, y + jitter(), z, glass ? KIND.glass : KIND.body);
    }

    // Greenhouse sides: side windows with A, B and C pillars.
    if (cabin && t - bl > 0.05) {
      const rows = Math.round(12 * density);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const y = bl + v * (t - bl);
        const z = hw * 0.94 + (ROOF_HW - hw * 0.94) * Math.pow(v, 0.9);
        const pillar = x > CABIN[1] - 0.2 || Math.abs(x + 0.25) < 0.06 || x < CABIN[0] + 0.32 || v > 0.9;
        for (const s of [-1, 1]) add(x, y + jitter(), s * z, pillar ? KIND.body : KIND.glass);
      }
    }
  }

  // Nose and tail faces, with head- and taillights.
  for (const end of [1, -1]) {
    const x = end * HALF;
    const hw = halfWidth(x * 0.985);
    const b = bottom(x);
    const t = top(x * 0.985);
    const n = Math.round(1400 * density);
    for (let i = 0; i < n; i++) {
      const y = b + Math.random() * (t - b);
      const z = (Math.random() * 2 - 1) * hw;
      const lightBand = end > 0 ? y > 0.66 && y < 0.78 : y > 0.74 && y < 0.88;
      const lightSide = Math.abs(z) > hw * 0.42 && Math.abs(z) < hw * 0.93;
      const kind = lightBand && lightSide ? (end > 0 ? KIND.headlight : KIND.taillight) : KIND.body;
      add(x - end * Math.random() * 0.02, y, z, kind);
    }
  }

  // Wheels: tread, sidewall and a five-spoke rim on the outer face.
  for (const ax of AXLES) {
    for (const s of [-1, 1]) {
      const zc = s * (halfWidth(ax) - 0.13);
      const steps = Math.round(110 * density);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        for (let w = 0; w <= 6; w++) {
          const z = zc + (w / 6 - 0.5) * TIRE_W;
          add(ax + Math.cos(a) * WHEEL_R, WHEEL_R + Math.sin(a) * WHEEL_R, z, KIND.tire);
        }
      }
      const face = zc + s * TIRE_W * 0.5;
      const n = Math.round(1700 * density);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(Math.random()) * WHEEL_R;
        const a = Math.random() * Math.PI * 2;
        const spoke = Math.abs(((a / (Math.PI * 2 / 5)) % 1) - 0.5) > 0.38;
        const kind = r > 0.245 ? KIND.tire : r < 0.06 || r > 0.215 || spoke ? KIND.rim : -1;
        if (kind < 0) continue;
        add(ax + Math.cos(a) * r, WHEEL_R + Math.sin(a) * r, face - s * (r < 0.245 ? 0.03 : 0), kind);
      }
    }
  }

  return { positions: new Float32Array(P), kinds: new Float32Array(K) };
}
