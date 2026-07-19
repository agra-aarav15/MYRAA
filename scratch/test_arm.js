import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

global.self = global;
global.window = { URL: { createObjectURL: () => 'blob:dummy', revokeObjectURL: () => {} } };
global.document = {
  createElement: (tag) => {
    if (tag === 'canvas') return { getContext: () => null };
    if (tag === 'img') return { addEventListener: (event, cb) => { if (event === 'load') setTimeout(cb, 0); } };
    return {};
  },
  createElementNS: () => ({})
};

const loader = new GLTFLoader();
const buffer = fs.readFileSync('public/model/source/one_one.glb');
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

loader.parse(ab, '', (gltf) => {
  const model = gltf.scene;
  const bones = {};
  model.traverse(n => {
    if (n.isBone) bones[n.name] = n;
  });

  const rightArm = Object.values(bones).find(b => b.name.toLowerCase().includes('right_arm') || b.name.toLowerCase().includes('right arm'));
  const rightElbow = Object.values(bones).find(b => b.name.toLowerCase().includes('right_elbow') || b.name.toLowerCase().includes('right elbow'));

  model.updateMatrixWorld(true);
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  rightArm.getWorldPosition(p1);
  rightElbow.getWorldPosition(p2);
  console.log('T-Pose RightElbow relative to RightArm:', p2.clone().sub(p1));

  ['x', 'y', 'z'].forEach(ax => {
    [-1.3, -1.0, 1.0, 1.3].forEach(ang => {
      rightArm.rotation.set(0, 0, 0);
      rightArm.rotation[ax] = ang;
      model.updateMatrixWorld(true);
      const p3 = new THREE.Vector3();
      rightElbow.getWorldPosition(p3);
      const diff = p3.clone().sub(p1);
      console.log(`RightArm.${ax} = ${ang.toFixed(1)} -> diff X:${diff.x.toFixed(2)}, Y:${diff.y.toFixed(2)}, Z:${diff.z.toFixed(2)}`);
    });
  });
}, (err) => { console.error(err); });
