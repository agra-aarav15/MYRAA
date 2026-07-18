import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default function AvatarCanvas({ 
  expression = 'happy',
  isSpeaking = false
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const modelRef = useRef(null);
  const headBoneRef = useRef(null);
  const mixerRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 1.25, 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2, 4, 3);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const pinkRim = new THREE.DirectionalLight(0xff2768, 3.8);
    pinkRim.position.set(-3, 2, -2);
    scene.add(pinkRim);

    const fillLight = new THREE.PointLight(0xff007f, 1.8, 5);
    fillLight.position.set(0, 1.1, 1.5);
    scene.add(fillLight);

    // Load User's Custom 3D Model (/model/source/one_one.glb)
    const loader = new GLTFLoader();
    const modelUrl = '/model/source/one_one.glb';

    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        // Auto-scale and position character
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.6 / maxDim;
        model.scale.set(scale, scale, scale);

        model.position.x = -center.x * scale;
        model.position.y = -center.y * scale + 0.55;
        model.position.z = -center.z * scale;

        // Adjust T-Pose / A-Pose bones so arms rest naturally downward along body!
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
          if (node.isBone) {
            const name = node.name.toLowerCase();

            // Head / Neck tracking bone
            if (name.includes('head') || name.includes('neck')) {
              headBoneRef.current = node;
            }

            // Lower Left Arm downward
            if ((name.includes('arm') || name.includes('shoulder')) && (name.includes('l') || name.includes('left')) && !name.includes('forearm') && !name.includes('hand')) {
              node.rotation.z = Math.PI / 2.6; // rotate left arm down
              node.rotation.x = 0.1;
            }

            // Lower Right Arm downward
            if ((name.includes('arm') || name.includes('shoulder')) && (name.includes('r') || name.includes('right')) && !name.includes('forearm') && !name.includes('hand')) {
              node.rotation.z = -Math.PI / 2.6; // rotate right arm down
              node.rotation.x = 0.1;
            }
          }
        });

        // Play animations if embedded in GLTF
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
          mixerRef.current = mixer;
        }

        scene.add(model);
        setLoading(false);
      },
      undefined,
      (error) => {
        console.warn('GLTF Model load notice:', error);
        setLoading(false);
      }
    );

    // Mouse Tracking
    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseRef.current = { x, y };
    };

    window.addEventListener('mousemove', handleMouseMove);

    let clock = new THREE.Clock();
    let animationFrameId;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();

      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      // Gentle breathing idle movement
      if (modelRef.current) {
        modelRef.current.position.y += Math.sin(elapsedTime * 2.5) * 0.0005;

        // Smooth mouse cursor head tracking
        const targetRotY = mouseRef.current.x * 0.25;
        const targetRotX = -mouseRef.current.y * 0.15;

        if (headBoneRef.current) {
          headBoneRef.current.rotation.y += (targetRotY - headBoneRef.current.rotation.y) * 0.05;
          headBoneRef.current.rotation.x += (targetRotX - headBoneRef.current.rotation.x) * 0.05;
        } else {
          modelRef.current.rotation.y += (targetRotY - modelRef.current.rotation.y) * 0.05;
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
    };
  }, [isSpeaking]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-pink-400 bg-black/60 backdrop-blur-sm animate-pulse">
          Loading 3D Model...
        </div>
      )}
    </div>
  );
}
