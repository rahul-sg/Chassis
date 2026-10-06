import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

/**
 * The garage the cars park in: polished concrete with saw-cut joints, painted bay lines and
 * wheel stops, slate walls with a roll-up door behind each bay, and LED strips over the bays
 * that light the room (the floor's sheen is their reflection). Every texture is drawn here,
 * so there are no image files to download or license.
 */

export const ROOM_HEIGHT = 3.2;
const JOINT = 3; // m between saw-cut joints in the slab

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

/** A repeatable random generator, so the floor looks the same every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** One 3 × 3 m tile of polished concrete: cloudy trowel marks, fine aggregate, joints on two edges. */
function concrete() {
  return canvas(1024, 1024, (g) => {
    const r = rng(7);
    g.fillStyle = '#5c5d60';
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 900; i++) {
      const x = r() * 1024;
      const y = r() * 1024;
      const rad = 30 + r() * 160;
      const v = 70 + r() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${v},${v},${v + 3},0.07)`);
      grad.addColorStop(1, `rgba(${v},${v},${v + 3},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const img = g.getImageData(0, 0, 1024, 1024);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(20,20,22,0.85)';
    g.fillRect(0, 0, 1024, 3);
    g.fillRect(0, 0, 3, 1024);
  });
}

function wall() {
  return canvas(512, 512, (g) => {
    const r = rng(11);
    g.fillStyle = '#2c2e33';
    g.fillRect(0, 0, 512, 512);
    // Lower band (about a metre of the 3.2 m wall), darker and harder-wearing, with a trim line.
    g.fillStyle = '#1f2024';
    g.fillRect(0, 512 * (1 - 1 / ROOM_HEIGHT), 512, 512);
    g.fillStyle = '#3a3c42';
    g.fillRect(0, 512 * (1 - 1 / ROOM_HEIGHT) - 3, 512, 3);
    const img = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 6;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

/** A roll-up door: ribbed steel slats, a rubber seal along the bottom. */
function door() {
  return canvas(512, 512, (g) => {
    for (let y = 0; y < 512; y += 16) {
      const grad = g.createLinearGradient(0, y, 0, y + 16);
      grad.addColorStop(0, '#8e9196');
      grad.addColorStop(0.45, '#a9acb1');
      grad.addColorStop(0.85, '#7c7f84');
      grad.addColorStop(1, '#55585c');
      g.fillStyle = grad;
      g.fillRect(0, y, 512, 16);
    }
    g.fillStyle = '#16171a';
    g.fillRect(0, 498, 512, 14);
  });
}

/** A painted line, a little worn. */
function paint() {
  return canvas(64, 512, (g) => {
    const r = rng(3);
    g.fillStyle = '#d8a93a';
    g.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.35})`;
      g.clearRect(r() * 64, r() * 512, 1 + r() * 3, 1 + r() * 4);
    }
  });
}

/** Rubber wheel stop with yellow reflective stripes. */
function stopper() {
  return canvas(256, 32, (g) => {
    g.fillStyle = '#1b1b1d';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#d8a93a';
    for (const x of [28, 108, 188]) g.fillRect(x, 0, 40, 32);
  });
}

/** "BAY 01", stencilled on the wall above a door. */
function stencil(n: number) {
  return canvas(512, 128, (g) => {
    g.fillStyle = 'rgba(232,232,226,0.82)';
    g.font = `700 88px 'Archivo Variable', 'Arial Narrow', Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`BAY ${String(n).padStart(2, '0')}`, 256, 68);
  });
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
  const width = total + 2.4;
  const back = -depth / 2 - 0.5;
  const length = front - back;
  const tex = useMemo(() => {
    const floor = concrete();
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(width / JOINT, length / JOINT);
    const walls = (span: number) => {
      const t = wall();
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(span / ROOM_HEIGHT, 1);
      return t;
    };
    return {
      floor,
      backWall: walls(width),
      sideWall: walls(length),
      door: door(),
      paint: paint(),
      stopper: stopper(),
      numbers: bays.map((_, i) => stencil(i + 1)),
    };
  }, [width, length, bays]);
  useEffect(
    () => () => {
      Object.values(tex)
        .flat()
        .forEach((t) => t.dispose());
    },
    [tex],
  );
  const lines = [-total / 2, ...bays.map((b) => b.x + b.width / 2)];
  const stopZ = -depth / 2 + 0.75;

  return (
    <group>
      {/* Light: a little bounce from the walls, a warm fill from the open front, an overhead
          light over each car (the floor's sheen), and a light bar above each door. */}
      <hemisphereLight args={['#d4d8e0', '#3a3a3e', 1.1]} />
      <pointLight position={[0, 2.4, front - 1]} intensity={6} distance={18} decay={1.4} color="#ffe9cf" />
      {bays.map((b, i) => {
        const bar = Math.min(b.width - 0.5, 2.7);
        return (
          <group key={i}>
            <rectAreaLight
              args={['#fff4e6', 60, 0.22, Math.min(depth * 0.7, 3.6)]}
              position={[b.x, ROOM_HEIGHT - 0.02, -0.4]}
              rotation={[-Math.PI / 2, 0, 0]}
            />
            <group position={[b.x, 3.0, back + 0.14]}>
              <rectAreaLight args={['#fff4e6', 45, bar, 0.12]} rotation={[-Math.PI / 2 - 0.5, 0, 0]} />
              <mesh>
                <boxGeometry args={[bar, 0.05, 0.1]} />
                <meshStandardMaterial color="#26282d" roughness={0.6} metalness={0.4} />
              </mesh>
              <mesh position={[0, -0.028, 0.01]}>
                <boxGeometry args={[bar - 0.04, 0.008, 0.07]} />
                <meshBasicMaterial color="#fffaf2" toneMapped={false} />
              </mesh>
            </group>
          </group>
        );
      })}

      {/* Floor: polished concrete. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, (front + back) / 2]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={tex.floor} roughness={0.24} metalness={0.05} />
      </mesh>
      {/* Bay lines, and the line along the back. */}
      {lines.map((x, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, 0]}>
          <planeGeometry args={[0.1, depth]} />
          <meshStandardMaterial map={tex.paint} roughness={0.55} alphaTest={0.5} />
        </mesh>
      ))}
      {/* Wheel stops behind each bay's rear tyres. */}
      {bays.map((b, i) => (
        <mesh key={i} position={[b.x, 0.06, stopZ]}>
          <boxGeometry args={[Math.min(1.6, b.width - 0.8), 0.12, 0.16]} />
          <meshStandardMaterial map={tex.stopper} roughness={0.8} />
        </mesh>
      ))}

      {/* Walls: back (with a door per bay), sides, and the front around the open door. */}
      <mesh position={[0, ROOM_HEIGHT / 2, back]}>
        <planeGeometry args={[width, ROOM_HEIGHT]} />
        <meshStandardMaterial map={tex.backWall} roughness={0.92} />
      </mesh>
      {bays.map((b, i) => {
        const w = Math.min(b.width - 0.5, 2.7);
        return (
          <group key={i} position={[b.x, 0, back + 0.02]}>
            <mesh position={[0, 1.15, 0]}>
              <planeGeometry args={[w, 2.3]} />
              <meshStandardMaterial map={tex.door} roughness={0.5} metalness={0.45} />
            </mesh>
            {/* Frame */}
            <mesh position={[0, 2.33, 0.01]}>
              <boxGeometry args={[w + 0.16, 0.08, 0.04]} />
              <meshStandardMaterial color="#141518" roughness={0.6} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * (w / 2 + 0.04), 1.17, 0.01]}>
                <boxGeometry args={[0.08, 2.34, 0.04]} />
                <meshStandardMaterial color="#141518" roughness={0.6} />
              </mesh>
            ))}
            <mesh position={[0, 2.62, 0.01]}>
              <planeGeometry args={[1.2, 0.3]} />
              <meshStandardMaterial map={tex.numbers[i]} alphaTest={0.3} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * width) / 2, ROOM_HEIGHT / 2, (front + back) / 2]} rotation={[0, -s * (Math.PI / 2), 0]}>
          <planeGeometry args={[length, ROOM_HEIGHT]} />
          <meshStandardMaterial map={tex.sideWall} roughness={0.92} />
        </mesh>
      ))}
      {/* Ceiling, facing down. */}
      <mesh position={[0, ROOM_HEIGHT, (front + back) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#1c1d21" roughness={1} />
      </mesh>
    </group>
  );
}
