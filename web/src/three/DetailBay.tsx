import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { EpoxyFloor, FrostedDoor, HexLights, PanelWall, ROOM_HEIGHT } from './GarageRoom';
import { Charger, SlatWall, Wheel, Workshop, useWallMaterials } from './GarageWalls';

/**
 * The room one car is shown in on its own page: a detail bay in the same style as the garage,
 * closed on all four sides because the camera goes all the way round. The car stands on an inlaid
 * turntable ring under its own hex light grid, on the same reflective epoxy.
 *
 * The car's length runs along x. Each wall is built as if it were the left wall (its plane at
 * x = −half, facing +x, running along z) and turned into place.
 */

/** Half the room's width (m): room to walk round a car of this length and still see the walls. */
export const bayHalf = (length: number) => Math.max(6.5, length * 1.45 + 0.8);

const LEFT = 0;
const BACK = -Math.PI / 2;
const RIGHT = Math.PI;
const FRONT = Math.PI / 2;

function Wall({ turn, children }: { turn: number; children: ReactNode }) {
  return <group rotation={[0, turn, 0]}>{children}</group>;
}

/** Warm LED strip along the foot of a wall, with a little light thrown on the wall and floor. */
function Cove({ half }: { half: number }) {
  return (
    <>
      <mesh position={[-half + 0.03, 0.06, 0]}>
        <boxGeometry args={[0.02, 0.025, 2 * half]} />
        <meshBasicMaterial color="#ffb877" toneMapped={false} />
      </mesh>
      <pointLight position={[-half + 0.4, 0.3, 0]} intensity={2.2} distance={4} decay={2} color="#ffb877" />
    </>
  );
}

export function DetailBay({ size }: { size: [number, number, number] }) {
  const [L, , W] = size;
  const half = bayHalf(L);
  const mats = useWallMaterials();
  const shadow = useMemo(() => {
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
  useEffect(() => () => shadow.dispose(), [shadow]);
  const ring = Math.hypot(L, W) / 2 + 0.35;
  const x = -half; // every wall, as the left wall

  return (
    <group>
      {/* Light: an area light under the hex grid over the car, soft bounce, warm coves. */}
      <hemisphereLight args={['#dfe4ee', '#2c2c30', 0.9]} />
      <rectAreaLight args={['#f2f6ff', 9, L + 1.4, W + 2]} position={[0, ROOM_HEIGHT - 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <HexLights x0={-L / 2 - 0.7} x1={L / 2 + 0.7} z0={-W / 2 - 1} z1={W / 2 + 1} />

      <EpoxyFloor width={2 * half} length={2 * half} />
      {/* The turntable: an inlaid steel ring, and the car's soft shadow inside it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <ringGeometry args={[ring - 0.035, ring, 160]} />
        <meshStandardMaterial color="#6b6f78" roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} scale={[L * 1.15, W * 1.3, 1]} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} color="#000000" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Behind the car from where the camera starts: the workshop and sign, then the wheel wall. */}
      <Wall turn={BACK}>
        <SlatWall x={x} side={-1} z0={-half} z1={half} mats={mats} />
        <Workshop x={x} side={-1} z0={1.4} run={3.6} mats={mats} />
        <Cove half={half} />
      </Wall>
      <Wall turn={LEFT}>
        <SlatWall x={x} side={-1} z0={-half} z1={half} mats={mats} />
        {[0, 1, 2].map((i) => (
          <Wheel key={i} position={[x + 0.2, 1.75, -half + 2.1 + i * 0.85]} side={-1} dark={i === 1} mats={mats} />
        ))}
        <Charger x={x} side={-1} z={-half + 5.1} mats={mats} />
        <Cove half={half} />
      </Wall>
      {/* The way in: a wide frosted door in a panelled wall. */}
      <Wall turn={RIGHT}>
        <group position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <PanelWall width={2 * half} />
          <group position={[0, 0, 0.02]}>
            <FrostedDoor width={Math.min(4.8, 2 * half - 2)} height={2.6} />
          </group>
        </group>
        <Cove half={half} />
      </Wall>
      <Wall turn={FRONT}>
        <SlatWall x={x} side={-1} z0={-half} z1={half} mats={mats} />
        <Cove half={half} />
      </Wall>

      {/* Ceiling, facing down. */}
      <mesh position={[0, ROOM_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * half, 2 * half]} />
        <meshStandardMaterial color="#141518" roughness={1} />
      </mesh>
    </group>
  );
}
