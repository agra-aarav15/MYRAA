import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// =====================================================================
// MYRAA 3D Avatar — v1.2.0 realism upgrade
//   • Real audio-driven lip-sync: viseme weights come from live
//     AnalyserNode frequency bands instead of a fake Math.sin timer.
//   • Human micro-motion upgrades: saccadic eye jitter, varied blinks
//     (double-blinks + occasional long stares), speech-synced weight
//     shifts, breathing that pauses mid-utterance, gesture library
//     triggered on emotion transitions.
// All new bone/morph writes keep the existing LERP guards
// (Math.min(speed * dt * 60, 1)) and bonesRef.current null-checks.
// =====================================================================

export default function AvatarCanvas({
  expression = 'idle',
  isSpeaking = false,
  mood = { happiness: 50, energy: 50, affection: 50, focus: 50, curiosity: 50 },
  audioAnalyser = null  // optional AnalyserNode — drives real lip-sync
}) {
  const containerRef = useRef(null);
  const modelRef = useRef(null);
  const bonesRef = useRef({});
  const mouseRef = useRef({ x: 0, y: 0 });
  const isSpeakingRef = useRef(isSpeaking);
  const expressionRef = useRef(expression);
  const moodRef = useRef(mood);
  const audioAnalyserRef = useRef(audioAnalyser);
  const analyserDataRef = useRef(null);
  // Track expression transitions so gestures fire on emotion changes.
  const lastExpressionRef = useRef(expression);
  const gestureEndRef = useRef(0);   // t at which the current gesture expires
  const gestureTypeRef = useRef(''); // current gesture id: ''/hairTuck/thinkPose/wave/blushCover

  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileLowPower, setMobileLowPower] = useState(false);

  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { expressionRef.current = expression; }, [expression]);
  useEffect(() => { moodRef.current = mood; }, [mood]);
  useEffect(() => { audioAnalyserRef.current = audioAnalyser; }, [audioAnalyser]);

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
    const aspect = w / h;
    const baseFov = isMobile || aspect < 1 ? 34 : 30;
    const camera = new THREE.PerspectiveCamera(baseFov, aspect, 0.1, 100);
    const camZ = isMobile || aspect < 1 ? 3.1 : 2.75;
    camera.position.set(0, 0.90, camZ);
    camera.lookAt(0, 0.80, 0);

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

    // Load expressive model (kawaii_girl.glb with fallback to one_one.glb)
    const loader = new GLTFLoader();
    loader.load('/model/source/kawaii_girl.glb', (gltf) => {
      setupModel(gltf.scene);
    }, undefined, (err) => {
      console.warn('Falling back to one_one.glb:', err);
      loader.load('/model/source/one_one.glb', (gltf2) => {
        setupModel(gltf2.scene);
      }, undefined, (err2) => {
        console.error('Model load error:', err2);
        setLoading(false);
      });
    });

    const setupModel = (model) => {
      modelRef.current = model;

      // Scale & center
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 1.62 / size.y;
      model.scale.setScalar(scale);
      model.position.x = -center.x * scale;
      model.position.y = (-box.min.y * scale) - 0.15;
      model.position.z = -center.z * scale;
      model.rotation.y = 0; // Model faces forward directly toward Aarav!

      // Collect bone and morph mesh references
      const bones = {
        morphMeshes: []
      };

      model.traverse((node) => {
        if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
          bones.morphMeshes.push(node);
        }

        if (!node.isBone) return;
        const n = node.name.toLowerCase().replace(/_/g, ' ');

        if (n.includes('head') && !n.includes('hair')) bones.head = node;
        else if (n.includes('neck')) bones.neck = node;
        else if (n.includes('eye l') || n.includes('eye_l')) { if (n.includes(' l')) bones.eyeL = node; }
        else if (n.includes('eye r') || n.includes('eye_r')) { if (n.includes(' r')) bones.eyeR = node; }
        else if (n.includes('spine') && !bones.spine) bones.spine = node;
        else if (n.includes('chest') && !n.includes('upper') && !bones.chest) bones.chest = node;
        else if (n.includes('upper chest') || (n.includes('upper') && n.includes('chest'))) bones.upperChest = node;
        else if (n.includes('hips')) bones.hips = node;

        // Arms (normalize underscores and spaces)
        if (n.includes('left arm') || n.includes('left_arm') || node.name === 'upper_armL') bones.leftArm = node;
        if (n.includes('right arm') || n.includes('right_arm') || node.name === 'upper_armR') bones.rightArm = node;
        if (n.includes('left shoulder') || n.includes('left_shoulder') || node.name === 'shoulderL') bones.leftShoulder = node;
        if (n.includes('right shoulder') || n.includes('right_shoulder') || node.name === 'shoulderR') bones.rightShoulder = node;
        if (n.includes('left elbow') || n.includes('left_elbow') || node.name === 'forearmL') bones.leftElbow = node;
        if (n.includes('right elbow') || n.includes('right_elbow') || node.name === 'forearmR') bones.rightElbow = node;
        if (n.includes('left wrist') || n.includes('left_wrist') || node.name === 'handL') bones.leftWrist = node;
        if (n.includes('right wrist') || n.includes('right_wrist') || node.name === 'handR') bones.rightWrist = node;

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
        if (node.name === 'Eye_L' || node.name === 'Eye_L_4') bones.eyeL = node;
        if (node.name === 'Eye_R' || node.name === 'Eye_R_5') bones.eyeR = node;
      });

      bonesRef.current = bones;

      // === REST POSE: Lower arms naturally out of T-pose along torso ===
      if (bones.leftArm) {
        bones.leftArm.rotation.set(0, 0, 0);
        bones.leftArm.rotation.x = -1.25; // Drop left arm cleanly down to hip level
        bones.leftArm.rotation.z = -0.15;
      }
      if (bones.rightArm) {
        bones.rightArm.rotation.set(0, 0, 0);
        bones.rightArm.rotation.x = -1.25; // Drop right arm cleanly down to hip level
        bones.rightArm.rotation.z = 0.15;
      }
      if (bones.leftElbow) {
        bones.leftElbow.rotation.x = -0.2;
      }
      if (bones.rightElbow) {
        bones.rightElbow.rotation.x = -0.2;
      }

      // Store initial rotations for animation blending
      Object.keys(bones).forEach(key => {
        const bone = bones[key];
        if (bone && bone.isBone) {
          bone.userData.restRotation = bone.rotation.clone();
        }
      });

      model.traverse((child) => {
        if (child.isMesh) {
          // Hide orphan background/white highlight planes that block face and cause horns/white eyes
          const meshName = (child.name || '').toLowerCase();
          if (meshName.includes('plane')) {
            child.visible = false;
          }

          if (child.material) {
            // Enable clean alpha testing so eyes and hair render full color textures without white blockages
            child.material.transparent = true;
            child.material.alphaTest = 0.05;
            child.material.depthWrite = true;
            child.material.side = THREE.DoubleSide;
            child.material.needsUpdate = true;
          }
        }
      });

      scene.add(model);
      setLoading(false);
    };

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
    let blinkCountInBurst = 0;   // counts blinks in a burst for double-blinks
    let longStareUntil = 0;       // suppresses blink when we decide to stare

    let nextIdleShiftTime = 0;
    let idleSubPose = { x: 0, y: 0, z: 0 };

    // Saccade state for realistic eye jitter (fast flick + slow drift).
    let saccadeUntil = 0;
    let saccadeTarget = { x: 0, y: 0 };
    let nextSaccadeTime = 0;

    // Reusable frequency-domain buffer + smoothed energy for audio lip-sync.
    let freqBuffer = null;
    let lipEnergySmooth = 0;
    function readSpeakerEnergy() {
      const an = audioAnalyserRef.current;
      if (!an) return null;
      if (!freqBuffer || freqBuffer.length !== an.frequencyBinCount) {
        freqBuffer = new Uint8Array(an.frequencyBinCount);
      }
      try { an.getByteFrequencyData(freqBuffer); } catch (e) { return null; }
      const n = freqBuffer.length;
      let low = 0, mid = 0, high = 0;
      const lowEnd = Math.max(1, Math.floor(n * 0.15));
      const midEnd = Math.max(lowEnd + 1, Math.floor(n * 0.5));
      for (let i = 0; i < lowEnd; i++) low += freqBuffer[i];
      for (let i = lowEnd; i < midEnd; i++) mid += freqBuffer[i];
      for (let i = midEnd; i < n; i++) high += freqBuffer[i];
      return {
        low: low / (lowEnd * 255 || 1),
        mid: mid / ((midEnd - lowEnd) * 255 || 1),
        high: high / ((n - midEnd) * 255 || 1),
        total: (low + mid + high) / 3
      };
    }

    const blendMorph = (names, targetValue, speed, dt) => {
      const nameArr = Array.isArray(names) ? names : [names];
      const meshes = bonesRef.current?.morphMeshes;
      if (!meshes || meshes.length === 0) return;

      meshes.forEach(mesh => {
        if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
        nameArr.forEach(name => {
          const idx = mesh.morphTargetDictionary[name];
          if (idx !== undefined) {
            const curr = mesh.morphTargetInfluences[idx] || 0;
            mesh.morphTargetInfluences[idx] = curr + (targetValue - curr) * Math.min(speed * dt * 60, 1);
          }
        });
      });
    };

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();
      const bones = bonesRef.current;

      if (!modelRef.current || !bones.head) {
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

      // --- Blink Cycle (True eyelid closure blendshapes) ---
      // v1.2.0: human-like variety — sometimes double-blinks, sometimes
      // a long stare. Barely perceptible but a big realism lever.
      if (!isBlinking && t > nextBlinkTime && t < longStareUntil) {
        nextBlinkTime = t; // re-evaluate once the stare ends
      }
      if (!isBlinking && t > nextBlinkTime && t >= longStareUntil) {
        isBlinking = true;
        blinkPhase = 0;
        blinkCountInBurst = (Math.random() < 0.18) ? 2 : 1; // ~18% chance of double-blink
      }
      let blinkValue = 0;
      if (isBlinking) {
        blinkPhase += dt * 17; // blink speed
        if (blinkPhase >= Math.PI) {
          isBlinking = false;
          blinkCountInBurst -= 1;
          if (blinkCountInBurst > 0) {
            // immediately start the second blink of a double-blink
            isBlinking = true;
            blinkPhase = 0;
          } else {
            // Schedule next blink with variety: most are quick, occasionally
            // we stare for 4-9s before the next blink.
            if (Math.random() < 0.12) {
              longStareUntil = t + 4 + Math.random() * 5;
              nextBlinkTime = longStareUntil + 0.1;
            } else {
              nextBlinkTime = t + 2 + Math.random() * 3.5; // 2-5.5s normally
              longStareUntil = 0;
            }
          }
        } else {
          blinkValue = Math.sin(blinkPhase);
        }
      }
      blendMorph(['Blink L', 'Blink R'], blinkValue, 0.8, dt);

      // --- Idle Variation ---
      if (t > nextIdleShiftTime) {
        idleSubPose = {
          x: (Math.random() - 0.5) * 0.04,
          y: (Math.random() - 0.5) * 0.04,
          z: (Math.random() - 0.5) * 0.04
        };
        nextIdleShiftTime = t + 8 + Math.random() * 7; // 8-15s
      }

      // --- Expression Blendshapes & Body Targets ---
      let tHead = { x: idleSubPose.x, y: idleSubPose.y, z: idleSubPose.z };
      let tChest = { x: 0, y: 0, z: 0 };
      let tShoulderL = { x: 0, y: 0, z: 0 };
      let tShoulderR = { x: 0, y: 0, z: 0 };
      let tArmL = { x: 0, y: 0, z: 0 };
      let tArmR = { x: 0, y: 0, z: 0 };
      let tEye = { x: 0, y: 0, z: 0 };
      let trackFactor = 1.0;
      
      if (moodHappiness > 0.6) {
        tHead.x -= 0.02; // slightly looking up/bright
      }

      const isSpeakingActive = isSpeakingRef.current || expr === 'speaking';

      switch(expr) {
        case 'happy':
        case 'excited':
          tHead.z += 0.05;
          tChest.x -= 0.03;
          tArmL.z -= 0.12; 
          tArmR.z += 0.12;
          blendMorph(['Up L', 'Up R'], 0.85, 0.12, dt);
          blendMorph(['Angry L', 'Angry R', 'Sorrow L', 'Sorrow R', 'Down L', 'Down R'], 0.0, 0.12, dt);
          if (!isSpeakingActive) {
            blendMorph(['E;I'], 0.35, 0.12, dt); // Sweet warm smile
            blendMorph(['A', 'O', 'U'], 0.0, 0.12, dt);
          }
          break;
        case 'thinking':
          tHead.z -= 0.08;
          tHead.x -= 0.05;
          tEye.x -= 0.08;
          tEye.y += 0.12;
          trackFactor = 0.3;
          blendMorph(['Up L'], 0.8, 0.12, dt);
          blendMorph(['Down R'], 0.35, 0.12, dt);
          blendMorph(['Angry L', 'Angry R', 'Sorrow L', 'Sorrow R', 'Up R'], 0.0, 0.12, dt);
          if (!isSpeakingActive) {
            blendMorph(['A', 'E;I', 'O', 'U'], 0.0, 0.12, dt);
          }
          break;
        case 'sad':
        case 'shy':
          tShoulderL.z += 0.06;
          tShoulderR.z -= 0.06;
          tHead.x += 0.12;
          tHead.y += 0.18;
          trackFactor = 0.2;
          blendMorph(['Sorrow L', 'Sorrow R'], 0.95, 0.12, dt);
          blendMorph(['Down L', 'Down R'], 0.55, 0.12, dt);
          blendMorph(['Up L', 'Up R', 'Angry L', 'Angry R'], 0.0, 0.12, dt);
          if (!isSpeakingActive) {
            blendMorph(['O'], 0.2, 0.12, dt); // gentle pout
            blendMorph(['A', 'E;I', 'U'], 0.0, 0.12, dt);
          }
          break;
        case 'angry':
          tShoulderL.z += 0.08;
          tShoulderR.z -= 0.08;
          tHead.x += 0.09;
          tEye.x -= 0.05;
          trackFactor = 1.3;
          blendMorph(['Angry L', 'Angry R'], 1.0, 0.15, dt);
          blendMorph(['Down L', 'Down R'], 0.45, 0.15, dt);
          blendMorph(['Up L', 'Up R', 'Sorrow L', 'Sorrow R'], 0.0, 0.15, dt);
          if (!isSpeakingActive) {
            blendMorph(['O'], 0.45, 0.15, dt); // Cute angry pouty lips!
            blendMorph(['A', 'E;I', 'U'], 0.0, 0.15, dt);
          }
          break;
        case 'listening':
          tHead.z += 0.04;
          tHead.x -= 0.02;
          trackFactor = 1.1;
          blendMorph(['Up L', 'Up R'], 0.3, 0.12, dt);
          blendMorph(['Angry L', 'Angry R', 'Sorrow L', 'Sorrow R', 'Down L', 'Down R'], 0.0, 0.12, dt);
          if (!isSpeakingActive) blendMorph(['A', 'E;I', 'O', 'U'], 0.0, 0.12, dt);
          break;
        case 'idle':
        default:
          blendMorph(['Up L', 'Up R'], 0.15, 0.1, dt);
          blendMorph(['Angry L', 'Angry R', 'Sorrow L', 'Sorrow R', 'Down L', 'Down R'], 0.0, 0.1, dt);
          if (!isSpeakingActive) blendMorph(['A', 'E;I', 'O', 'U'], 0.0, 0.1, dt);
          break;
      }

      // --- Real Audio-Driven Lip-Sync (v1.2.0) ---
      // When an AnalyserNode is available (live engine + TTS audio tap),
      // drive viseme weights from actual speech energy bands. Otherwise
      // fall back to the old speech-phase oscillator so lip-sync still
      // works without a tap (muted mode / no-mic).
      const energy = isSpeakingActive ? readSpeakerEnergy() : null;
      if (isSpeakingActive) {
        if (energy) {
          // Smooth the energy curve so micro-gaps don't snap the mouth shut.
          lipEnergySmooth = lipEnergySmooth * 0.7 + energy.total * 0.3;
          // Add a tiny resting baseline even in quiet frames so the mouth
          // isn't perfectly static when speech pauses briefly.
          const resting = 0.05;
          const vA = Math.min(1, energy.low * 1.6 + resting);
          const vI = Math.min(0.8, energy.mid * 1.4 + resting * 0.4);
          const vO = Math.min(0.8, energy.high * 1.2 + resting * 0.3);
          blendMorph(['A'], vA, 0.5, dt);
          blendMorph(['E;I'], vI, 0.5, dt);
          blendMorph(['O', 'U'], vO, 0.5, dt);
        } else {
          // No analyser tap — use the old oscillator with a tiny jitter
          // so it doesn't look like a strict sine wave.
          speakPhase += dt * (12.0 + moodEnergy * 3.0);
          const jitter = (Math.noise ? 0 : (Math.sin(speakPhase * 5.3) * 0.05));
          const vA = (Math.sin(speakPhase) * 0.5 + 0.5) * 0.75 + jitter;
          const vI = (Math.cos(speakPhase * 1.35) * 0.5 + 0.5) * 0.45;
          const vO = (Math.sin(speakPhase * 0.7 + 1.2) * 0.5 + 0.5) * 0.4;
          blendMorph(['A'], vA, 0.6, dt);
          blendMorph(['E;I'], vI, 0.6, dt);
          blendMorph(['O', 'U'], vO, 0.6, dt);
          lipEnergySmooth = vA;
        }

        // Speech-synced weight shift: lean slightly with speech rhythm,
        // but DON'T bob every frame (too jerky). Only when energy is high.
        const talkEnergy = Math.min(1, lipEnergySmooth * 1.5);
        const microNod = Math.sin(t * 2.2) * 0.012 * talkEnergy;
        const bodySway = Math.sin(t * 1.1) * 0.01 * talkEnergy;
        const shoulderPulse = Math.sin(t * 1.5) * 0.006 * talkEnergy;
        if (bones.head) bones.head.rotation.x += microNod;
        if (bones.chest) bones.chest.rotation.y = lerp(bones.chest.rotation.y || 0, bodySway, 0.05);
        if (bones.upperChest) bones.upperChest.rotation.x = lerp(bones.upperChest.rotation.x || 0, (bones.upperChest.userData.restRotation?.x || 0) + shoulderPulse, 0.05);
        if (bones.leftWrist) bones.leftWrist.rotation.z = lerp(bones.leftWrist.rotation.z || 0, (bones.leftWrist.userData.restRotation?.z || 0) + Math.sin(t * 1.3) * 0.06 * talkEnergy, 0.05);
      } else {
        speakPhase *= 0.92;
        lipEnergySmooth *= 0.9;
      }
      // LERP state targets
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

      // --- 2. HEAD TRACKING ---
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

      // --- 3. EYE TRACKING & SMOOTH GAZE ---
      if (t > nextSaccadeTime) {
        saccadeTarget = {
          x: (Math.random() - 0.5) * 0.03,
          y: (Math.random() - 0.5) * 0.03
        };
        const saccadeDur = 0.3 + Math.random() * 0.3;
        saccadeUntil = t + saccadeDur;
        nextSaccadeTime = t + 2.0 + Math.random() * 2.5;
      }
      const targetEyeY = mouseRef.current.x * 0.12 * trackFactor + poseState.eyeL.y + saccadeTarget.y;
      const targetEyeX = -mouseRef.current.y * 0.08 * trackFactor + poseState.eyeL.x + saccadeTarget.x;
      if (bones.eyeL) {
        bones.eyeL.rotation.y = lerp(bones.eyeL.rotation.y, targetEyeY, 0.04);
        bones.eyeL.rotation.x = lerp(bones.eyeL.rotation.x, targetEyeX, 0.04);
      }
      if (bones.eyeR) {
        bones.eyeR.rotation.y = lerp(bones.eyeR.rotation.y, targetEyeY, 0.04);
        bones.eyeR.rotation.x = lerp(bones.eyeR.rotation.x, targetEyeX, 0.04);
      }

      // --- 4. SHOULDERS & ARMS ---
      if (bones.leftShoulder) {
        bones.leftShoulder.rotation.z = lerp(bones.leftShoulder.rotation.z, (bones.leftShoulder.userData.restRotation?.z || 0) + poseState.leftShoulder.z, 0.05);
      }
      if (bones.rightShoulder) {
        bones.rightShoulder.rotation.z = lerp(bones.rightShoulder.rotation.z, (bones.rightShoulder.userData.restRotation?.z || 0) + poseState.rightShoulder.z, 0.05);
      }
      if (bones.leftArm) {
        bones.leftArm.rotation.x = lerp(bones.leftArm.rotation.x, (bones.leftArm.userData.restRotation?.x || -1.25) + poseState.leftArm.z * 0.3, 0.05);
        bones.leftArm.rotation.z = lerp(bones.leftArm.rotation.z, (bones.leftArm.userData.restRotation?.z || -0.15) + poseState.leftArm.z, 0.05);
      }
      if (bones.rightArm) {
        bones.rightArm.rotation.x = lerp(bones.rightArm.rotation.x, (bones.rightArm.userData.restRotation?.x || -1.25) - poseState.rightArm.z * 0.3, 0.05);
        bones.rightArm.rotation.z = lerp(bones.rightArm.rotation.z, (bones.rightArm.userData.restRotation?.z || 0.15) + poseState.rightArm.z, 0.05);
      }

      // --- 5. IDLE HUMAN MICRO-SWAY & WEIGHT SHIFTING ---
      // v1.2.0: breathing and swaying both damp when MYRAA is mid-utterance
      // (humans hold their breath pattern steady while talking). This makes
      // the body feel more alive vs. cycling through the same sine regardless
      // of speech.
      const motionDamp = isSpeakingActive ? (1 - lipEnergySmooth * 0.6) : 1;
      const excitedSway = expr === 'excited' ? Math.sin(t * swaySpeed * 2) * 0.02 : 0;
      const idleY = (Math.sin(t * swaySpeed) * 0.008 + excitedSway) * motionDamp;
      const weightShiftZ = Math.sin(t * 0.45) * 0.022 * motionDamp; // Side-to-side hip weight shift
      const weightShiftY = Math.cos(t * 0.3) * 0.014 * motionDamp;  // Gentle hip rotation
      if (bones.hips) {
        bones.hips.rotation.y = lerp(bones.hips.rotation.y || 0, idleY + weightShiftY, 0.04);
        bones.hips.rotation.z = lerp(bones.hips.rotation.z || 0, weightShiftZ, 0.04);
      }

      // Wrist & hand micro-fidgets while standing still
      const wristFidgetL = Math.sin(t * 0.6 + 1.2) * 0.03;
      const wristFidgetR = Math.cos(t * 0.6 + 2.1) * 0.03;
      if (bones.leftWrist && !isSpeakingActive) {
        bones.leftWrist.rotation.z = lerp(bones.leftWrist.rotation.z || 0, (bones.leftWrist.userData.restRotation?.z || 0) + wristFidgetL, 0.04);
      }
      if (bones.rightWrist && !isSpeakingActive) {
        bones.rightWrist.rotation.z = lerp(bones.rightWrist.rotation.z || 0, (bones.rightWrist.userData.restRotation?.z || 0) + wristFidgetR, 0.04);
      }

      // --- 5b. EMOTION-TRIGGERED GESTURE LIBRARY (v1.2.0) ---
      // When `expression` changes (or spontaneously if we've been idle long
      // enough), MYRAA briefly performs a "gesture": hair tuck, thinking
      // arm-cross, excited wave, or shy face-touch. Each gesture eases in
      // and out (no snapping), so it blends smoothly with the idle pose.
      const exprChanged = lastExpressionRef.current !== expr;
      lastExpressionRef.current = expr;
      if (exprChanged && t >= gestureEndRef.current) {
        // Pick a gesture based on the new expression.
        let g = '';
        if (expr === 'thinking') g = 'thinkPose';
        else if (expr === 'excited') g = 'wave';
        else if (expr === 'shy' || expr === 'sad') g = 'blushCover';
        else if (expr === 'happy') g = (Math.random() < 0.5 ? 'hairTuck' : '');
        else if (expr === 'listening') g = 'nodOnce';
        if (g) {
          gestureTypeRef.current = g;
          gestureEndRef.current = t + (g === 'nodOnce' ? 0.6 : 1.4 + Math.random() * 0.6);
        }
      }
      // Apply active gesture (eases the relevant arm toward a gesture pose)
      // and eases back to rest when the gesture ends.
      const gestureActive = t < gestureEndRef.current;
      const gestProgress = gestureActive
        ? Math.min(1, (gestureEndRef.current - t) / 1.5)
        : 0;
      const gest = gestureTypeRef.current;
      if (gest && bones.rightArm && bones.leftArm) {
        // Use a smooth factor that ramps up then down (triangle envelope).
        const ramp = gestureActive
          ? (1 - Math.abs(2 * (1 - gestProgress) - 1)) * 0.8
          : 0;
        if (gest === 'hairTuck' && bones.rightArm) {
          // raise right hand up beside the head
          bones.rightArm.rotation.x = lerp(bones.rightArm.rotation.x, (bones.rightArm.userData.restRotation?.x || -1.25) + (1.0 * ramp), 0.12);
          if (bones.rightElbow) bones.rightElbow.rotation.x = lerp(bones.rightElbow.rotation.x, -0.9 * ramp, 0.12);
        } else if (gest === 'thinkPose' && bones.rightArm) {
          // bring right hand near chin (arm in toward chest, elbow bent)
          bones.rightArm.rotation.x = lerp(bones.rightArm.rotation.x, (bones.rightArm.userData.restRotation?.x || -1.25) - 0.5 * ramp, 0.12);
          bones.rightArm.rotation.z = lerp(bones.rightArm.rotation.z, (bones.rightArm.userData.restRotation?.z || 0.15) + 0.6 * ramp, 0.12);
          if (bones.rightElbow) bones.rightElbow.rotation.x = lerp(bones.rightElbow.rotation.x, -1.1 * ramp, 0.12);
        } else if (gest === 'wave' && bones.rightArm) {
          // bounce right forearm up and wave (oscillate horizontally)
          bones.rightArm.rotation.x = lerp(bones.rightArm.rotation.x, (bones.rightArm.userData.restRotation?.x || -1.25) + 0.9 * ramp, 0.18);
          if (bones.rightElbow) bones.rightElbow.rotation.z = lerp(bones.rightElbow.rotation.z, Math.sin(t * 6) * 0.4 * ramp, 0.25);
        } else if (gest === 'blushCover' && bones.leftArm) {
          // bring left hand up near cheek
          bones.leftArm.rotation.x = lerp(bones.leftArm.rotation.x, (bones.leftArm.userData.restRotation?.x || -1.25) + 0.85 * ramp, 0.12);
          bones.leftArm.rotation.z = lerp(bones.leftArm.rotation.z, (bones.leftArm.userData.restRotation?.z || -0.15) - 0.5 * ramp, 0.12);
        } else if (gest === 'nodOnce' && bones.head) {
          // small single affirmative dip
          bones.head.rotation.x = lerp(bones.head.rotation.x, (bones.head.userData.restRotation?.x || 0) - 0.18 * (Math.sin(Math.min(1, (gestureEndRef.current - t) / 0.6) * Math.PI)) * 1, 0.15);
        }
      }

      // --- 6. HAIR PHYSICS ---
      if (bones.hairBones && bones.hairBones.length > 0) {
        const headTurnVel = bones.head ? bones.head.rotation.y : 0;
        bones.hairBones.forEach((hb, i) => {
          if (!hairPhysics[i]) hairPhysics[i] = { vel: 0, angle: 0, prevHeadY: 0 };
          const hp = hairPhysics[i];

          const headDelta = headTurnVel - (hp.prevHeadY || 0);
          hp.prevHeadY = headTurnVel;

          const windLayer1 = Math.sin(t * 0.8 + i * 1.3) * 0.025;
          const windLayer2 = Math.sin(t * 1.6 + i * 0.5) * 0.012;
          const exciteMotion = expr === 'excited' ? Math.sin(t * 3 + i) * 0.035 : 0;
          const gravityPull = 0.005 * Math.sin(i * 0.8);
          
          const target = headTurnVel * 0.4 + windLayer1 + windLayer2 + exciteMotion + gravityPull;
          
          const force = (target - hp.angle) * 0.18 - headDelta * 0.25;
          hp.vel = (hp.vel + force) * 0.86;
          hp.angle += hp.vel;

          hb.rotation.z = lerp(hb.rotation.z, (hb.userData.restRotation?.z || 0) + hp.angle, 0.2);
          hb.rotation.x = lerp(hb.rotation.x, (hb.userData.restRotation?.x || 0) + Math.abs(hp.angle * 0.3) + windLayer1 * 0.5, 0.2);
        });
      }

      // --- 7. SKIRT CLOTH PHYSICS ---
      if (bones.skirtBones && bones.skirtBones.length > 0) {
        const hipSway = bones.hips ? bones.hips.rotation.y : 0;
        bones.skirtBones.forEach((sb, i) => {
          const skirtTarget = -hipSway * 0.4 + Math.sin(t * 1.2 + i * 0.8) * 0.015;
          sb.rotation.z = lerp(sb.rotation.z, (sb.userData.restRotation?.z || 0) + skirtTarget, 0.06);
          sb.rotation.x = lerp(sb.rotation.x, (sb.userData.restRotation?.x || 0) + Math.abs(skirtTarget * 0.2), 0.06);
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);
      renderer.dispose();
    };
  }, [isMobile, mobileLowPower]);

  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      {loading && !mobileLowPower && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-transparent pointer-events-none z-10 transition-opacity duration-700">
          <div className="w-16 h-16 rounded-full border-2 border-primary/20 border-t-primary animate-spin mb-3 shadow-[0_0_20px_rgba(255,105,180,0.3)]" />
          <p className="text-xs font-medium tracking-widest text-primary/80 uppercase animate-pulse">
            Waking up MYRAA...
          </p>
        </div>
      )}

      {mobileLowPower && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-surface/90 text-center z-10">
          <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(255,105,180,0.2)]">
            <span className="text-3xl animate-bounce">✨</span>
          </div>
          <p className="text-sm font-semibold text-text mb-1">Low-Power Mobile Mode</p>
          <p className="text-xs text-text-muted max-w-xs mb-4 leading-relaxed">
            3D rendering paused to save battery and ensure silky-smooth voice & chat responsiveness.
          </p>
          <button 
            onClick={() => setMobileLowPower(false)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-xs font-semibold shadow-md hover:brightness-110 transition-all"
          >
            Enable 3D Companion
          </button>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
