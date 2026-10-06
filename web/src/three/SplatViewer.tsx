import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';

export interface Marker {
  id: string;
  at: [number, number, number];
  label: string;
  body?: ReactNode;
  tone?: 'accent' | 'note' | 'done';
}

/** Spark draws Gaussian splats inside the normal three.js scene. */
function Spark() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);
    return () => {
      scene.remove(spark);
    };
  }, [gl, scene]);
  return null;
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

function Studio({ size }: { size: [number, number, number] }) {
  const shadow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const ring = useMemo(() => {
    const p: number[] = [];
    const r = Math.max(size[0], size[2]) * 0.78;
    for (let i = 0; i < 260; i++) {
      const a = (i / 260) * Math.PI * 2;
      p.push(Math.cos(a) * r, 0.001, Math.sin(a) * r);
    }
    return new THREE.Float32BufferAttribute(p, 3);
  }, [size]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[Math.max(size[0], size[2]) * 2.4, 64]} />
        <meshBasicMaterial color="#0d0d10" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} scale={[size[0] * 1.35, size[2] * 2.2, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      <points>
        <bufferGeometry attributes={{ position: ring }} />
        <pointsMaterial size={0.03} color="#4a4a55" />
      </points>
    </>
  );
}

function Rig({ size, resetKey, autoRotate }: { size: [number, number, number]; resetKey: number; autoRotate: boolean }) {
  const controls = useRef<OrbitImpl>(null);
  const camera = useThree((s) => s.camera);
  const L = size[0];
  useEffect(() => {
    camera.position.set(L * 0.78, size[1] * 0.95, L * 0.86);
    controls.current?.target.set(0, size[1] * 0.45, 0);
    controls.current?.update();
  }, [camera, L, size, resetKey]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      autoRotate={autoRotate}
      autoRotateSpeed={0.7}
      minDistance={L * 0.45}
      maxDistance={L * 3.2}
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
        <Studio size={size} />
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
      <div className="viewer__tools">
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
