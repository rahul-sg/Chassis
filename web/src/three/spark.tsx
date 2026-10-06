import { useThree } from '@react-three/fiber';
import { SparkRenderer } from '@sparkjsdev/spark';
import { useEffect } from 'react';
import type * as THREE from 'three';

/**
 * Spark draws Gaussian splats inside the normal three.js scene, with two renderers: one for the
 * main camera and one for the floor's reflection camera. Spark sorts the splats back to front for
 * the camera that draws them, and one shared order would show the far side of each car through
 * the near side in one of the two views. Each renderer is shown only to its own camera.
 */
export function Spark() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const main = new SparkRenderer({ renderer: gl });
    const mirrored = new SparkRenderer({ renderer: gl });
    scene.add(main, mirrored);
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (this: THREE.Scene, ...args) {
      main.visible = args[2] === camera;
      mirrored.visible = args[2] !== camera;
      before.apply(this, args);
    };
    return () => {
      scene.onBeforeRender = before;
      scene.remove(main, mirrored);
      main.dispose();
      mirrored.dispose();
    };
  }, [gl, scene, camera]);
  return null;
}
