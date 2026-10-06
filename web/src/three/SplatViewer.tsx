import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { SplatMesh } from '@sparkjsdev/spark';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { DetailBay, bayHalf } from './DetailBay';
import { ROOM_HEIGHT } from './GarageRoom';
import { Spark } from './spark';

export interface Marker {
  id: string;
  at: [number, number, number];
  label: string;
  body?: ReactNode;
  tone?: 'accent' | 'note' | 'done';
}

/** The splat, placed by its 4×4 transform (row-major), turned round when front is −1. */
function Splat({
  url,
  matrix,
  front,
  onProgress,
  onReady,
  onPick,
}: {
  url: string;
  matrix: number[];
  front: 1 | -1;
  onProgress: (f: number) => void;
  onReady: () => void;
  onPick?: (p: THREE.Vector3) => void;
}) {
  const mesh = useMemo(
    () =>
      new SplatMesh({
        url,
        raycastable: !!onPick,
        onProgress: (e) => e.lengthComputable && onProgress(e.loaded / e.total),
        onLoad: () => onReady(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url],
  );
  useEffect(() => () => mesh.dispose(), [mesh]);
  useEffect(() => {
    const m = new THREE.Matrix4().set(...(matrix as Parameters<THREE.Matrix4['set']>));
    if (front === -1) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.updateMatrixWorld(true);
  }, [mesh, matrix, front]);
  return (
    <primitive
      object={mesh}
      onClick={
        onPick
          ? (e: { stopPropagation: () => void; point: THREE.Vector3 }) => {
              e.stopPropagation();
              onPick(e.point.clone());
            }
          : undefined
      }
    />
  );
}

/** Orbiting the car, kept inside the bay's walls and under its ceiling. */
function Rig({ size, resetKey, autoRotate }: { size: [number, number, number]; resetKey: number; autoRotate: boolean }) {
  const controls = useRef<OrbitImpl>(null);
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const L = size[0];
  const far = bayHalf(L) - 0.8;
  useEffect(() => {
    // A tall, narrow screen (a phone) gets a wider lens and stands back far enough to fit the car.
    const wide = THREE.MathUtils.degToRad(40) / 2;
    camera.fov = aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(wide) / aspect)) : 32;
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(0, size[1] * 0.45, 0);
    const start = new THREE.Vector3(L * 0.78, size[1] * 0.95, L * 0.86).sub(target);
    if (aspect < 1) start.setLength(Math.min(far, Math.hypot(L, size[2]) / 2 / Math.sin(wide)));
    camera.position.copy(target).add(start);
    controls.current?.target.copy(target);
    controls.current?.update();
  }, [camera, aspect, L, far, size, resetKey]);
  // The further out the camera, the less it may look down, so it never rises through the ceiling.
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const d = Math.max(0.01, camera.position.distanceTo(c.target));
    c.minPolarAngle = Math.acos(Math.min(1, (ROOM_HEIGHT - 0.35 - c.target.y) / d));
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      autoRotate={autoRotate}
      autoRotateSpeed={0.7}
      minDistance={L * 0.45}
      maxDistance={far}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  );
}

function Hotspot({ m, open, onOpen }: { m: Marker; open: boolean; onOpen: () => void }) {
  return (
    <Html position={m.at} center zIndexRange={[20, 0]}>
      <div className={`hotspot ${open ? 'is-open' : ''} ${m.tone && m.tone !== 'accent' ? `hotspot--${m.tone}` : ''}`}>
        <button className="hotspot__dot" onClick={onOpen} aria-label={m.label} aria-expanded={open} />
        {open && (
          <div className="hotspot__card" role="dialog" aria-label={m.label}>
            <p className="hotspot__title">{m.label}</p>
            {m.body}
          </div>
        )}
      </div>
    </Html>
  );
}

export function SplatViewer({
  url,
  matrix,
  size,
  front,
  markers = [],
  onPick,
  overlay,
}: {
  url: string;
  matrix: number[];
  size: [number, number, number];
  front: 1 | -1;
  markers?: Marker[];
  /** When set, tapping the car reports the 3D point (used to pin damage). */
  onPick?: (p: [number, number, number]) => void;
  overlay?: ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className="viewer" onPointerDown={() => setAuto(false)}>
      <Canvas camera={{ fov: 32, near: 0.05, far: 200 }} gl={{ antialias: false }} dpr={[1, 2]} onPointerMissed={() => setOpen(null)}>
        <color attach="background" args={['#0a0a0c']} />
        <Spark />
        <DetailBay size={size} />
        <Splat
          url={url}
          matrix={matrix}
          front={front}
          onProgress={setProgress}
          onReady={() => setReady(true)}
          onPick={onPick ? (p) => onPick([p.x, p.y, p.z]) : undefined}
        />
        {ready && markers.map((m) => <Hotspot key={m.id} m={m} open={open === m.id} onOpen={() => setOpen(open === m.id ? null : m.id)} />)}
        <Rig size={size} resetKey={resetKey} autoRotate={auto && !open} />
      </Canvas>
      {!ready && (
        <div className="viewer__loading">
          <span>Loading the 3D model… {Math.round(progress * 100)}%</span>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {/* Pressing a tool mustn't count as grabbing the view (which stops the turning first). */}
      <div className="viewer__tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn btn--sm" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
          {auto ? 'Stop turning' : 'Turn'}
        </button>
        <button className="btn btn--sm" onClick={() => setResetKey((k) => k + 1)}>
          Reset view
        </button>
        {overlay}
      </div>
    </div>
  );
}
