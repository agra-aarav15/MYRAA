import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export default function AvatarCanvas({ 
  expression = 'idle',
  isSpeaking = false,
  mood = { happiness: 50, energy: 50, affection: 50, focus: 50, curiosity: 50 }
}) {
  const containerRef = useRef(null);
  const modelRef = useRef(null);
  const bonesRef = useRef({});
  const mouseRef = useRef({ x: 0, y: 0 });
  const isSpeakingRef = useRef(isSpeaking);
  const expressionRef = useRef(expression);
  const moodRef = useRef(mood);

  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileLowPower, setMobileLowPower] = useState(false);

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { expressionRef.current = expression; }, [expression]);
  useEffect(() => { moodRef.current = mood; }, [mood]);

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

        // Arms
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

      // exact name matching for eyes
      model.traverse((node) => {
        if (!node.isBone) return;
        if (node.name === 'Eye_L_4') bones.eyeL = node;
        if (node.name === 'Eye_R_5') bones.eyeR = node;
      });

      bonesRef.current = bones;

      // === REST POSE: Arms down naturally ===
      if (bones.leftArm) {
        bones.leftArm.rotation.z = Math.PI / 2.8;
        bones.leftArm.rotation.x = 0.15;
        bones.leftArm.rotation.y = 0;
      }
      if (bones.rightArm) {
        bones.rightArm.rotation.z = -Math.PI / 2.8;
        bones.rightArm.rotation.x = 0.15;
        bones.rightArm.rotation.y = 0;
      }
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

    const clock = new THREE.Clock();
    let frameId;
    let speakPhase = 0;

    const hairPhysics = [];

    // State machine targets
    const poseState = {
      head: { x: 0, y: 0, z: 0 },
      chest: { x: 0, y: 0, z: 0 },
      hips: { x: 0, y: 0, z: 0 },
      leftShoulder: { x: 0, y: 0, z: 0 },
      rightShoulder: { x: 0, y: 0, z: 0 },
      leftArm: { x: 0, y: 0, z: 0 },
      rightArm: { x: 0, y: 0, z: 0 },
      eyeL: { x: 0, y: 0, z: 0 },
      eyeR: { x: 0, y: 0, z: 0 },
    };

    let nextBlinkTime = 0;
    let isBlinking = false;
    let blinkPhase = 0;

    let nextIdleShiftTime = 0;
    let idleSubPose = { x: 0, y: 0, z: 0 };

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

      const expr = expressionRef.current;
      const mood = moodRef.current || { happiness: 50, energy: 50, affection: 50 };
      
      const moodEnergy = (mood.energy !== undefined ? mood.energy : 50) / 100;
      const moodHappiness = (mood.happiness !== undefined ? mood.happiness : 50) / 100;

      // Base speeds influenced by mood
      const breathSpeed = 1.6 * (0.6 + moodEnergy * 0.8) * (expr === 'sad' || expr === 'thinking' ? 0.7 : 1);
      const breathAmp = 0.008 * (0.8 + moodEnergy * 0.4) * (expr === 'sad' ? 0.8 : 1);
      const swaySpeed = 0.4 * (0.8 + moodEnergy * 0.5) * (expr === 'excited' ? 1.5 : 1);

      // --- Blink Cycle ---
      if (t > nextBlinkTime) {
        isBlinking = true;
        blinkPhase = 0;
        nextBlinkTime = t + 2 + Math.random() * 4; // 2-6s interval
      }
      let blinkValue = 0;
      if (isBlinking) {
        blinkPhase += dt * 18; // blink speed
        if (blinkPhase >= Math.PI) {
          isBlinking = false;
        } else {
          blinkValue = Math.sin(blinkPhase) * 0.3; // eye rotation x for blink
        }
      }

      // --- Idle Variation ---
      if (t > nextIdleShiftTime) {
        idleSubPose = {
          x: (Math.random() - 0.5) * 0.04,
          y: (Math.random() - 0.5) * 0.04,
          z: (Math.random() - 0.5) * 0.04
        };
        nextIdleShiftTime = t + 8 + Math.random() * 7; // 8-15s
      }

      // --- Expression Targets ---
      let tHead = { x: idleSubPose.x, y: idleSubPose.y, z: idleSubPose.z };
      let tChest = { x: 0, y: 0, z: 0 };
      let tShoulderL = { x: 0, y: 0, z: 0 };
      let tShoulderR = { x: 0, y: 0, z: 0 };
      let tArmL = { x: 0, y: 0, z: 0 };
      let tArmR = { x: 0, y: 0, z: 0 };
      let tEye = { x: 0, y: 0, z: 0 };
      let trackFactor = 1.0;
      
      // Mood baseline modifiers
      if (moodHappiness > 0.6) {
        tHead.x -= 0.02; // slightly looking up/bright
      }

      switch(expr) {
        case 'happy':
          tHead.z += 0.05;
          tChest.x -= 0.03; // slight lift
          tArmL.z -= 0.1; 
          tArmR.z += 0.1;
          break;
        case 'thinking':
          tHead.z -= 0.08;
          tHead.x -= 0.05;
          tEye.x -= 0.1;
          tEye.y += 0.15;
          trackFactor = 0.3;
          break;
        case 'excited':
          tChest.x -= 0.05;
          tArmL.z -= 0.15;
          tArmR.z += 0.15;
          break;
        case 'sad':
          tShoulderL.z -= 0.1;
          tShoulderR.z += 0.1;
          tHead.x += 0.1;
          tChest.x += 0.05;
          trackFactor = 0.2;
          break;
        case 'angry':
          tShoulderL.z += 0.05;
          tShoulderR.z -= 0.05;
          tHead.x += 0.08;
          tEye.x -= 0.05;
          trackFactor = 1.2;
          break;
        case 'shy':
          tHead.y += 0.25;
          tHead.x += 0.08;
          tShoulderL.z += 0.05;
          tShoulderR.z -= 0.05;
          trackFactor = 0.1;
          break;
        case 'listening':
          tHead.z += 0.04;
          tHead.x -= 0.02;
          trackFactor = 1.1;
          break;
        case 'speaking':
          // handled dynamically
          break;
        case 'idle':
        default:
          break;
      }

      // LERP state targets (0.5s transition -> speed ~0.03 per frame at 60fps)
      const blendSpeed = 0.04;
      poseState.head.x = lerp(poseState.head.x, tHead.x, blendSpeed);
      poseState.head.y = lerp(poseState.head.y, tHead.y, blendSpeed);
      poseState.head.z = lerp(poseState.head.z, tHead.z, blendSpeed);
      poseState.chest.x = lerp(poseState.chest.x, tChest.x, blendSpeed);
      poseState.leftShoulder.z = lerp(poseState.leftShoulder.z, tShoulderL.z, blendSpeed);
      poseState.rightShoulder.z = lerp(poseState.rightShoulder.z, tShoulderR.z, blendSpeed);
      poseState.leftArm.z = lerp(poseState.leftArm.z, tArmL.z, blendSpeed);
      poseState.rightArm.z = lerp(poseState.rightArm.z, tArmR.z, blendSpeed);
      poseState.eyeL.x = lerp(poseState.eyeL.x, tEye.x, blendSpeed);
      poseState.eyeL.y = lerp(poseState.eyeL.y, tEye.y, blendSpeed);

      // --- 1. BREATHING ---
      const breathCycle = Math.sin(t * breathSpeed) * breathAmp;
      if (bones.spine) {
        bones.spine.rotation.x = lerp(bones.spine.rotation.x, (bones.spine.userData.restRotation?.x || 0) + breathCycle, 0.05);
      }
      if (bones.chest) {
        bones.chest.rotation.x = lerp(bones.chest.rotation.x, (bones.chest.userData.restRotation?.x || 0) + breathCycle * 0.6 + poseState.chest.x, 0.05);
      }

      // --- 2. HEAD TRACKING & EXPRESSION ---
      const targetHeadY = mouseRef.current.x * 0.3 * trackFactor + poseState.head.y;
      const targetHeadX = -mouseRef.current.y * 0.15 * trackFactor + poseState.head.x;
      if (bones.head) {
        bones.head.rotation.y = lerp(bones.head.rotation.y, targetHeadY, 0.04);
        bones.head.rotation.x = lerp(bones.head.rotation.x, (bones.head.userData.restRotation?.x || 0) + targetHeadX, 0.04);
        bones.head.rotation.z = lerp(bones.head.rotation.z, (bones.head.userData.restRotation?.z || 0) + poseState.head.z, 0.04);
      }
      if (bones.neck) {
        bones.neck.rotation.y = lerp(bones.neck.rotation.y, targetHeadY * 0.3, 0.03);
      }

      // --- 3. EYE TRACKING & BLINK ---
      const targetEyeY = mouseRef.current.x * 0.15 * trackFactor + poseState.eyeL.y;
      const targetEyeX = -mouseRef.current.y * 0.1 * trackFactor + poseState.eyeL.x + blinkValue;
      if (bones.eyeL) {
        bones.eyeL.rotation.y = lerp(bones.eyeL.rotation.y, targetEyeY, 0.08);
        bones.eyeL.rotation.x = lerp(bones.eyeL.rotation.x, targetEyeX, 0.12);
      }
      if (bones.eyeR) {
        bones.eyeR.rotation.y = lerp(bones.eyeR.rotation.y, targetEyeY, 0.08);
        bones.eyeR.rotation.x = lerp(bones.eyeR.rotation.x, targetEyeX, 0.12);
      }

      // --- 4. SHOULDERS & ARMS ---
      if (bones.leftShoulder) {
        bones.leftShoulder.rotation.z = lerp(bones.leftShoulder.rotation.z, (bones.leftShoulder.userData.restRotation?.z || 0) + poseState.leftShoulder.z, 0.05);
      }
      if (bones.rightShoulder) {
        bones.rightShoulder.rotation.z = lerp(bones.rightShoulder.rotation.z, (bones.rightShoulder.userData.restRotation?.z || 0) + poseState.rightShoulder.z, 0.05);
      }
      if (bones.leftArm) {
        bones.leftArm.rotation.z = lerp(bones.leftArm.rotation.z, (bones.leftArm.userData.restRotation?.z || 0) + poseState.leftArm.z, 0.05);
      }
      if (bones.rightArm) {
        bones.rightArm.rotation.z = lerp(bones.rightArm.rotation.z, (bones.rightArm.userData.restRotation?.z || 0) + poseState.rightArm.z, 0.05);
      }

      // --- 5. SPEAKING ANIMATION ---
      if (isSpeakingRef.current || expr === 'speaking') {
        speakPhase += dt * (5.5 + moodEnergy * 2);
        const nod = Math.sin(speakPhase) * 0.02 * (expr === 'speaking' || expr === 'excited' ? 1.5 : 1);
        const sway = Math.sin(speakPhase * 0.6) * 0.012;
        if (bones.head) {
          bones.head.rotation.x += nod;
          bones.head.rotation.z = lerp(bones.head.rotation.z || 0, sway + poseState.head.z, 0.06);
        }
        if (bones.upperChest) {
          bones.upperChest.rotation.x = lerp(bones.upperChest.rotation.x || 0, (bones.upperChest.userData.restRotation?.x || 0) + nod * 0.4, 0.05);
        }
      } else {
        speakPhase *= 0.92;
      }

      // --- 6. IDLE MICRO-SWAY ---
      const excitedSway = expr === 'excited' ? Math.sin(t * swaySpeed * 2) * 0.02 : 0;
      const idleY = Math.sin(t * swaySpeed) * 0.006 + excitedSway;
      if (bones.hips) {
        bones.hips.rotation.y = lerp(bones.hips.rotation.y || 0, idleY, 0.03);
      }

      // --- 7. HAIR PHYSICS ---
      if (bones.hairBones && bones.hairBones.length > 0) {
        bones.hairBones.forEach((hb, i) => {
          if (!hairPhysics[i]) hairPhysics[i] = { vel: 0, angle: 0 };
          const hp = hairPhysics[i];

          const headInfluence = (bones.head ? bones.head.rotation.y : 0) * 0.3;
          const exciteMotion = expr === 'excited' ? Math.sin(t * 3 + i) * 0.02 : 0;
          const windNoise = Math.sin(t * 1.2 + i * 0.7) * 0.015 + exciteMotion;
          const target = headInfluence + windNoise;
          
          const springForce = (target - hp.angle) * 12;
          hp.vel += springForce * dt;
          hp.vel *= 0.85; 
          hp.angle += hp.vel * dt;
          
          hb.rotation.z = (hb.userData.restRotation?.z || 0) + hp.angle;
          hb.rotation.x = (hb.userData.restRotation?.x || 0) + Math.sin(t * 0.8 + i) * 0.008;
        });
      }

      // --- 8. SKIRT PHYSICS ---
      if (bones.skirtBones && bones.skirtBones.length > 0) {
        bones.skirtBones.forEach((sb, i) => {
          const exciteSwing = expr === 'excited' ? Math.sin(t * 2.5 + i) * 0.02 : 0;
          const swing = Math.sin(t * 1.0 + i * 1.5) * 0.01 + exciteSwing;
          sb.rotation.z = (sb.userData.restRotation?.z || 0) + swing;
        });
      }

      renderer.render(scene, camera);
    };

    animate();

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

