import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default function AvatarCanvas({ 
  expression = 'happy',
  isSpeaking = false
}) {
  const containerRef = useRef(null);
  const modelRef = useRef(null);
  const bonesRef = useRef({});
  const mouseRef = useRef({ x: 0, y: 0 });
  const isSpeakingRef = useRef(isSpeaking);
  const expressionRef = useRef(expression);

  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileLowPower, setMobileLowPower] = useState(false);

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { expressionRef.current = expression; }, [expression]);

  // Mobile detection
  useEffect(() => {
    const check = () => {
      const m = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(m);
      if (m) setMobileLowPower(true);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mobileLowPower) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 100);
    camera.position.set(0, 1.2, 2.8);
    camera.lookAt(0, 1.0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    // Lighting — warm soft studio
    scene.add(new THREE.AmbientLight(0xfff5ee, 0.9));
    const key = new THREE.DirectionalLight(0xfff0e6, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe8ecf0, 0.5);
    fill.position.set(-3, 2, 2);
    scene.add(fill);
    const rim = new THREE.PointLight(0xffffff, 0.4, 8);
    rim.position.set(0, 3, -2);
    scene.add(rim);

    // Load model
    const loader = new GLTFLoader();
    loader.load('/model/source/one_one.glb', (gltf) => {
      const model = gltf.scene;
      modelRef.current = model;

      // Scale & center
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 1.8 / size.y;
      model.scale.setScalar(scale);
      model.position.x = -center.x * scale;
      model.position.y = -box.min.y * scale;
      model.position.z = -center.z * scale;

      // Collect bone references by name pattern
      const bones = {};
      model.traverse((node) => {
        if (!node.isBone) return;
        const n = node.name.toLowerCase();

        if (n.includes('head') && !n.includes('hair')) bones.head = node;
        else if (n.includes('neck')) bones.neck = node;
        else if (n.includes('eye_l') || n.includes('eye_l')) { if (n.includes('_l')) bones.eyeL = node; }
        else if (n.includes('eye_r') || n.includes('eye_r')) { if (n.includes('_r')) bones.eyeR = node; }
        else if (n.includes('spine') && !bones.spine) bones.spine = node;
        else if (n.includes('chest') && !n.includes('upper') && !bones.chest) bones.chest = node;
        else if (n.includes('upper chest') || (n.includes('upper') && n.includes('chest'))) bones.upperChest = node;
        else if (n.includes('hips')) bones.hips = node;

        // Arms — match "left arm" / "right arm" (upper arm)
        if (n.includes('left arm') || (n === 'left arm_51')) bones.leftArm = node;
        if (n.includes('right arm') || (n === 'right arm_70')) bones.rightArm = node;
        if (n.includes('left shoulder')) bones.leftShoulder = node;
        if (n.includes('right shoulder')) bones.rightShoulder = node;
        if (n.includes('left elbow')) bones.leftElbow = node;
        if (n.includes('right elbow')) bones.rightElbow = node;
        if (n.includes('left wrist')) bones.leftWrist = node;
        if (n.includes('right wrist')) bones.rightWrist = node;

        // Hair chains for physics
        if (n.includes('hair')) {
          if (!bones.hairBones) bones.hairBones = [];
          bones.hairBones.push(node);
        }

        // Skirt for cloth-like physics
        if (n.includes('skirt')) {
          if (!bones.skirtBones) bones.skirtBones = [];
          bones.skirtBones.push(node);
        }
      });

      // Also try exact name matching for eyes
      model.traverse((node) => {
        if (!node.isBone) return;
        if (node.name === 'Eye_L_4') bones.eyeL = node;
        if (node.name === 'Eye_R_5') bones.eyeR = node;
      });

      bonesRef.current = bones;

      // === REST POSE: Arms down naturally ===
      // The model likely has arms in T-pose. Rotate upper arms down along the body.
      if (bones.leftArm) {
        bones.leftArm.rotation.z = Math.PI / 2.8;   // rotate down
        bones.leftArm.rotation.x = 0.15;              // slightly forward
        bones.leftArm.rotation.y = 0;
      }
      if (bones.rightArm) {
        bones.rightArm.rotation.z = -Math.PI / 2.8;  // rotate down
        bones.rightArm.rotation.x = 0.15;
        bones.rightArm.rotation.y = 0;
      }
      // Slight natural elbow bend
      if (bones.leftElbow) {
        bones.leftElbow.rotation.x = 0;
        bones.leftElbow.rotation.z = 0.15;
      }
      if (bones.rightElbow) {
        bones.rightElbow.rotation.x = 0;
        bones.rightElbow.rotation.z = -0.15;
      }

      // Store initial rotations for animation blending
      Object.keys(bones).forEach(key => {
        const bone = bones[key];
        if (bone && bone.isBone) {
          bone.userData.restRotation = bone.rotation.clone();
        }
      });

      // Material quality
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.needsUpdate = true;
        }
      });

      scene.add(model);
      setLoading(false);
    }, undefined, (err) => {
      console.error('Model load error:', err);
      setLoading(false);
    });

    // Pointer tracking
    const onPointerMove = (e) => {
      if (!containerRef.current) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current = {
        x: ((cx - rect.left) / rect.width) * 2 - 1,
        y: -((cy - rect.top) / rect.height) * 2 + 1,
      };
    };
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    // === Animation loop ===
    const clock = new THREE.Clock();
    let frameId;
    let speakPhase = 0;

    // Hair physics state
    const hairPhysics = [];

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();
      const bones = bonesRef.current;

      if (!modelRef.current || !bones.hips) {
        renderer.render(scene, camera);
        return;
      }

      const lerp = (curr, target, speed) => curr + (target - curr) * Math.min(speed * dt * 60, 1);

      // --- 1. BREATHING: spine & chest gentle expand ---
      const breathCycle = Math.sin(t * 1.6) * 0.008;
      if (bones.spine) {
        bones.spine.rotation.x = lerp(bones.spine.rotation.x, (bones.spine.userData.restRotation?.x || 0) + breathCycle, 0.05);
      }
      if (bones.chest) {
        bones.chest.rotation.x = lerp(bones.chest.rotation.x, (bones.chest.userData.restRotation?.x || 0) + breathCycle * 0.6, 0.05);
      }

      // --- 2. HEAD TRACKING: follow mouse/touch ---
      const targetHeadY = mouseRef.current.x * 0.3;   // left/right
      const targetHeadX = -mouseRef.current.y * 0.15;  // up/down
      if (bones.head) {
        bones.head.rotation.y = lerp(bones.head.rotation.y, targetHeadY, 0.04);
        bones.head.rotation.x = lerp(bones.head.rotation.x, (bones.head.userData.restRotation?.x || 0) + targetHeadX, 0.04);
      }
      // Neck follows head partially
      if (bones.neck) {
        bones.neck.rotation.y = lerp(bones.neck.rotation.y, targetHeadY * 0.3, 0.03);
      }

      // --- 3. EYE TRACKING ---
      if (bones.eyeL) {
        bones.eyeL.rotation.y = lerp(bones.eyeL.rotation.y, mouseRef.current.x * 0.15, 0.08);
        bones.eyeL.rotation.x = lerp(bones.eyeL.rotation.x, -mouseRef.current.y * 0.1, 0.08);
      }
      if (bones.eyeR) {
        bones.eyeR.rotation.y = lerp(bones.eyeR.rotation.y, mouseRef.current.x * 0.15, 0.08);
        bones.eyeR.rotation.x = lerp(bones.eyeR.rotation.x, -mouseRef.current.y * 0.1, 0.08);
      }

      // --- 4. SPEAKING ANIMATION: nod + subtle body sway ---
      if (isSpeakingRef.current) {
        speakPhase += dt * 5.5;
        const nod = Math.sin(speakPhase) * 0.02;
        const sway = Math.sin(speakPhase * 0.6) * 0.012;
        if (bones.head) {
          bones.head.rotation.x += nod;
          bones.head.rotation.z = lerp(bones.head.rotation.z || 0, sway, 0.06);
        }
        if (bones.upperChest) {
          bones.upperChest.rotation.x = lerp(bones.upperChest.rotation.x || 0, (bones.upperChest.userData.restRotation?.x || 0) + nod * 0.4, 0.05);
        }
      } else {
        speakPhase *= 0.92;
        if (bones.head) {
          bones.head.rotation.z = lerp(bones.head.rotation.z || 0, 0, 0.04);
        }
      }

      // --- 5. IDLE MICRO-SWAY: never look frozen ---
      const idleY = Math.sin(t * 0.4) * 0.006;
      if (bones.hips) {
        bones.hips.rotation.y = lerp(bones.hips.rotation.y || 0, idleY, 0.03);
      }

      // --- 6. HAIR PHYSICS: secondary motion ---
      if (bones.hairBones && bones.hairBones.length > 0) {
        bones.hairBones.forEach((hb, i) => {
          // Initialize physics state
          if (!hairPhysics[i]) hairPhysics[i] = { vel: 0, angle: 0 };
          const hp = hairPhysics[i];

          // Hair swings based on head movement + gravity + wind
          const headInfluence = (bones.head ? bones.head.rotation.y : 0) * 0.3;
          const windNoise = Math.sin(t * 1.2 + i * 0.7) * 0.015;
          const target = headInfluence + windNoise;
          
          const springForce = (target - hp.angle) * 12;
          hp.vel += springForce * dt;
          hp.vel *= 0.85; // damping
          hp.angle += hp.vel * dt;
          
          hb.rotation.z = (hb.userData.restRotation?.z || 0) + hp.angle;
          hb.rotation.x = (hb.userData.restRotation?.x || 0) + Math.sin(t * 0.8 + i) * 0.008;
        });
      }

      // --- 7. SKIRT PHYSICS ---
      if (bones.skirtBones && bones.skirtBones.length > 0) {
        bones.skirtBones.forEach((sb, i) => {
          const swing = Math.sin(t * 1.0 + i * 1.5) * 0.01;
          sb.rotation.z = (sb.userData.restRotation?.z || 0) + swing;
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize
    const onResize = () => {
      if (!containerRef.current) return;
      const nw = containerRef.current.clientWidth;
      const nh = containerRef.current.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameId);
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
          <span className="text-xs text-zinc-500 mt-1">Mobile mode</span>
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
