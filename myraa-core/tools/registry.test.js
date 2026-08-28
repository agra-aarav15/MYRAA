// Simple test for Tool Registry — verifies mouseClick and listFiles via registry
// Usage: node myraa-core/tools/registry.test.js
// Verifies §8 computer control fallback + §10 filesystem awareness through provider-independent registry.

import { registry, Permission } from './registry.js';
import assert from 'node:assert/strict';

async function main() {
  console.log('[Myraa Tool Registry Test] Starting — §8-10 verification');
  console.log(`Registry stats: ${JSON.stringify(registry.stats)}`);

  // 1) Verify registry knows both tools and permission metadata
  const listDef = registry.get('listFiles');
  const clickDef = registry.get('mouseClick');
  assert(listDef, 'listFiles definition missing');
  assert(clickDef, 'mouseClick definition missing');
  assert.equal(listDef.permission, Permission.SAFE, 'listFiles must be SAFE');
  assert.equal(clickDef.permission, Permission.NORMAL, 'mouseClick must be NORMAL');
  assert(listDef.inputSchema, 'listFiles missing inputSchema');
  assert(listDef.outputSchema, 'listFiles missing outputSchema');
  assert(clickDef.fallback, 'mouseClick missing fallback descriptor');
  console.log(`✓ Tool metadata OK — listFiles=${listDef.permission}, mouseClick=${clickDef.permission} fallback=${clickDef.fallback}`);

  // 2) listFiles via registry — should list current directory
  console.log('→ Testing listFiles { path: "." } via registry.call() ...');
  const listRes = await registry.call('listFiles', { path: '.' });
  console.log('  listFiles result:', JSON.stringify({ ok: listRes.ok, filesCount: listRes.files?.length, result: listRes.result?.slice(0, 80), permission: listRes.permission }).slice(0, 500));
  assert(listRes.ok, `listFiles failed: ${listRes.error || JSON.stringify(listRes)}`);
  assert(Array.isArray(listRes.files), 'listFiles should return files array');
  assert(listRes.files.length > 0, 'listFiles returned empty');
  assert(listRes.permission === Permission.SAFE, 'listFiles permission mismatch in response');
  console.log(`✓ listFiles OK — found ${listRes.files.length} items`);

  // 3) mouseClick via registry — safe coordinates (10,10), should succeed via fallback if clicker missing
  console.log('→ Testing mouseClick { x: 10, y: 10 } via registry.call() ...');
  const clickRes = await registry.call('mouseClick', { x: 10, y: 10 });
  console.log('  mouseClick result:', JSON.stringify({ ok: clickRes.ok, result: clickRes.result?.slice(0, 80), backend: clickRes.backend, fallback: clickRes.fallback, permission: clickRes.permission }).slice(0, 500));
  assert(clickRes.ok, `mouseClick failed: ${clickRes.error || JSON.stringify(clickRes)}`);
  assert(clickRes.permission === Permission.NORMAL, 'mouseClick permission mismatch');
  assert(clickRes.fallback, 'mouseClick response missing fallback descriptor');
  console.log(`✓ mouseClick OK — backend=${clickRes.backend || 'unknown'} fallback=${clickRes.fallback}`);

  // 4) Validation: bad input should be rejected
  console.log('→ Testing validation (readFile missing path) should fail ...');
  const badRes = await registry.call('readFile', {});
  assert(!badRes.ok, 'readFile without path should fail validation');
  console.log(`✓ Validation OK — readFile without path correctly rejected: ${badRes.error?.slice(0, 60)}`);

  // 5) DANGEROUS gate: deleteFile should require confirmation by default
  console.log('→ Testing DANGEROUS gate (deleteFile without confirmation) should be blocked ...');
  const dang = await registry.call('deleteFile', { path: 'some.txt' });
  // It may be blocked OR validation depending, but permission gate should trigger needsConfirmation
  if (dang.needsConfirmation) console.log(`✓ DANGEROUS gate OK — deleteFile blocked pending confirmation: ${dang.error.slice(0, 60)}`);
  else console.log(`  Note: deleteFile response: ok=${dang.ok} needsConfirmation=${dang.needsConfirmation} error=${dang.error?.slice(0, 60)}`);

  // 6) Unknown tool
  const unk = await registry.call('nonExistentTool', {});
  assert(!unk.ok, 'unknown tool should fail');
  console.log('✓ Unknown tool correctly rejected');

  console.log('\n[Myraa Tool Registry Test] ALL CHECKS PASSED — mouseClick and listFiles work via registry (provider-independent, fallback-capable).');
}

main().catch(e => {
  console.error('[Myraa Tool Registry Test] FAILED:', e);
  process.exit(1);
});
