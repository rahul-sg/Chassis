import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { carName } from '../lib/store';
import type { Identity } from '../lib/types';
import { CAR, carPoints } from './carShape';

/** One car as the garage needs it (GET /api/garage/scene). Sizes are metres, [length, width, height]. */
export interface SceneCar {
  id: string;
  nickname?: string;
  identity: Identity | null;
  color?: string;
  vclass?: string | null;
  size: [number, number, number];
  sizeSource: 'scan' | 'you' | 'class';
  splat?: string | null;
  transform?: number[] | null;
  front: 1 | -1;
}

export const label = (c: SceneCar) => c.nickname || carName(c.identity ?? undefined);

const BAY_GAP = 0.9; // space beside each car, so the doors would open
const BAY_MIN = 2.8; // a real parking bay is about 2.5–2.7 m wide

/** Parking bays side by side, cars backed in so their noses face you. */
function layout(cars: SceneCar[]) {
  const widths = cars.map((c) => Math.max(BAY_MIN, c.size[1] + BAY_GAP));
  const total = widths.reduce((a, b) => a + b, 0);
  const depth = Math.max(5.5, ...cars.map((c) => c.size[0] + 1.2));
  let x = -total / 2;
  const bays = cars.map((c, i) => {
    const cx = x + widths[i] / 2;
    x += widths[i];
    // Rear 0.4 m off the back line.
    return { car: c, x: cx, width: widths[i], z: -depth / 2 + 0.4 + c.size[0] / 2 };
  });
  return { bays, total, depth };
}

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

/** Radial falloff texture: shadows under the cars and pools of light on the floor. */
function useRadial() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

/** A scanned car: its splat, placed by its transform. Its length runs along x, so the bay turns it nose-out. */
function ScannedCar({ url, matrix, front }: { url: string; matrix: number[]; front: 1 | -1 }) {
  const mesh = useMemo(() => new SplatMesh({ url }), [url]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  useEffect(() => {
    const m = new THREE.Matrix4().set(...(matrix as Parameters<THREE.Matrix4['set']>));
    if (front === -1) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.updateMatrixWorld(true);
  }, [mesh, matrix, front]);
  return <primitive object={mesh} />;
}

const standVertex = /* glsl */ `
  attribute float kind;
  uniform vec3 uPaint;
  uniform float uSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Lifted a little towards white so dark paints still read on the dark floor.
    vec3 c = mix(uPaint, vec3(1.0), 0.18) + 0.06; float a = 0.9;
    if (kind == 1.0) { c = vec3(0.3, 0.36, 0.44); a = 0.55; }
    else if (kind == 2.0) { c = vec3(0.16); a = 0.85; }
    else if (kind == 3.0) { c = vec3(0.78, 0.79, 0.82); }
    else if (kind == 4.0) { c = vec3(1.0); a = 1.0; }
    else if (kind == 5.0) { c = vec3(0.95, 0.18, 0.12); a = 1.0; }
    vColor = c; vAlpha = a;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const standFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.25, r));
  }
`;

/** A car without a scan: the generic point-cloud body in its paint colour, stretched to its class's size. */
function StandIn({ size, color }: { size: [number, number, number]; color?: string }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => {
    const { positions, kinds } = carPoints(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('kind', new THREE.BufferAttribute(kinds, 1));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: standVertex,
        fragmentShader: standFragment,
        transparent: true,
        depthWrite: false,
        uniforms: { uPaint: { value: new THREE.Color(color ?? '#9a9aa4') }, uSize: { value: 10 * dpr } },
      }),
    [color, dpr],
  );
  useEffect(() => () => material.dispose(), [material]);
  const [L, W, H] = size;
  return <points geometry={geometry} material={material} scale={[L / CAR.length, H / CAR.height, W / CAR.width]} />;
}

function Bay({
  bay,
  depth,
  radial,
  hot,
  picked,
  onHover,
  onPick,
}: {
  bay: ReturnType<typeof layout>['bays'][number];
  depth: number;
  radial: THREE.Texture;
  hot: boolean;
  picked: boolean;
  onHover: (on: boolean) => void;
  onPick: () => void;
}) {
  const { car } = bay;
  const [L, W, H] = car.size;
  const scanned = !!(car.splat && car.transform);
  return (
    <group position={[bay.x, 0, 0]}>
      {/* Floor of the bay, lit up on hover or when picked to compare. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[bay.width - 0.16, depth]} />
        <meshBasicMaterial color={picked ? '#ff6a1f' : '#ffffff'} transparent opacity={picked ? 0.1 : hot ? 0.04 : 0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* A pool of light from above, and the car's soft shadow in it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, bay.z]} scale={[bay.width * 1.1, L * 1.5, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={radial} color="#ffffff" transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, bay.z]} scale={[W * 1.25, L * 1.15, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={radial} color="#000000" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[0, 0, bay.z]} rotation={[0, -Math.PI / 2, 0]}>
        {scanned ? <ScannedCar url={car.splat!} matrix={car.transform!} front={car.front} /> : <StandIn size={car.size} color={car.color} />}
      </group>
      {/* What the pointer hits: a box the size of the car. */}
      <mesh
        position={[0, H / 2, bay.z]}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
        }}
        onPointerOut={() => onHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        <boxGeometry args={[W, H, L]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 0.01, bay.z + L / 2 + 0.55]} center zIndexRange={[10, 0]}>
        <button className={`baylabel ${hot ? 'is-hot' : ''} ${picked ? 'is-picked' : ''}`} onClick={onPick} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
          <strong>{label(car)}</strong>
          <span>
            {scanned ? '3D scan' : 'Stand-in'} · {L.toFixed(1)} m{car.sizeSource === 'class' ? ' (typical)' : ''}
          </span>
        </button>
      </Html>
    </group>
  );
}

function Lines({ total, depth, bays }: { total: number; depth: number; bays: ReturnType<typeof layout>['bays'] }) {
  const xs = [-total / 2, ...bays.map((b) => b.x + b.width / 2)];
  return (
    <group>
      {xs.map((x, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.08, depth]} />
          <meshBasicMaterial color="#34343c" toneMapped={false} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, -depth / 2]}>
        <planeGeometry args={[total + 0.08, 0.08]} />
        <meshBasicMaterial color="#34343c" toneMapped={false} />
      </mesh>
      {/* Back wall. */}
      <mesh position={[0, 1.6, -depth / 2 - 0.6]}>
        <planeGeometry args={[total + 120, 3.2]} />
        <meshBasicMaterial color="#131317" toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[total + 40, depth + 40]} />
        <meshBasicMaterial color="#0e0e11" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Rig({ total, depth, resetKey }: { total: number; depth: number; resetKey: number }) {
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera);
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null;
  const size = useThree((s) => s.size);
  useEffect(() => {
    // Far enough back to fit the row across the view, a little above eye height.
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = size.width / size.height;
    const fit = (total + 2) / 2 / Math.tan(fov / 2) / aspect;
    const dist = Math.max(9, fit * 1.05, depth * 1.5);
    camera.position.set(total * 0.12, dist * 0.42, depth / 2 + dist * 0.9);
    controls?.target.set(0, 0.7, 0);
    controls?.update();
  }, [camera, controls, total, depth, size.width, size.height, resetKey]);
  return null;
}

export function GarageScene({
  cars,
  picked = [],
  onPick,
}: {
  cars: SceneCar[];
  picked?: string[];
  onPick: (id: string) => void;
}) {
  const { bays, total, depth } = useMemo(() => layout(cars), [cars]);
  const radial = useRadial();
  const [hot, setHot] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    document.body.style.cursor = hot ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hot]);

  return (
    <div className="viewer viewer--garage">
      <Canvas camera={{ fov: 34, near: 0.1, far: 400 }} gl={{ antialias: false }} dpr={[1, 2]}>
        <color attach="background" args={['#0a0a0c']} />
        <fog attach="fog" args={['#0a0a0c', total + depth + 10, total + depth + 40]} />
        <Spark />
        <Lines total={total} depth={depth} bays={bays} />
        {bays.map((b) => (
          <Bay
            key={b.car.id}
            bay={b}
            depth={depth}
            radial={radial}
            hot={hot === b.car.id}
            picked={picked.includes(b.car.id)}
            onHover={(on) => setHot((h) => (on ? b.car.id : h === b.car.id ? null : h))}
            onPick={() => onPick(b.car.id)}
          />
        ))}
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2 - 0.06} minDistance={3} maxDistance={total + depth + 30} />
        <Rig total={total} depth={depth} resetKey={resetKey} />
      </Canvas>
      <div className="viewer__tools">
        <button className="btn btn--sm" onClick={() => setResetKey((k) => k + 1)}>
          Reset view
        </button>
      </div>
    </div>
  );
}
