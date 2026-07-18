import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default function AvatarCanvas({ 
  expression = 'happy',
  isSpeaking = false
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const modelRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const isSpeakingRef = useRef(isSpeaking);
  const expressionRef = useRef(expression);

  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileLowPower, setMobileLowPower] = useState(false);

  // Keep refs in sync with props
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { expressionRef.current = expression; }, [expression]);

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

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera — frame from roughly waist up, centered
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 1.1, 2.5);
    camera.lookAt(0, 0.9, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    // === Lighting: warm, soft, studio-quality ===
    const ambientLight = new THREE.AmbientLight(0xfff5ee, 0.8);
    scene.add(ambientLight);

    // Main key light — warm, from upper-right
    const keyLight = new THREE.DirectionalLight(0xfff0e6, 1.8);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);

    // Fill light — cool, subtle, from left
    const fillLight = new THREE.DirectionalLight(0xe8ecf0, 0.6);
    fillLight.position.set(-3, 2, 2);
    scene.add(fillLight);

    // Rim/back light — subtle edge highlight
    const rimLight = new THREE.PointLight(0xffffff, 0.5, 8);
    rimLight.position.set(0, 3, -2);
    scene.add(rimLight);

    // === Load the model ===
    const loader = new GLTFLoader();
    loader.load(
      '/model/source/one_one.glb',
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        // Compute bounding box to center & scale properly
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Scale so model height is about 1.8 units (fills frame nicely)
        const targetHeight = 1.8;
        const scale = targetHeight / size.y;
        model.scale.setScalar(scale);

        // Center horizontally and sit feet on the ground
        model.position.x = -center.x * scale;
        model.position.y = -box.min.y * scale; // feet at y=0
        model.position.z = -center.z * scale;

        // Improve material quality
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.needsUpdate = true;
            }
          }
        });

        scene.add(model);
        setLoading(false);
      },
      undefined,
      (err) => {
        console.error('Model load error:', err);
        setLoading(false);
      }
    );

    // Mouse / touch tracking
    const handlePointerMove = (e) => {
      if (!containerRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current = {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1,
      };
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove, { passive: true });

    // === Animation loop with real spring physics ===
    const clock = new THREE.Clock();
    let animationFrameId;

    // Spring physics state
    let breathPhase = 0;
    let swayAngleY = 0;        // current horizontal sway
    let swayVelocityY = 0;
    let tiltAngleX = 0;        // current forward/back tilt
    let tiltVelocityX = 0;
    let speakBouncePhase = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05); // clamp delta
      const elapsed = clock.getElapsedTime();

      if (!modelRef.current) {
        renderer.render(scene, camera);
        return;
      }

      const model = modelRef.current;

      // --- 1. Breathing: gentle vertical bob ---
      breathPhase += delta * 1.8;
      const breathOffset = Math.sin(breathPhase) * 0.006;

      // --- 2. Eye-tracking / body turn toward mouse (spring-damped) ---
      const targetSwayY = mouseRef.current.x * 0.15;  // look left/right
      const targetTiltX = -mouseRef.current.y * 0.06;  // slight lean

      const springK = 8;   // spring stiffness
      const damping = 0.82; // damping factor

      swayVelocityY += (targetSwayY - swayAngleY) * springK * delta;
      swayVelocityY *= damping;
      swayAngleY += swayVelocityY * delta;

      tiltVelocityX += (targetTiltX - tiltAngleX) * springK * delta;
      tiltVelocityX *= damping;
      tiltAngleX += tiltVelocityX * delta;

      // --- 3. Speaking animation: subtle rhythmic nod ---
      let speakNod = 0;
      let speakSway = 0;
      if (isSpeakingRef.current) {
        speakBouncePhase += delta * 6;
        speakNod = Math.sin(speakBouncePhase) * 0.015;
        speakSway = Math.sin(speakBouncePhase * 0.7) * 0.008;
      } else {
        // Gently decay the bounce phase
        speakBouncePhase *= 0.95;
      }

      // --- 4. Idle micro-sway (so she never looks frozen) ---
      const idleSwayY = Math.sin(elapsed * 0.5) * 0.008;
      const idleSwayX = Math.sin(elapsed * 0.3 + 1.0) * 0.004;

      // --- Apply all to model ---
      model.rotation.y = swayAngleY + idleSwayY + speakSway;
      model.rotation.x = tiltAngleX + idleSwayX + speakNod;
      model.rotation.z = 0; // keep upright

      // Breathing: apply to position
      const baseY = -0.0; // feet on ground
      model.position.y = baseY + breathOffset;

      renderer.render(scene, camera);
    };

    animate();

    // Resize handler
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
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
    };
  }, [mobileLowPower, isMobile]);

  return (
    <div className="w-full h-full relative">
      {mobileLowPower ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
          <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-4xl shadow-xl mb-4 animate-pulse">
            ✨
          </div>
          <span className="text-sm font-bold text-zinc-100">MYRAA</span>
          <span className="text-xs text-zinc-500 mt-1">Mobile performance mode</span>
          
          <button
            onClick={() => setMobileLowPower(false)}
            className="mt-4 px-4 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-semibold hover:text-white transition"
          >
            Enable 3D
          </button>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="w-full h-full absolute inset-0" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-zinc-400 bg-black/60 backdrop-blur-sm animate-pulse">
              Loading...
            </div>
          )}
          {isMobile && (
            <button
              onClick={() => setMobileLowPower(true)}
              className="absolute top-4 right-4 z-20 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono text-zinc-400 hover:text-white shadow-lg"
            >
              2D Mode
            </button>
          )}
        </>
      )}
    </div>
  );
}
