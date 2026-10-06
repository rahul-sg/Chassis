import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { carPoints } from './carShape';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const vertex = /* glsl */ `
  attribute float kind;
  uniform float uScan;
  uniform float uSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 base = vec3(0.86, 0.87, 0.9);
    float a = 0.8;
    if (kind == 1.0) { base = vec3(0.42, 0.52, 0.66); a = 0.5; }
    else if (kind == 2.0) { base = vec3(0.36, 0.36, 0.4); a = 0.7; }
    else if (kind == 3.0) { base = vec3(0.95, 0.95, 0.98); a = 0.95; }
    else if (kind == 4.0) { base = vec3(1.0); a = 1.0; }
    else if (kind == 5.0) { base = vec3(1.0, 0.24, 0.16); a = 1.0; }
    // The scan line sweeps nose to tail: points it has passed are bright, the rest faint.
    float d = position.x - uScan;
    float done = smoothstep(-0.05, 0.25, d);
    float line = exp(-d * d / 0.0025);
    vColor = mix(base * (0.5 + 0.5 * done), vec3(1.0, 0.42, 0.12), line);
    vAlpha = a * (0.55 + 0.45 * max(done, line));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 + 1.6 * line) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, r));
  }
`;

function Car({ still }: { still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const { positions, kinds } = carPoints(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('kind', new THREE.BufferAttribute(kinds, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uScan: { value: 3 }, uSize: { value: 9 } },
    });
    return { geometry: g, material: m };
  }, []);
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material]);

  useFrame(({ clock }, dt) => {
    material.uniforms.uSize.value = 9 * dpr;
    if (still) {
      material.uniforms.uScan.value = -3;
      return;
    }
    // One sweep every 7 s, nose to tail, with a pause while fully scanned.
    const t = (clock.elapsedTime % 7) / 7;
    material.uniforms.uScan.value = 2.6 - Math.min(1, t / 0.62) * 5.4;
    if (group.current) group.current.rotation.y += dt * 0.16;
  });

  return (
    <group ref={group} rotation={[0, -0.6, 0]}>
      <points geometry={geometry} material={material} />
    </group>
  );
}

/** Turntable: concentric dotted rings on the floor. */
function Floor() {
  const geometry = useMemo(() => {
    const p: number[] = [];
    for (const [r, n] of [
      [2.9, 220],
      [3.3, 260],
      [4.2, 330],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        p.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, []);
  // Soft contact shadow under the car.
  const shadow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <>
      <points geometry={geometry}>
        <pointsMaterial size={0.025} color="#5a5a66" transparent opacity={0.8} />
      </points>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[6.4, 6.4]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
    </>
  );
}

/** Frames the car right of centre on wide screens so the headline has room. */
function Framing({ shift }: { shift: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const { width: w, height: h } = size;
    if (shift && w > 900) {
      camera.aspect = (w * 1.5) / h;
      camera.setViewOffset(w * 1.5, h, 0, 0, w, h);
    } else {
      camera.clearViewOffset();
      camera.aspect = w / h;
    }
    camera.lookAt(0, 0.55, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, shift]);
  return null;
}

export function ScanCar({ shift = true, active = true }: { shift?: boolean; active?: boolean }) {
  const still = useMemo(reduceMotion, []);
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 2]}
      camera={{ fov: 28, position: [7.4, 2.5, 7.4], near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true }}
    >
      <Framing shift={shift} />
      <Car still={still} />
      <Floor />
    </Canvas>
  );
}
