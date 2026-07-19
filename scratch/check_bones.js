import fs from 'fs';
import path from 'path';

// Read glb header/JSON chunk to find node/bone names
const buffer = fs.readFileSync('public/model/source/one_one.glb');
const jsonLen = buffer.readUInt32LE(12);
const jsonStr = buffer.toString('utf8', 20, 20 + jsonLen);
const gltf = JSON.parse(jsonStr);

const boneNames = gltf.nodes.filter(n => n.name).map(n => n.name);
console.log('Total nodes:', boneNames.length);
console.log('All node names:', JSON.stringify(boneNames, null, 2));
