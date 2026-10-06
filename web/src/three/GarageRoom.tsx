import { MeshReflectorMaterial } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { GarageWalls } from './GarageWalls';

RectAreaLightUniformsLib.init();

/**
 * The garage the cars park in, done like a collector's garage or detailing studio: a dark
 * glossy epoxy floor that reflects the room and its lights, a hexagon LED grid overhead, walnut
 * slat walls with warm cove lighting along the base (and a workshop, wheels and a charger on them:
 * GarageWalls), and flush aluminium doors with frosted glass.
 * Every texture is drawn here, so there are no image files to download or license.
 *
 * The floor, hex lights, wall panels and doors are shared with the car's own detail bay (DetailBay).
 */

export const ROOM_HEIGHT = 3.2;
export const ROOM_SIDE = 1.6; // m between the outer bays and the side walls, for what's on the walls
const HEX = 0.42; // m, side of one hexagon in the ceiling grid
const TUBE = 0.035; // m, width of an LED tube
// The reflector multiplies the reflection by the floor's colour, so the near-black epoxy texture is
// lifted here; with mirror near 1 the floor is then dark where it reflects dark, bright where it reflects light.
const FLOOR_GAIN = new THREE.Color(3, 3, 3);

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A repeatable random generator, so the room looks the same every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Dark epoxy with a fine metallic flake. */
function epoxy() {
  return canvas(1024, 1024, (g) => {
    const r = rng(5);
    g.fillStyle = '#1c1d21';
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 26000; i++) {
      const v = r();
      g.fillStyle = v > 0.6 ? `rgba(150,152,160,${0.15 + r() * 0.25})` : `rgba(8,8,10,${0.2 + r() * 0.3})`;
      g.fillRect(r() * 1024, r() * 1024, 1 + r() * 1.6, 1 + r() * 1.6);
    }
  });
}

/** Large-format charcoal wall panels with fine reveals. */
function panels() {
  return canvas(512, 512, (g) => {
    g.fillStyle = '#212226';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#121316';
    g.fillRect(0, 0, 512, 3);
    g.fillRect(0, 0, 3, 512);
  });
}

/** A flush modern door: dark aluminium frame, frosted glass panels (4 × 4). */
function doorColour() {
  return canvas(512, 512, (g) => {
    g.fillStyle = '#17181b';
    g.fillRect(0, 0, 512, 512);
    const m = 14;
    const cell = (512 - m) / 4;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const x = m + i * cell;
        const y = m + j * cell;
        const grad = g.createLinearGradient(0, y, 0, y + cell);
        grad.addColorStop(0, '#9ea6b2');
        grad.addColorStop(1, '#7c8490');
        g.fillStyle = grad;
        g.fillRect(x, y, cell - m, cell - m);
      }
  });
}
function doorGlow() {
  return canvas(
    512,
    512,
    (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 512, 512);
      const m = 14;
      const cell = (512 - m) / 4;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = `rgb(${120 - j * 18},${130 - j * 18},${150 - j * 18})`;
          g.fillRect(m + i * cell, m + j * cell, cell - m, cell - m);
        }
    },
    false,
  );
}

/** Small brushed numbers for each bay. */
function bayNumber(n: number) {
  return canvas(256, 128, (g) => {
    g.fillStyle = 'rgba(214,216,222,0.9)';
    g.font = `500 72px 'JetBrains Mono Variable', ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n).padStart(2, '0'), 128, 66);
  });
}

/** The edges of a hexagon grid covering a rectangle (x0..x1 by z0..z1), as segments. */
function hexEdges(x0: number, x1: number, z0: number, z1: number) {
  const w = Math.sqrt(3) * HEX; // pointy-top hexagons
  const h = 1.5 * HEX;
  const segs: [THREE.Vector2, THREE.Vector2][] = [];
  const seen = new Set<string>();
  const key = (a: THREE.Vector2, b: THREE.Vector2) => {
    const k1 = `${a.x.toFixed(3)},${a.y.toFixed(3)}`;
    const k2 = `${b.x.toFixed(3)},${b.y.toFixed(3)}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };
  const inside = (p: THREE.Vector2) => p.x >= x0 && p.x <= x1 && p.y >= z0 && p.y <= z1;
  for (let row = 0; z0 + row * h <= z1 + h; row++) {
    for (let col = 0; x0 + col * w <= x1 + w; col++) {
      const cx = x0 + col * w + (row % 2 ? w / 2 : 0);
      const cz = z0 + row * h;
      const corners = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return new THREE.Vector2(cx + HEX * Math.cos(a), cz + HEX * Math.sin(a));
      });
      for (let k = 0; k < 6; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        if (!inside(a) || !inside(b)) continue;
        const kk = key(a, b);
        if (seen.has(kk)) continue;
        seen.add(kk);
        segs.push([a, b]);
      }
    }
  }
  // The frame around the grid.
  const c = [new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)];
  for (let k = 0; k < 4; k++) segs.push([c[k], c[(k + 1) % 4]]);
  return segs;
}

/** LED tubes along the given segments at height y, as one instanced mesh. */
function Tubes({
  segs,
  y,
  material,
  renderOrder = 0,
}: {
  segs: [THREE.Vector2, THREE.Vector2][];
  y: number;
  material: THREE.Material;
  renderOrder?: number;
}) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 0.03, TUBE);
    const m = new THREE.InstancedMesh(geo, material, segs.length);
    const o = new THREE.Object3D();
    segs.forEach(([a, b], i) => {
      const len = a.distanceTo(b);
      o.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
      o.rotation.set(0, -Math.atan2(b.y - a.y, b.x - a.x), 0);
      o.scale.set(len + TUBE, 1, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.renderOrder = renderOrder;
    return m;
  }, [segs, y, material, renderOrder]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

/** The ceiling's hexagon LED grid over a rectangle (x0..x1 by z0..z1). */
export function HexLights({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  const segs = useMemo(() => hexEdges(x0, x1, z0, z1), [x0, x1, z0, z1]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4f7ff', toneMapped: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  return <Tubes segs={segs} y={ROOM_HEIGHT - 0.03} material={material} />;
}

/**
 * Dark glossy epoxy, width (x) by length (z), centred at z. Its reflections are real: the scene
 * is drawn again from a mirrored camera, blurred the way a glossy (not mirror) finish blurs it.
 */
export function EpoxyFloor({ width, length, z = 0 }: { width: number; length: number; z?: number }) {
  const map = useMemo(() => {
    const t = epoxy();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(width / 2.5, length / 2.5);
    return t;
  }, [width, length]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, z]}>
      <planeGeometry args={[width, length]} />
      <MeshReflectorMaterial
        map={map}
        color={FLOOR_GAIN}
        mirror={0.97}
        mixStrength={1.6}
        mixBlur={0.5}
        blur={[120, 40]}
        resolution={1024}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

/** A wall of charcoal panels, `width` wide, facing +z from its position (place and turn it with a group). */
export function PanelWall({ width }: { width: number }) {
  const map = useMemo(() => {
    const t = panels();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(width / 1.2, ROOM_HEIGHT / 1.2);
    return t;
  }, [width]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh position={[0, ROOM_HEIGHT / 2, 0]}>
      <planeGeometry args={[width, ROOM_HEIGHT]} />
      <meshStandardMaterial map={map} roughness={0.7} metalness={0.15} />
    </mesh>
  );
}

/** A flush frosted-glass door, `width` wide, with a slim light bar above; faces +z. */
export function FrostedDoor({ width, height = 2.3 }: { width: number; height?: number }) {
  const tex = useMemo(() => ({ door: doorColour(), glow: doorGlow() }), []);
  useEffect(
    () => () => {
      tex.door.dispose();
      tex.glow.dispose();
    },
    [tex],
  );
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={tex.door} emissiveMap={tex.glow} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh position={[0, height + 0.1, 0.04]}>
        <boxGeometry args={[width, 0.03, 0.06]} />
        <meshBasicMaterial color="#fff6ea" toneMapped={false} />
      </mesh>
    </group>
  );
}

export interface RoomBay {
  x: number;
  width: number;
}

export function GarageRoom({
  bays,
  total,
  depth,
  front,
}: {
  bays: RoomBay[];
  total: number;
  depth: number;
  /** z of the open front (where the camera stands inside). */
  front: number;
}) {
  const width = total + 2 * ROOM_SIDE;
  const back = -depth / 2 - 0.5;
  const length = front - back;
  const numbers = useMemo(() => bays.map((_, i) => bayNumber(i + 1)), [bays]);
  useEffect(() => () => numbers.forEach((t) => t.dispose()), [numbers]);
  const lines = [-total / 2, ...bays.map((b) => b.x + b.width / 2)];

  return (
    <group>
      {/* Light: the hex grid (an area light over each bay), soft bounce, warm cove light on the walls. */}
      <hemisphereLight args={['#dfe4ee', '#2c2c30', 0.9]} />
      {bays.map((b, i) => (
        <rectAreaLight
          key={i}
          args={['#f2f6ff', 9, Math.min(b.width, 3), Math.min(depth, 5.5)]}
          position={[b.x, ROOM_HEIGHT - 0.04, -0.2]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
      <pointLight position={[0, ROOM_HEIGHT - 0.25, front - 1.5]} intensity={1.3} distance={14} decay={1.6} color="#ffe6c8" />
      {/* The hex grid spans the bays, back to front. */}
      <HexLights x0={-total / 2 + 0.2} x1={total / 2 - 0.2} z0={back + 0.7} z1={depth / 2 + 0.4} />

      {/* Floor: dark glossy epoxy, reflecting the cars and the lights. */}
      <EpoxyFloor width={width} length={length} z={(front + back) / 2} />
      {/* Bay markers: thin inlaid lines. */}
      {lines.map((x, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.035, depth]} />
          <meshStandardMaterial color="#6b6f78" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}

      {/* Back wall: charcoal panels, a flush frosted-glass door per bay with a slim light above. */}
      <group position={[0, 0, back]}>
        <PanelWall width={width} />
      </group>
      {bays.map((b, i) => (
        <group key={i} position={[b.x, 0, back + 0.02]}>
          <FrostedDoor width={Math.min(b.width - 0.5, 2.7)} />
          <mesh position={[0, 2.68, 0.01]}>
            <planeGeometry args={[0.5, 0.25]} />
            <meshStandardMaterial map={numbers[i]} alphaTest={0.3} roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      ))}

      {/* Side walls: walnut slats and what's mounted on them (GarageWalls), a warm cove light along the floor. */}
      <GarageWalls width={width} back={back} front={front} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[(s * width) / 2 - s * 0.03, 0.06, (front + back) / 2]}>
            <boxGeometry args={[0.02, 0.025, length]} />
            <meshBasicMaterial color="#ffb877" toneMapped={false} />
          </mesh>
          <pointLight position={[(s * width) / 2 - s * 0.4, 0.3, back / 2]} intensity={2.2} distance={4} decay={2} color="#ffb877" />
        </group>
      ))}
      {/* Ceiling, facing down. */}
      <mesh position={[0, ROOM_HEIGHT, (front + back) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#141518" roughness={1} />
      </mesh>
    </group>
  );
}
