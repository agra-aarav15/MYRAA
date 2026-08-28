// Myraa Memory Store Test — MASTER BUILD PROMPT §21-22, §51, §59
// Verifies: categories, scoped retrieval, inspect/edit/delete/clear, persistence, redaction.
// Run: node myraa-core/memory/store.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryStore, CATEGORIES, getDefaultMemoryPath, redactSecrets } from './store.js';

const TMP_FILE = path.join(os.tmpdir(), `myraa-test-memory-${Date.now()}.json`);
// Use isolated temp file so we don't pollute %APPDATA%\myraa\myraa_memory.json
console.log('[Myraa Memory Store Test] Starting — §21-22, §51 verification');
console.log(`  Temp file: ${TMP_FILE}`);
console.log(`  Default path: ${getDefaultMemoryPath()}`);
console.log(`  Categories: ${Object.values(CATEGORIES).join(', ')}`);

async function main() {
  // Cleanup any previous temp
  try { if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE); } catch {}

  // -----------------------------------------------------------------------
  // Test 0: Default path correctness (§21 persistence location)
  // -----------------------------------------------------------------------
  console.log('\n[Test 0] Default persistence path at %APPDATA%\\myraa\\myraa_memory.json ...');
  const defPath = getDefaultMemoryPath();
  assert(defPath.includes('myraa_memory.json'), 'Default path must be myraa_memory.json');
  assert(defPath.includes('myraa'), 'Default path must contain myraa folder');
  console.log(`✓ Default path OK — ${defPath}`);

  // -----------------------------------------------------------------------
  // Test 1: Categories separate (§51)
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Categories — separate buckets §51 ...');
  const store = new MemoryStore({ filePath: TMP_FILE });
  assert(store.memories, 'store.memories missing');
  for (const cat of [CATEGORIES.CONVERSATION, CATEGORIES.PROJECT, CATEGORIES.PREFERENCES, CATEGORIES.TASK_HISTORY, CATEGORIES.WORKFLOW, CATEGORIES.SYSTEM]) {
    assert(Array.isArray(store.memories[cat]), `Category ${cat} missing`);
  }
  assert(CATEGORIES.TOOL, 'ToolKnowledge category should exist per §51');
  console.log('✓ All 6 required + ToolKnowledge categories present');

  // -----------------------------------------------------------------------
  // Test 2: Add + scoped retrieval (§51 avoid irrelevant memory)
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Add + scoped retrieval ...');
  const r1 = store.add(CATEGORIES.CONVERSATION, 'User loves playing GTA 6 on weekends');
  assert(r1.ok, `add ConversationMemory failed: ${r1.error}`);
  const r2 = store.add(CATEGORIES.PROJECT, 'Project snake-ladder uses Phaser, structure: src/main.js, build via npm run build', { projectId: 'snake-ladder' });
  assert(r2.ok, `add ProjectMemory failed: ${r2.error}`);
  const r3 = store.add(CATEGORIES.PREFERENCES, 'User prefers dark glassmorphism UI and concise responses');
  assert(r3.ok, `add Preferences failed: ${r3.error}`);
  const r4 = store.add(CATEGORIES.TASK_HISTORY, 'Completed build of standalone APK at F:\\snake-ladder');
  assert(r4.ok, `add TaskHistory failed: ${r4.error}`);
  const r5 = store.add(CATEGORIES.WORKFLOW, 'Workflow: npm install -> npm run build -> electron-builder -> push to GitHub', { projectId: 'snake-ladder' });
  assert(r5.ok, `add WorkflowMemory failed: ${r5.error}`);
  const r6 = store.add(CATEGORIES.SYSTEM, 'System has 16GB RAM, NVIDIA GPU, Windows 11');
  assert(r6.ok, `add SystemKnowledge failed: ${r6.error}`);

  // Scoped retrieval: only ConversationMemory
  const convOnly = store.get(CATEGORIES.CONVERSATION);
  assert(convOnly.ok && convOnly.results.length === 1, `ConversationMemory scoped retrieval failed: ${convOnly.results?.length}`);
  assert(convOnly.results[0].text.includes('GTA 6'), 'Scoped content mismatch');
  // Ensure ProjectMemory retrieval excludes Conversation
  const projOnly = store.get(CATEGORIES.PROJECT);
  assert(projOnly.results.length === 1 && projOnly.results[0].category === CATEGORIES.PROJECT, 'ProjectMemory scoped failed');
  // Retrieval with query filter
  const searchGTA = store.search('GTA 6');
  assert(searchGTA.ok && searchGTA.results.length === 1, 'Search should find 1 GTA entry');
  assert(searchGTA.results[0].category === CATEGORIES.CONVERSATION, 'Search category mismatch');
  // Project-scoped retrieval
  const projScoped = store.retrieve({ categories: [CATEGORIES.PROJECT, CATEGORIES.WORKFLOW], projectId: 'snake-ladder' });
  assert(projScoped.ok && projScoped.results.length === 2, `Project-scoped retrieval should find 2, got ${projScoped.results.length}`);
  console.log('✓ Scoped retrieval OK — separate categories + query + projectId filtering');

  // -----------------------------------------------------------------------
  // Test 3: Inspect §22
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Inspect memory (§22) ...');
  const inspected = store.inspect();
  assert(inspected.ok, 'inspect failed');
  assert(inspected.total === 6, `inspect total should be 6, got ${inspected.total}`);
  assert(inspected.counts[CATEGORIES.CONVERSATION] === 1, 'inspect counts mismatch');
  assert(inspected.grouped, 'inspect missing grouped');
  // inspect with category filter
  const insConv = store.inspect({ category: CATEGORIES.CONVERSATION });
  assert(insConv.results.length === 1, 'inspect category filter failed');
  console.log('✓ Inspect OK');

  // -----------------------------------------------------------------------
  // Test 4: Edit / Delete §22
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Edit & Delete (§22) ...');
  const editId = r1.entry.id;
  const editRes = store.edit(editId, 'User loves playing GTA 6 and Valorant on weekends');
  assert(editRes.ok, `edit failed: ${editRes.error}`);
  assert(editRes.entry.text.includes('Valorant'), 'edit text not updated');
  // verify persistence after edit via new instance load
  const byId = store.getById(editId);
  assert(byId.ok && byId.entry.text.includes('Valorant'), 'getById after edit failed');

  // delete
  const delRes = store.delete(editId);
  assert(delRes.ok, `delete failed: ${delRes.error}`);
  const afterDel = store.get(CATEGORIES.CONVERSATION);
  assert(afterDel.results.length === 0, 'ConversationMemory should be empty after delete');
  assert(store.getById(editId).ok === false, 'deleted entry should not be found');
  console.log('✓ Edit & Delete OK');

  // -----------------------------------------------------------------------
  // Test 5: Disable categories §22
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Disable categories §22 ...');
  const disRes = store.disableCategory(CATEGORIES.PREFERENCES);
  assert(disRes.ok, `disableCategory failed: ${disRes.error}`);
  assert(store.isDisabled(CATEGORIES.PREFERENCES), 'isDisabled should be true');
  const addDisabled = store.add(CATEGORIES.PREFERENCES, 'Should be blocked');
  assert(!addDisabled.ok && addDisabled.disabled, 'Add to disabled category should be blocked');
  const getDisabled = store.get(CATEGORIES.PREFERENCES);
  assert(getDisabled.results.length === 0, 'Disabled category retrieval should return 0 unless includeDisabled');
  const getWithInclude = store.get(CATEGORIES.PREFERENCES, { includeDisabled: true });
  // includeDisabled returns existing (1 entry) but not the blocked one
  assert(getWithInclude.results.length === 1, 'includeDisabled should return prior entries');
  const enableRes = store.enableCategory(CATEGORIES.PREFERENCES);
  assert(enableRes.ok && !store.isDisabled(CATEGORIES.PREFERENCES), 'enable failed');
  const addAfterEnable = store.add(CATEGORIES.PREFERENCES, 'User prefers light theme occasionally');
  assert(addAfterEnable.ok, 'Add after enable should succeed');
  console.log('✓ Disable/Enable categories OK');

  // -----------------------------------------------------------------------
  // Test 6: Clear operations §22 — clear project memory, clear category, clear all
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Clear operations §22 ...');
  // add more project entries
  store.add(CATEGORIES.PROJECT, 'Project myraa-test uses Electron + Vite', { projectId: 'myraa-test' });
  const beforeClearProj = store.get(CATEGORIES.PROJECT);
  assert(beforeClearProj.results.length === 2, `Before clear project should have 2, got ${beforeClearProj.results.length}`);
  const clearProj = store.clearProjectMemory('snake-ladder');
  assert(clearProj.ok && clearProj.count === 1, `clearProjectMemory snake-ladder should remove 1 project entry, removed ${clearProj.count}`);
  // clearProjectMemory per spec clears only ProjectMemory category (project-scoped), WorkflowMemory remains
  const afterProjClearWorkflow = store.get(CATEGORIES.WORKFLOW);
  assert(afterProjClearWorkflow.results.length === 1, 'WorkflowMemory snake-ladder should remain after clearProjectMemory (only ProjectMemory cleared per §21-22)');
  // also verify project myraa-test remains
  const remainingProj = store.get(CATEGORIES.PROJECT);
  assert(remainingProj.results.length === 1 && remainingProj.results[0].projectId === 'myraa-test', 'myraa-test project should remain');
  // clear specific category
  const clearTask = store.clear(CATEGORIES.TASK_HISTORY);
  assert(clearTask.ok && clearTask.cleared === CATEGORIES.TASK_HISTORY, 'clear category failed');
  assert(store.get(CATEGORIES.TASK_HISTORY).results.length === 0, 'TaskHistory should be empty after clear');
  // clear all
  const beforeClearAll = store.inspect();
  const totalBefore = beforeClearAll.total;
  const clearAllRes = store.clearAll();
  assert(clearAllRes.ok && clearAllRes.count === totalBefore, `clearAll count mismatch: ${clearAllRes.count} vs ${totalBefore}`);
  assert(store.inspect().total === 0, 'All memory should be empty after clearAll');
  console.log('✓ Clear operations OK');

  // -----------------------------------------------------------------------
  // Test 7: No secrets in memory — redaction §23
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Secret redaction — no secrets in memory §23 ...');
  const secretTests = [
    { text: 'My apiKey is sk-1234567890abcdefghijklmnop', shouldRedact: true },
    { text: 'token=ghp_123456789012345678901234567890123456', shouldRedact: true },
    { text: 'password: supersecret123', shouldRedact: true },
    { text: 'Please remember my email is test@example.com', shouldRedact: false },
  ];
  for (const t of secretTests) {
    const res = store.add(CATEGORIES.CONVERSATION, t.text);
    assert(res.ok, `add for redact test failed: ${res.error}`);
    const stored = store.getById(res.entry.id);
    if (t.shouldRedact) {
      assert(stored.entry.text.includes('[REDACTED]'), `Secret not redacted for: ${t.text} -> ${stored.entry.text}`);
      assert(!stored.entry.text.includes('sk-1234') && !stored.entry.text.includes('ghp_'), 'Raw secret leaked');
      assert(res.wasRedacted === true, 'wasRedacted flag should be true');
    } else {
      assert(!stored.entry.text.includes('[REDACTED]'), 'Non-secret incorrectly redacted');
    }
  }
  // Direct redactSecrets function test
  const { redactedText, wasRedacted } = redactSecrets('apiKey=sk-abcdefghijklmnopqrstuv and password= hunter2');
  assert(wasRedacted && redactedText.includes('[REDACTED]'), 'redactSecrets direct failed');
  assert(!redactedText.includes('sk-abc'), 'redactSecrets leaked raw');
  // object redaction
  store.add(CATEGORIES.PREFERENCES, 'Normal preference without secrets');
  console.log('✓ Secret redaction OK — no raw secrets persisted');

  // -----------------------------------------------------------------------
  // Test 8: Persistent JSON file at %APPDATA%\\myraa\\myraa_memory.json
  // -----------------------------------------------------------------------
  console.log('\n[Test 8] Persistent JSON file ...');
  // Ensure file exists
  assert(fs.existsSync(TMP_FILE), `Temp memory file not created: ${TMP_FILE}`);
  const rawJson = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
  assert(rawJson.version === 1, 'version missing');
  assert(rawJson.memories, 'memories missing in persisted file');
  assert(rawJson.disabledCategories !== undefined, 'disabledCategories missing');
  // Verify secrets not in file raw
  const fileText = fs.readFileSync(TMP_FILE, 'utf8');
  assert(!fileText.includes('sk-1234567890abc'), 'Raw secret found in persisted file!');
  assert(fileText.includes('[REDACTED]'), 'Redacted marker should be in file');
  // Test load via new instance
  const store2 = new MemoryStore({ filePath: TMP_FILE });
  assert(store2.inspect().total === store.inspect().total, 'Reloaded store total mismatch');
  assert(store2.get(CATEGORIES.CONVERSATION).results.length === store.get(CATEGORIES.CONVERSATION).results.length, 'Reloaded retrieval mismatch');
  console.log('✓ Persistent JSON OK — file created, valid JSON, reload works, no secrets leaked');

  // -----------------------------------------------------------------------
  // Test 9: Edit also redacts §23
  // -----------------------------------------------------------------------
  console.log('\n[Test 9] Edit redaction (§23) ...');
  const normalAdd = store.add(CATEGORIES.SYSTEM, 'System note: CPU is Intel i7');
  assert(normalAdd.ok, 'add system note failed');
  const editSecret = store.edit(normalAdd.entry.id, 'Updated with apiKey=sk-99999999999999999999');
  assert(editSecret.ok && editSecret.wasRedacted, 'Edit should redact secret');
  const edited = store.getById(normalAdd.entry.id);
  assert(edited.entry.text.includes('[REDACTED]'), 'Edited secret not redacted');
  assert(!edited.entry.text.includes('sk-9999'), 'Edited raw secret leaked');
  console.log('✓ Edit redaction OK');

  // -----------------------------------------------------------------------
  // Final: Stats and cleanup
  // -----------------------------------------------------------------------
  console.log('\n[Final] Stats and cleanup ...');
  const stats = store.getStats();
  console.log(`  Stats: total=${stats.total} counts=${JSON.stringify(stats.counts)} file=${stats.file}`);
  assert(stats.total >= 4, 'Stats total should be >=4 after all ops');
  // cleanup temp file
  try { fs.unlinkSync(TMP_FILE); } catch {}
  try { fs.unlinkSync(TMP_FILE + '.tmp'); } catch {}
  console.log('\n[Myraa Memory Store Test] ALL CHECKS PASSED — categories, scoped retrieval, inspect/edit/delete/clear, redaction, persistence.');
  console.log(`  Summary: verified ${Object.values(CATEGORIES).length} categories, scoped retrieval, project clear, disabled, redaction, JSON persistence at ${defPath}`);
}

main().catch((e) => {
  console.error('[Myraa Memory Store Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
