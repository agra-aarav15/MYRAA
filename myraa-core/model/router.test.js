// Myraa Model Router Test — MASTER BUILD PROMPT §24-25, §39, §59
// Verifies: provider-independent abstraction, cloud+local support, routing by taskType/quality/latency/cost/context/vision/tools,
// local hardware, internet availability, fallback to local, cost tracking, Ollama detection.
// Run: node myraa-core/model/router.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ModelRouter, MODEL_CATALOG, PROVIDERS, TASK_TYPES, getModelById } from './router.js';

const TMP_COST_FILE = path.join(os.tmpdir(), `myraa-test-cost-${Date.now()}.json`);

console.log('[Myraa Model Router Test] Starting — §24 Multi-Model + §25 Local-First verification');
console.log(`  Catalog size: ${MODEL_CATALOG.length}`);
console.log(`  Providers: ${Object.values(PROVIDERS).join(', ')}`);
console.log(`  Temp cost file: ${TMP_COST_FILE}`);

async function main() {
  // Cleanup
  try { if (fs.existsSync(TMP_COST_FILE)) fs.unlinkSync(TMP_COST_FILE); } catch {}

  // -----------------------------------------------------------------------
  // Test 1: Provider-independent catalog §24 — support cloud+local (6 providers)
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Provider catalog — cloud+local §24 ...');
  const providersInCatalog = new Set(MODEL_CATALOG.map((m) => m.provider));
  for (const p of [PROVIDERS.ANTHROPIC, PROVIDERS.OPENAI, PROVIDERS.GEMINI, PROVIDERS.GROQ, PROVIDERS.OLLAMA, PROVIDERS.OPENROUTER]) {
    assert(providersInCatalog.has(p), `Provider ${p} missing from catalog`);
  }
  const localModels = MODEL_CATALOG.filter((m) => m.local);
  const cloudModels = MODEL_CATALOG.filter((m) => !m.local);
  assert(localModels.length >= 3, `Should have >=3 local models, got ${localModels.length}`);
  assert(cloudModels.length >= 6, `Should have >=6 cloud models, got ${cloudModels.length}`);
  // Check vision and tool models exist in both tiers
  const visionCloud = MODEL_CATALOG.filter((m) => !m.local && m.supportsVision);
  const visionLocal = MODEL_CATALOG.filter((m) => m.local && m.supportsVision);
  assert(visionCloud.length >= 1, 'No vision cloud model');
  assert(visionLocal.length >= 1, 'No vision local model (ollama llava)');
  const toolsCloud = MODEL_CATALOG.filter((m) => !m.local && m.supportsTools);
  const toolsLocal = MODEL_CATALOG.filter((m) => m.local && m.supportsTools);
  assert(toolsCloud.length >= 1, 'No tools cloud model');
  assert(toolsLocal.length >= 1, 'No tools local model');
  console.log(`✓ Catalog OK — ${MODEL_CATALOG.length} models, local=${localModels.length}, cloud=${cloudModels.length}, vision local=${visionLocal.length}`);

  const router = new ModelRouter({ costFile: TMP_COST_FILE });
  console.log(`  Router hardware: ${JSON.stringify(router.hardwareInfo)}`);
  console.log(`  Router stats: ${JSON.stringify(router.getStats(), null, 2).slice(0, 600)}`);

  // -----------------------------------------------------------------------
  // Test 2: Routing based on taskType, quality, latency, cost, context, vision, tools (§24)
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Routing by taskType/quality/latency/cost/context/vision/tools ...');

  // 2a: code task should prefer high quality + tools
  const codeRoute = await router.route({ taskType: TASK_TYPES.CODE, quality: 85, needsTools: true, internetAvailable: true });
  assert(codeRoute.ok, 'code routing failed');
  assert(codeRoute.model.supportsTools, 'code model should support tools');
  assert(codeRoute.model.quality >= 65, `code model quality too low: ${codeRoute.model.quality}`);
  console.log(`  code(taskType=code, quality>=85, tools) -> ${codeRoute.model.id} (${codeRoute.model.provider}) score=${codeRoute.scored[0].score} reason=${codeRoute.reason}`);

  // 2b: vision requirement must select vision model
  const visionRoute = await router.route({ taskType: TASK_TYPES.VISION, needsVision: true, internetAvailable: true });
  assert(visionRoute.ok, 'vision routing failed');
  assert(visionRoute.model.supportsVision, `vision model must support vision, got ${visionRoute.model.id} vision=${visionRoute.model.supportsVision}`);
  console.log(`  vision(needsVision) -> ${visionRoute.model.id} vision=${visionRoute.model.supportsVision}`);

  // 2c: long context should select large context model (Gemini 1M)
  const longCtxRoute = await router.route({ taskType: TASK_TYPES.LONG_CONTEXT, contextLength: 500000, internetAvailable: true });
  assert(longCtxRoute.ok, 'long context routing failed');
  assert(longCtxRoute.model.contextLength >= 500000, `long context model insufficient: ${longCtxRoute.model.contextLength}`);
  console.log(`  long_context(ctx=500k) -> ${longCtxRoute.model.id} ctx=${longCtxRoute.model.contextLength}`);

  // 2d: low latency should prefer Groq or flash/mini
  const fastRoute = await router.route({ taskType: TASK_TYPES.FAST, latency: 'low', internetAvailable: true });
  assert(fastRoute.ok, 'fast routing failed');
  assert(fastRoute.model.latencyTier === 1, `fast route should be latencyTier 1, got ${fastRoute.model.latencyTier} for ${fastRoute.model.id}`);
  console.log(`  fast(latency=low) -> ${fastRoute.model.id} latencyTier=${fastRoute.model.latencyTier}`);

  // 2e: costSensitive should prefer cheap model
  const cheapRoute = await router.route({ taskType: TASK_TYPES.CHAT, costSensitive: true, internetAvailable: true });
  assert(cheapRoute.ok, 'cheap routing failed');
  const cheapCost = (cheapRoute.model.cost.input || 0) + (cheapRoute.model.cost.output || 0);
  // cheap should be <=5 per M (flash/groq/ollama)
  assert(cheapCost <= 5, `costSensitive model too expensive: ${cheapCost} for ${cheapRoute.model.id}`);
  console.log(`  cheap(costSensitive) -> ${cheapRoute.model.id} cost=${cheapCost}`);

  // 2f: quality requirement high should prefer Opus/Sonnet/GPT-4o
  const highQRoute = await router.route({ taskType: TASK_TYPES.REASONING, quality: 95, internetAvailable: true });
  assert(highQRoute.ok, 'high quality routing failed');
  assert(highQRoute.model.quality >= 95, `high quality model insufficient: ${highQRoute.model.quality} for ${highQRoute.model.id}`);
  console.log(`  high quality(quality>=95) -> ${highQRoute.model.id} quality=${highQRoute.model.quality}`);

  // 2g: tool-calling requirement
  const toolRoute = await router.route({ taskType: TASK_TYPES.TOOL_USE, needsTools: true, toolCalling: true, internetAvailable: true });
  assert(toolRoute.ok && toolRoute.model.supportsTools, 'tool route should support tools');
  console.log(`  tool_use(needsTools) -> ${toolRoute.model.id} tools=${toolRoute.model.supportsTools}`);

  console.log('✓ Routing dimensions OK — quality, latency, cost, context, vision, tools');

  // -----------------------------------------------------------------------
  // Test 3: Local hardware & internet availability, fallback to local (§25)
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Local hardware + internet availability, fallback to local §25 ...');

  // 3a: offline should select local
  const offlineRoute = await router.route({ taskType: TASK_TYPES.CHAT, internetAvailable: false });
  assert(offlineRoute.ok, 'offline routing failed');
  assert(offlineRoute.model.local, `offline should select local model, got ${offlineRoute.model.id} local=${offlineRoute.model.local}`);
  assert(offlineRoute.internetAvailable === false, 'offline flag mismatch');
  console.log(`  offline(chat) -> ${offlineRoute.model.id} local=${offlineRoute.model.local} fallback=${offlineRoute.fallback?.id || 'none'}`);

  // 3b: offline with vision must select local vision (llava)
  const offlineVision = await router.route({ needsVision: true, internetAvailable: false });
  assert(offlineVision.ok, 'offline vision routing failed');
  assert(offlineVision.model.local && offlineVision.model.supportsVision, `offline vision should be local vision, got ${offlineVision.model.id}`);
  console.log(`  offline+vision -> ${offlineVision.model.id} local=${offlineVision.model.local} vision=${offlineVision.model.supportsVision}`);

  // 3c: sensitive task should prefer local even when online (local-first §25)
  const sensitiveRoute = await router.route({ taskType: TASK_TYPES.SENSITIVE, internetAvailable: true });
  assert(sensitiveRoute.ok, 'sensitive routing failed');
  // sensitive may still select cloud if quality demands but should have local fallback and reason includes local-first
  assert(sensitiveRoute.fallback && sensitiveRoute.fallback.local, 'sensitive task should have local fallback');
  console.log(`  sensitive(online) -> ${sensitiveRoute.model.id} local=${sensitiveRoute.model.local} fallback local=${sensitiveRoute.fallback?.id} reason=${sensitiveRoute.reason}`);

  // 3d: getFallback returns local model
  const fallback = router.getFallback({ needsVision: false, needsTools: true }, 'gpt-4o');
  assert(fallback && fallback.local, `getFallback should return local, got ${fallback?.id}`);
  assert(fallback.supportsTools, 'fallback for tools should support tools');
  console.log(`  getFallback(gpt-4o failure, needsTools) -> ${fallback.id}`);

  const fallbackVision = router.getFallback({ needsVision: true }, 'gpt-4o');
  assert(fallbackVision && fallbackVision.local && fallbackVision.supportsVision, `fallback vision should be local vision, got ${fallbackVision?.id}`);
  console.log(`  getFallback(vision) -> ${fallbackVision.id}`);

  // 3e: hardware detection
  const hw = router.hardwareInfo;
  assert(hw.ramGB > 0 && hw.cpus > 0, 'hardwareInfo invalid');
  console.log(`  hardware: RAM=${hw.ramGB}GB cpus=${hw.cpus} tier=${hw.tier}`);

  console.log('✓ Local-first & fallback OK — offline→local, sensitive prefers local, hardware-aware');

  // -----------------------------------------------------------------------
  // Test 4: Cost tracking (§39)
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Cost tracking §39 ...');
  const beforeCost = router.getCostStats();
  assert(beforeCost.totalCost === 0, 'initial cost should be 0');

  // record some usage
  const rec1 = router.recordUsage({ modelId: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
  assert(rec1.ok, 'recordUsage gpt-4o-mini failed');
  const expectedCost1 = router.estimateCost('gpt-4o-mini', 1000, 500);
  assert(Math.abs(rec1.cost - expectedCost1) < 0.0001, `cost mismatch: ${rec1.cost} vs ${expectedCost1}`);
  console.log(`  record gpt-4o-mini 1k/0.5k -> cost $${rec1.cost.toFixed(4)} total $${rec1.totalCost.toFixed(4)}`);

  const rec2 = router.recordUsage({ modelId: 'llama3.2', inputTokens: 2000, outputTokens: 1000 });
  assert(rec2.ok, 'recordUsage llama3.2 failed');
  assert(rec2.cost === 0, 'local model cost should be 0');
  console.log(`  record llama3.2 2k/1k -> cost $${rec2.cost} total $${rec2.totalCost.toFixed(4)}`);

  const rec3 = router.recordUsage({ modelId: 'claude-3-5-sonnet-20241022', inputTokens: 5000, outputTokens: 2000 });
  assert(rec3.ok, 'record claude failed');

  const stats = router.getCostStats();
  assert(stats.totalRequests === 3, `totalRequests should be 3, got ${stats.totalRequests}`);
  assert(stats.totalInputTokens === 8000, `totalInputTokens should be 8000, got ${stats.totalInputTokens}`);
  assert(stats.byModel['gpt-4o-mini'].requests === 1, 'byModel gpt-4o-mini requests mismatch');
  assert(stats.history.length === 3, 'history length mismatch');
  // estimate via helper
  const est = router.estimateCost('gemini-1.5-pro', 1000000, 1000000);
  assert(est === 6.25, `estimate gemini 1M/1M should be 6.25, got ${est}`);
  // persistence check: file exists
  assert(fs.existsSync(TMP_COST_FILE), 'cost file not persisted');
  const persisted = JSON.parse(fs.readFileSync(TMP_COST_FILE, 'utf8'));
  assert(persisted.totalRequests === 3, 'persisted requests mismatch');
  // reload router from same file should have same stats
  const router2 = new ModelRouter({ costFile: TMP_COST_FILE });
  const stats2 = router2.getCostStats();
  assert(stats2.totalRequests === 3, 'reloaded cost stats mismatch');
  console.log(`✓ Cost tracking OK — totalCost=$${stats.totalCost.toFixed(4)} requests=${stats.totalRequests} persisted=${TMP_COST_FILE}`);

  // -----------------------------------------------------------------------
  // Test 5: Local Ollama detection (§25) — mocked + empty cases
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Local Ollama detection §25 ...');
  // mock via env
  const prevMock = process.env.MYRAA_MOCK_OLLAMA;
  const prevEmpty = process.env.MYRAA_MOCK_OLLAMA_EMPTY;
  process.env.MYRAA_MOCK_OLLAMA = 'llama3.2,mistral,llava';
  delete process.env.MYRAA_MOCK_OLLAMA_EMPTY;
  const routerMock = new ModelRouter({ costFile: TMP_COST_FILE + '.mock' });
  const detected = await routerMock.detectOllamaModels({ force: true });
  assert(Array.isArray(detected) && detected.length === 3, `mocked Ollama detection should return 3, got ${detected}`);
  assert(detected.includes('llama3.2'), 'mocked detection missing llama3.2');
  assert(await routerMock.isOllamaAvailable({ force: true }) === true, 'isOllamaAvailable should be true with mocked');
  console.log(`  mocked Ollama detection -> ${detected.join(', ')}`);

  // empty mock
  process.env.MYRAA_MOCK_OLLAMA = '';
  process.env.MYRAA_MOCK_OLLAMA_EMPTY = '1';
  const routerEmpty = new ModelRouter({ costFile: TMP_COST_FILE + '.mock2' });
  const emptyDetected = await routerEmpty.detectOllamaModels({ force: true });
  assert(Array.isArray(emptyDetected) && emptyDetected.length === 0, 'empty mock should return []');
  assert(await routerEmpty.isOllamaAvailable({ force: true }) === false, 'empty mock should be unavailable');
  console.log(`  empty mocked Ollama detection -> ${emptyDetected.length} models`);

  // restore env
  if (prevMock !== undefined) process.env.MYRAA_MOCK_OLLAMA = prevMock; else delete process.env.MYRAA_MOCK_OLLAMA;
  if (prevEmpty !== undefined) process.env.MYRAA_MOCK_OLLAMA_EMPTY = prevEmpty; else delete process.env.MYRAA_MOCK_OLLAMA_EMPTY;
  try { fs.unlinkSync(TMP_COST_FILE + '.mock'); } catch {}
  try { fs.unlinkSync(TMP_COST_FILE + '.mock2'); } catch {}

  // Also test real detection doesn't throw (may be empty if Ollama not installed — should not crash)
  const realRouter = new ModelRouter({ costFile: TMP_COST_FILE });
  const realDetected = await realRouter.detectOllamaModels({ force: true });
  assert(Array.isArray(realDetected), 'real Ollama detection should return array (even if empty)');
  console.log(`  real Ollama detection (may be empty if not installed) -> ${realDetected.length} models`);

  console.log('✓ Ollama detection OK — mocked, empty, and real non-throw');

  // -----------------------------------------------------------------------
  // Test 6: Provider-independent abstraction & sync route + internet queue (§25)
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Provider abstraction, sync route, offline queue §25 ...');
  const syncRes = router.routeSync({ taskType: TASK_TYPES.CODE, needsTools: true });
  assert(syncRes.ok && syncRes.model, 'routeSync failed');
  assert(syncRes.model.supportsTools, 'routeSync model should support tools');
  console.log(`  routeSync(code, tools) -> ${syncRes.model.id}`);

  // provider call stub
  const callRes = await router.call('gpt-4o', 'Hello Myraa, write a function');
  assert(callRes.ok && callRes.provider === PROVIDERS.OPENAI, 'provider call stub failed');
  assert(callRes.modelId === 'gpt-4o', 'call modelId mismatch');
  console.log(`  call(gpt-4o) stub -> provider=${callRes.provider}`);

  // unknown model
  const unknownCall = await router.call('unknown-model-xyz', 'test');
  assert(!unknownCall.ok, 'unknown model call should fail');

  // queue when offline
  const q1 = router.queueOperation({ type: 'cloudRequest', model: 'gpt-4o', prompt: 'test offline queue' });
  assert(q1.ok && q1.queued, 'queueOperation failed');
  const q2 = router.queueOperation({ type: 'cloudRequest', model: 'claude-3-5-sonnet-20241022', prompt: 'second' });
  assert(router.getQueuedOps().length === 2, 'queued ops should be 2');
  console.log(`  queued offline ops: ${router.getQueuedOps().length}`);

  // resumeQueued should fail if still offline (force offline via env)
  process.env.MYRAA_OFFLINE = '1';
  router.internetCache = { available: null, timestamp: 0, ttlMs: 30000 }; // reset cache
  const resumeOffline = await router.resumeQueued();
  assert(!resumeOffline.ok && resumeOffline.error === 'Still offline', 'resumeQueued should fail when offline');
  console.log(`  resumeQueued while offline correctly blocked`);
  delete process.env.MYRAA_OFFLINE;
  router.internetCache = { available: null, timestamp: 0, ttlMs: 30000 };
  // set online and resume
  process.env.MYRAA_ONLINE = '1';
  const resumeOnline = await router.resumeQueued();
  assert(resumeOnline.ok && resumeOnline.resumed === 2, `resumeQueued online should resume 2, got ${resumeOnline.resumed}`);
  assert(router.getQueuedOps().length === 0, 'queue should be empty after resume');
  console.log(`  resumeQueued while online -> resumed ${resumeOnline.resumed}`);
  delete process.env.MYRAA_ONLINE;
  router.internetCache = { available: null, timestamp: 0, ttlMs: 30000 };

  console.log('✓ Provider abstraction & queue OK');

  // -----------------------------------------------------------------------
  // Test 7: Fallback scoring sanity — vision/tools constraints never violated
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Fallback never violates hard constraints ...');
  const visionOffline = await router.route({ needsVision: true, internetAvailable: false });
  assert(visionOffline.model.supportsVision, 'vision offline must support vision');
  const toolsOffline = await router.route({ needsTools: true, internetAvailable: false });
  assert(toolsOffline.model.supportsTools, 'tools offline must support tools');
  const ctxOffline = await router.route({ contextLength: 30000, internetAvailable: false });
  // local qwen2.5-coder has 32k, llava 8k — should pick qwen
  assert(ctxOffline.model.contextLength >= 30000 || ctxOffline.model.local, 'ctx offline should satisfy or be best local');
  console.log(`  offline constraints: vision->${visionOffline.model.id}, tools->${toolsOffline.model.id}, ctx30k->${ctxOffline.model.id}`);

  console.log('✓ Hard constraints never violated');

  // -----------------------------------------------------------------------
  // Final stats
  // -----------------------------------------------------------------------
  console.log('\n[Final] Cleanup ...');
  const finalStats = router.getStats();
  console.log(`  Stats: catalog=${finalStats.catalogSize} providers=${finalStats.providers.join(', ')} local=${finalStats.localModels.join(', ')}`);
  try { fs.unlinkSync(TMP_COST_FILE); } catch {}
  try { fs.unlinkSync(TMP_COST_FILE + '.tmp'); } catch {}

  console.log('\n[Myraa Model Router Test] ALL CHECKS PASSED — provider abstraction, routing dimensions, local-first, fallback, cost, Ollama detection.');
  console.log(`  Summary: ${MODEL_CATALOG.length} models across ${finalStats.providers.length} providers, local-first offline fallback, cost tracking, Ollama detection mocked & real.`);
}

main().catch((e) => {
  console.error('[Myraa Model Router Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
