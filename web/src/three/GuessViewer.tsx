import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';

/** The guessed mesh, lit softly, centred and sitting on the floor at unit-ish size. */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const o = scene.clone(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        // The colours come from the photo, lighting included, so they're shown mostly as they are.
        m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      }
    });
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const s = 3 / Math.max(size.x, size.z);
    o.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3());
    o.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    return o;
  }, [scene]);
  return <primitive object={object} />;
}

export function GuessViewer({ url }: { url: string }) {
  return (
    <div className="viewer viewer--guess">
      <Canvas camera={{ fov: 32, position: [4.2, 2.2, 4.6] }} dpr={[1, 2]}>
        <color attach="background" args={['#0a0a0c']} />
        <hemisphereLight args={['#ffffff', '#30303a', 2.2]} />
        <directionalLight position={[4, 6, 3]} intensity={1.4} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[6, 64]} />
          <meshBasicMaterial color="#0e0e11" toneMapped={false} />
        </mesh>
        <Suspense fallback={null}>
          <Model url={url} />
        </Suspense>
        <OrbitControls makeDefault enableDamping autoRotate autoRotateSpeed={0.8} target={[0, 0.5, 0]} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={2.5} maxDistance={12} />
      </Canvas>
      <span className="viewer__badge">AI guess from one photo</span>
    </div>
  );
}
