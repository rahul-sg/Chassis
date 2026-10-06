import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * What's on the garage's walls: walnut slats (real ones, with shadow gaps), a gloss-black cabinet
 * run with a steel worktop and under-cabinet light, a backlit sign, a wheel display and a wall
 * charger. All geometry and canvas-drawn textures; nothing to download.
 *
 * Walls are given as `x` (the wall's plane) and `side` (−1 for the left wall, facing +x; +1 for
 * the right wall, facing −x), so `x - side * d` is d metres out from the wall into the room.
 */

const H = 3.2;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Fine vertical wood grain, tinted per slat by instance colour. */
function grain() {
  return canvas(64, 512, (g) => {
    const r = rng(21);
    g.fillStyle = '#d9b48f';
    g.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(90,52,28,${0.05 + r() * 0.14})`;
      const x = r() * 64;
      g.fillRect(x, 0, 0.6 + r() * 1.8, 512);
    }
  });
}

/** Brushed steel: fine horizontal streaks. */
function brushed() {
  return canvas(256, 256, (g) => {
    const r = rng(33);
    g.fillStyle = '#a4a9b0';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const v = 140 + r() * 70;
      g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.25)`;
      g.fillRect(0, r() * 256, 256, 0.6);
    }
  });
}

/** The CHASSIS sign: the chassis mark and the wordmark, as backlit letters. */
function signTexture() {
  return canvas(1024, 192, (g) => {
    g.clearRect(0, 0, 1024, 192);
    g.fillStyle = '#ffffff';
    // Mark: two rails, three crossmembers, four wheels.
    const ox = 40;
    const oy = 26;
    const s = 140 / 64;
    const R = (x: number, y: number, w: number, h: number) => g.fillRect(ox + x * s, oy + y * s, w * s, h * s);
    R(11, 10, 8, 15);
    R(45, 10, 8, 15);
    R(11, 39, 8, 15);
    R(45, 39, 8, 15);
    R(23, 6, 4.5, 52);
    R(37, 6, 4.5, 52);
    R(19, 15.5, 26, 4.5);
    R(23, 30, 18, 4.5);
    R(19, 44.5, 26, 4.5);
    g.font = `800 112px 'Archivo Variable', 'Helvetica Neue', Arial, sans-serif`;
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '22px';
    g.textBaseline = 'middle';
    g.fillText('CHASSIS', 230, 100);
  });
}

function useMaterials() {
  const m = useMemo(() => {
    const steelMap = brushed();
    const woodMap = grain();
    return {
      woodMap,
      steelMap,
      slat: new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.55 }),
      backer: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.9 }),
      gloss: new THREE.MeshStandardMaterial({ color: '#0f1013', roughness: 0.18, metalness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ map: steelMap, roughness: 0.32, metalness: 0.9 }),
      rubber: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.85 }),
      rim: new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.25, metalness: 0.95 }),
      darkRim: new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.3, metalness: 0.8 }),
      warmLed: new THREE.MeshBasicMaterial({ color: '#ffd7a8', toneMapped: false }),
      charger: new THREE.MeshStandardMaterial({ color: '#e9eaec', roughness: 0.3, metalness: 0.1 }),
      glass: new THREE.MeshStandardMaterial({ color: '#0a0b0d', roughness: 0.08, metalness: 0.4 }),
      statusLed: new THREE.MeshBasicMaterial({ color: '#4ade80', toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(m).forEach((x) => x.dispose());
    },
    [m],
  );
  return m;
}

/** Vertical walnut slats from z0 to z1 on a black backer, standing above the cove light. */
function SlatWall({ x, side, z0, z1, mats }: { x: number; side: number; z0: number; z1: number; mats: ReturnType<typeof useMaterials> }) {
  const pitch = 0.105;
  const count = Math.max(1, Math.floor((z1 - z0) / pitch));
  const mesh = useMemo(() => {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, H - 0.2, 0.068), mats.slat, count);
    const o = new THREE.Object3D();
    const r = rng(5);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      o.position.set(x - side * 0.04, 0.13 + (H - 0.2) / 2, z0 + pitch / 2 + i * pitch);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
      const v = 0.5 + r() * 0.12; // walnut tones vary a little slat to slat
      inst.setColorAt(i, c.setRGB(v, v * 0.78, v * 0.62));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }, [x, side, z0, count, mats.slat]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return (
    <group>
      <mesh position={[x - side * 0.005, H / 2, (z0 + z1) / 2]} rotation={[0, -side * (Math.PI / 2), 0]} material={mats.backer}>
        <planeGeometry args={[z1 - z0, H]} />
      </mesh>
      <primitive object={mesh} />
    </group>
  );
}

/** A run of gloss-black cabinets with a steel worktop, uppers, under-cabinet light and a sign above. */
function Workshop({ x, side, z0, run, mats }: { x: number; side: number; z0: number; run: number; mats: ReturnType<typeof useMaterials> }) {
  const modules = Math.max(2, Math.round(run / 0.62));
  const mod = run / modules;
  const sign = useMemo(() => signTexture(), []);
  useEffect(() => () => sign.dispose(), [sign]);
  const out = (d: number) => x - side * d; // d metres from the wall
  return (
    <group>
      {Array.from({ length: modules }, (_, i) => {
        const z = z0 + mod * (i + 0.5);
        return (
          <group key={i}>
            {/* Lower cabinet with a recessed toe kick and a bar handle. */}
            <mesh position={[out(0.3), 0.5, z]} material={mats.gloss}>
              <boxGeometry args={[0.56, 0.8, mod - 0.012]} />
            </mesh>
            <mesh position={[out(0.27), 0.05, z]} material={mats.backer}>
              <boxGeometry args={[0.5, 0.1, mod - 0.012]} />
            </mesh>
            <mesh position={[out(0.59), 0.82, z]} material={mats.steel}>
              <boxGeometry args={[0.02, 0.018, mod * 0.6]} />
            </mesh>
            {/* Upper cabinet. */}
            <mesh position={[out(0.19), 1.92, z]} material={mats.gloss}>
              <boxGeometry args={[0.36, 0.62, mod - 0.012]} />
            </mesh>
            <mesh position={[out(0.38), 1.64, z]} material={mats.steel}>
              <boxGeometry args={[0.02, 0.016, mod * 0.5]} />
            </mesh>
          </group>
        );
      })}
      {/* Worktop. */}
      <mesh position={[out(0.31), 0.92, z0 + run / 2]} material={mats.steel}>
        <boxGeometry args={[0.62, 0.04, run + 0.04]} />
      </mesh>
      {/* Under-cabinet light, lighting the worktop. */}
      <mesh position={[out(0.33), 1.6, z0 + run / 2]} material={mats.warmLed}>
        <boxGeometry args={[0.02, 0.012, run - 0.1]} />
      </mesh>
      <rectAreaLight
        args={['#ffd7a8', 14, 0.2, run - 0.1]}
        position={[out(0.33), 1.59, z0 + run / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      {/* Backlit sign above the uppers. */}
      <mesh position={[out(0.075), 2.62, z0 + run / 2]} rotation={[0, -side * (Math.PI / 2), 0]}>
        <planeGeometry args={[Math.min(run, 2.4), (Math.min(run, 2.4) * 192) / 1024]} />
        <meshBasicMaterial map={sign} transparent color="#fff3e2" toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** One wheel and tyre, mounted on the wall with its face to the room. */
function Wheel({ position, side, dark, mats }: { position: [number, number, number]; side: number; dark: boolean; mats: ReturnType<typeof useMaterials> }) {
  const rimMat = dark ? mats.darkRim : mats.rim;
  return (
    <group position={position} rotation={[0, side * (Math.PI / 2), 0]}>
      {/* The group's z axis points out of the wall: the wheel's axle. */}
      <mesh material={mats.rubber}>
        <torusGeometry args={[0.27, 0.095, 18, 48]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={rimMat}>
        <cylinderGeometry args={[0.205, 0.205, 0.05, 40, 1, true]} />
      </mesh>
      {Array.from({ length: 5 }, (_, k) => (
        <mesh key={k} rotation={[0, 0, (k * 2 * Math.PI) / 5]} position={[0, 0, 0.02]} material={rimMat}>
          <boxGeometry args={[0.04, 0.4, 0.025]} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.035]} material={mats.steel}>
        <cylinderGeometry args={[0.045, 0.045, 0.02, 24]} />
      </mesh>
      <mesh position={[0, 0, -0.14]} material={mats.steel}>
        <boxGeometry args={[0.05, 0.05, 0.16]} />
      </mesh>
    </group>
  );
}

/** A wall charger with its status light and the cable coiled on a hook below. */
function Charger({ x, side, z, mats }: { x: number; side: number; z: number; mats: ReturnType<typeof useMaterials> }) {
  return (
    <group position={[x - side * 0.06, 1.3, z]} rotation={[0, -side * (Math.PI / 2), 0]}>
      <mesh material={mats.charger}>
        <boxGeometry args={[0.24, 0.36, 0.1]} />
      </mesh>
      <mesh position={[0, 0.02, 0.051]} material={mats.glass}>
        <planeGeometry args={[0.18, 0.24]} />
      </mesh>
      <mesh position={[0, 0.06, 0.053]} material={mats.statusLed}>
        <ringGeometry args={[0.022, 0.03, 32]} />
      </mesh>
      <mesh position={[0, -0.42, 0.05]} material={mats.rubber}>
        <torusGeometry args={[0.13, 0.014, 10, 40]} />
      </mesh>
      <mesh position={[0, -0.29, 0.03]} material={mats.steel}>
        <boxGeometry args={[0.04, 0.03, 0.06]} />
      </mesh>
    </group>
  );
}

export function GarageWalls({ width, back, front }: { width: number; back: number; front: number }) {
  const mats = useMaterials();
  const left = -width / 2;
  const right = width / 2;
  const run = Math.min(3.6, (front - back) * 0.4);
  return (
    <group>
      <SlatWall x={left} side={-1} z0={back} z1={front} mats={mats} />
      <SlatWall x={right} side={1} z0={back} z1={front} mats={mats} />
      <Workshop x={left} side={-1} z0={back + 0.25} run={run} mats={mats} />
      {[0, 1, 2].map((i) => (
        <Wheel key={i} position={[right - 0.2, 1.75, back + 1.0 + i * 0.85]} side={1} dark={i === 1} mats={mats} />
      ))}
      <Charger x={right} side={1} z={back + 3.75} mats={mats} />
      {/* Brushed steel baseboard along the back wall. */}
      <mesh position={[0, 0.06, back + 0.012]} material={mats.steel}>
        <boxGeometry args={[width, 0.12, 0.02]} />
      </mesh>
    </group>
  );
}
