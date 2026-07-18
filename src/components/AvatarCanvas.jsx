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
  const [isMobile, setIsMobile] = useState(false);
  const [mobileLowPower, setMobileLowPower] = useState(false);

  // Mobile Detection
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
      if (mobile) setMobileLowPower(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mobileLowPower) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 1.25, 2.2);

    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
    renderer.shadowMap.enabled = !isMobile;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    // Calming Soft Natural Studio Lighting (No harsh neons)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff8f0, 2.0);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);

    const softFill = new THREE.PointLight(0xe4e4e7, 1.2, 6);
    softFill.position.set(-2, 1, 2);
    scene.add(softFill);

    // Load User 3D Model
    const loader = new GLTFLoader();
    const modelUrl = '/model/source/one_one.glb';

    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.6 / maxDim;
        model.scale.set(scale, scale, scale);

        model.position.x = -center.x * scale;
        model.position.y = -center.y * scale + 0.55;
        model.position.z = -center.z * scale;

        // Relax Arm Pose
        model.traverse((node) => {
          if (node.isBone) {
            const name = node.name.toLowerCase();
            if (name.includes('head') || name.includes('neck')) {
              headBoneRef.current = node;
            }
            if ((name.includes('arm') || name.includes('shoulder')) && (name.includes('l') || name.includes('left')) && !name.includes('forearm') && !name.includes('hand')) {
              node.rotation.z = Math.PI / 2.6;
              node.rotation.x = 0.1;
            }
            if ((name.includes('arm') || name.includes('shoulder')) && (name.includes('r') || name.includes('right')) && !name.includes('forearm') && !name.includes('hand')) {
              node.rotation.z = -Math.PI / 2.6;
              node.rotation.x = 0.1;
            }
          }
        });

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
      () => setLoading(false)
    );

    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseRef.current = { x, y };
    };

    window.addEventListener('mousemove', handleMouseMove);

    let clock = new THREE.Clock();
    let animationFrameId;

    // Physics Damping Parameters for Natural Motion
    let physicsVelocity = 0;
    let physicsPosY = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();

      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      // Real physics spring dynamics for natural breathing & sway
      if (modelRef.current) {
        const targetY = Math.sin(elapsedTime * 2.0) * 0.012;
        const springForce = (targetY - physicsPosY) * 15;
        physicsVelocity += springForce * delta;
        physicsVelocity *= 0.88; // Damping
        physicsPosY += physicsVelocity;

        modelRef.current.position.y = -0.25 + physicsPosY;

        const targetRotY = mouseRef.current.x * 0.22;
        const targetRotX = -mouseRef.current.y * 0.12;

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
  }, [isSpeaking, mobileLowPower, isMobile]);

  return (
    <div className="w-full h-full relative">
      {mobileLowPower ? (
        // Ultra-Smooth Mobile 2D Performance Card (Prevents phone battery drain & GPU lag)
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
          <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-4xl shadow-xl mb-4 animate-pulse">
            ✨
          </div>
          <span className="text-sm font-bold text-zinc-100">MYRAA Mobile AI Companion</span>
          <span className="text-xs text-zinc-500 mt-1">High-performance mobile mode active</span>
          
          <button
            onClick={() => setMobileLowPower(false)}
            className="mt-4 px-4 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-semibold hover:text-white transition"
          >
            Enable Full 3D Mode
          </button>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-zinc-400 bg-black/60 backdrop-blur-sm animate-pulse">
              Loading 3D Companion...
            </div>
          )}
          {isMobile && (
            <button
              onClick={() => setMobileLowPower(true)}
              className="absolute top-4 right-4 z-20 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono text-zinc-400 hover:text-white shadow-lg"
            >
              Mobile 2D Mode
            </button>
          )}
        </>
      )}
    </div>
  );
}
