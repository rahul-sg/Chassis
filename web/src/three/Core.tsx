import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The solid core inside a scanned car (server/garage/capture/core.py), placed with the splat's own
 * transform. It's opaque and coloured like the scan around it: where the scan's paint is thin you
 * see paint instead of the room behind the car, and the far side's splats are hidden behind it.
 */
export function Core({ url, matrix, front }: { url: string; matrix: number[]; front: 1 | -1 }) {
  const gltf = useLoader(GLTFLoader, url);
  // Coloured per vertex from the scan around it (see core.py), unlit like the splats.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), []);
  const object = useMemo(() => {
    const o = gltf.scene.clone(true);
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = material;
    });
    const m = new THREE.Matrix4().set(...(matrix as Parameters<THREE.Matrix4['set']>));
    if (front === -1) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(m);
    holder.add(o);
    return holder;
  }, [gltf, material, matrix, front]);
  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={object} />;
}
