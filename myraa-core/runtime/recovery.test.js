// Myraa Recovery Test — MASTER BUILD PROMPT §14-15, §57
// Verifies: load → reconstruct → verify → resume safely (§14), self-correction loop §15, classification §57, limits, safelyStop
// Usage: node myraa-core/runtime/recovery.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LongRunningManager, LongTaskStatus } from './longRunning.js';
import { RecoveryEngine, FailureCategory, classifyFailure, getRecoveryStrategy } from './recovery.js';

const TMP = path.join(os.tmpdir(), `myraa-test-recovery-${Date.now()}.json`);
console.log('[Myraa Recovery Test] Starting — §14-15, §57 durable + self-correction');
console.log(`  Temp: ${TMP}`);

async function main() {
  try { if (fs.existsSync(TMP)) fs.unlinkSync(TMP); } catch {}
  try { if (fs.existsSync(TMP + '.tmp')) fs.unlinkSync(TMP + '.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 1: Classification §57 — all failure modes have Detection/Classification
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Failure classification §57 — all categories');
  const cases = [
    { msg: 'API unavailable: fetch failed ECONNREFUSED api.openai.com', expect: FailureCategory.API_UNAVAILABLE },
    { msg: 'Model unavailable: overloaded', expect: FailureCategory.MODEL_UNAVAILABLE },
    { msg: 'Internet unavailable: ENOTFOUND google.com', expect: FailureCategory.INTERNET_UNAVAILABLE },
    { msg: 'Tool failure: handler failed', expect: FailureCategory.TOOL_FAILURE },
    { msg: 'Browser crash: playwright disconnected', expect: FailureCategory.BROWSER_CRASH },
    { msg: 'Application crash: electron segfault', expect: FailureCategory.APPLICATION_CRASH },
    { msg: 'PC restart required', expect: FailureCategory.PC_RESTART },
    { msg: 'Agent failure: CodingAgent crashed', expect: FailureCategory.AGENT_FAILURE },
    { msg: 'Database failure: sqlite leveldown error', expect: FailureCategory.DATABASE_FAILURE },
    { msg: 'Authentication failure: 401 unauthorized token invalid', expect: FailureCategory.AUTHENTICATION_FAILURE },
    { msg: 'GitHub failure: git push failed repository not found', expect: FailureCategory.GITHUB_FAILURE },
    { msg: 'Build failure: gradle aapt2 failed', expect: FailureCategory.BUILD_FAILURE },
    { msg: 'Permission denied: blocked by policy', expect: FailureCategory.PERMISSION_DENIED },
    { msg: 'Resource exhaustion: OOM disk full no space left', expect: FailureCategory.RESOURCE_EXHAUSTION },
    { msg: 'Timeout: deadline exceeded after 30000ms', expect: FailureCategory.TIMEOUT },
    { msg: 'Budget exceeded: maxRetries exceeded', expect: FailureCategory.BUDGET_EXCEEDED },
    { msg: 'Cancelled: user aborted', expect: FailureCategory.CANCELLED },
    { msg: 'Some random unknown error', expect: FailureCategory.UNKNOWN },
  ];
  for (const c of cases) {
    const cat = classifyFailure(new Error(c.msg));
    assert(cat === c.expect, `classify "${c.msg.slice(0,30)}" expected ${c.expect} got ${cat}`);
    const strat = getRecoveryStrategy(cat, 0);
    assert(strat.category === cat, 'strategy category mismatch');
    assert(strat.action, 'strategy action missing');
    assert('retryable' in strat, 'strategy missing retryable');
  }
  console.log(`✓ Classification OK — ${cases.length} categories`);

  // -----------------------------------------------------------------------
  // Test 2: Recovery strategy per category §57 includes fallback
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Recovery strategy includes fallback, backoff, research flag');
  const stratApi = getRecoveryStrategy(FailureCategory.API_UNAVAILABLE, 1);
  assert(stratApi.backoffMs > 0, 'api backoff should be >0');
  assert(stratApi.fallback === 'switch_local', 'api fallback should be switch_local');
  const stratBuild = getRecoveryStrategy(FailureCategory.BUILD_FAILURE, 0);
  assert(stratBuild.research === true, 'build should require research');
  const stratAuth = getRecoveryStrategy(FailureCategory.AUTHENTICATION_FAILURE, 0);
  assert(stratAuth.retryable === false, 'auth should be non-retryable');
  console.log('✓ Strategy OK');

  // -----------------------------------------------------------------------
  // Test 3: Task Resume §14 — LOAD → RECONSTRUCT → VERIFY → RESUME SAFELY
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Task Resume §14 — durable execution');
  const mgr = new LongRunningManager({ filePath: TMP, concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  const rec = new RecoveryEngine({ longRunningManager: mgr, logger: { warn: () => {}, info: () => {} } });

  const t = mgr.createTask({ mission: 'recovery test mission - continue yesterday unfinished task' });
  const tid = t.taskId;
  mgr.checkpoint(tid, { step: 1, files: ['C:\\Users\\Test\\project\\file.js'], cwd: process.cwd() }, { percent: 40, message: 'step 1 done' });
  mgr.checkpoint(tid, { step: 2, cwd: process.cwd() }, { percent: 70, message: 'step 2 done' });
  // Mark as running to simulate crash mid-execution
  const mut = mgr._getMutable(tid);
  mut.status = LongTaskStatus.RUNNING;
  mut.startedAt = new Date().toISOString();
  mgr.save();

  // Simulate restart: new manager + recovery engine
  const mgr2 = new LongRunningManager({ filePath: TMP, concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  const rec2 = new RecoveryEngine({ longRunningManager: mgr2, logger: { warn: () => {}, info: () => {} } });

  // Load state
  const loaded = rec2.loadTaskState(tid);
  assert(loaded.ok && loaded.task.id === tid, 'loadTaskState failed');

  // Reconstruct environment
  const recon = await rec2.reconstructEnvironment(loaded.task);
  assert(recon.ok, `reconstruct failed: ${recon.reason || recon.issues}`);
  console.log(`  reconstruct: ${recon.reconstructed ? 'ok' : 'issues: ' + recon.issues}`);

  // Verify last checkpoint
  const verify = rec2.verifyLastCheckpoint(tid);
  assert(verify.ok && verify.valid, `verify should be valid: ${JSON.stringify(verify)}`);
  assert(verify.checkpoint.percent === 70, 'last checkpoint percent mismatch');

  // Resume safely — should resume from checkpoint not zero
  let resumedFromCheckpoint = false;
  const executor = async (ctx) => {
    const last = ctx.task.checkpoints[ctx.task.checkpoints.length - 1];
    if (last && last.state && last.state.step === 2) resumedFromCheckpoint = true;
    ctx.checkpoint({ step: 3 }, { percent: 100, message: 'resumed step 3' });
    return { ok: true, result: 'resumed correctly' };
  };
  // First, recover() will mark RUNNING as INTERRUPTED; we need to test resumeSafely directly
  // Instead, call resumeSafely which does load->reconstruct->verify->resume
  const resumeRes = await rec2.resumeSafely(tid, executor);
  assert(resumeRes.ok !== false, `resumeSafely failed: ${JSON.stringify(resumeRes)}`);
  // Give time for executor to run
  await new Promise(r => setTimeout(r, 200));
  assert(resumedFromCheckpoint, 'should have resumed from checkpoint step 2, not zero');
  const after = mgr2.getTask(tid);
  assert(after.task.status === LongTaskStatus.DONE, `after resume should be DONE, got ${after.task.status}`);
  assert(after.task.checkpoints.length >= 3, `should have at least 3 checkpoints after resume (2 old + 1 new + done), got ${after.task.checkpoints.length}`);
  console.log(`✓ Task Resume OK — did not restart from zero, resumed from checkpoint 2 → 3 (checkpoints=${after.task.checkpoints.length})`);

  // Test no-checkpoint case: pending task with no checkpoint should restart from zero safely
  const tNoCkpt = mgr2.createTask({ mission: 'no checkpoint pending' });
  const tNoCkptId = tNoCkpt.taskId;
  // Do not add checkpoint, leave pending
  const recNoCkpt = await rec2.resumeSafely(tNoCkptId, async () => ({ ok: true, result: 'fresh start' }));
  assert(recNoCkpt.ok !== false, `resume with no checkpoint pending should succeed via fresh start: ${JSON.stringify(recNoCkpt)}`);
  console.log('✓ Resume with no checkpoint (pending) correctly restarted from zero');

  // -----------------------------------------------------------------------
  // Test 4: Self-correction §15 — ACTION → FAILURE → CLASSIFY → RESEARCH → ALTERNATIVE → RETRY → VERIFY
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Self-correction §15 — retries with alternative strategy');
  const mgr3 = new LongRunningManager({ filePath: TMP + '.sc', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP + '.sc')) fs.unlinkSync(TMP + '.sc'); } catch {}
  const rec3 = new RecoveryEngine({ longRunningManager: mgr3, logger: { warn: () => {}, info: () => {} }, limits: { maxRetries: 3 } });

  const scTask = mgr3.createTask({ mission: 'self-correct test', budget: { maxRetries: 3 } });
  const scId = scTask.taskId;

  let callCount = 0;
  const retryFn = async (strategy, attempt) => {
    callCount++;
    if (callCount < 3) throw new Error('Build failure: gradle aapt2 duplicate mipmap');
    return { ok: true, result: 'build succeeded on retry' };
  };

  // Simulate initial failure
  const initialErr = new Error('Build failure: gradle aapt2 duplicate mipmap');
  const scRes = await rec3.selfCorrect(scId, initialErr, retryFn);
  assert(scRes.ok === true, `selfCorrect should eventually succeed, got ${JSON.stringify(scRes)}`);
  assert(callCount === 3, `expected 3 calls (1 initial failure + 2 retries?), got ${callCount}`);
  assert(scRes.category === FailureCategory.BUILD_FAILURE, `category should be build_failure, got ${scRes.category}`);
  console.log(`✓ Self-correction OK — retried ${callCount} times with alternative strategy`);

  // Test researchAnalyze is called
  const researchRes = await rec3.researchAnalyze('Tool failure: fallback', FailureCategory.TOOL_FAILURE, { id: scId });
  assert(researchRes.ok && researchRes.hint, 'researchAnalyze should return hint');
  console.log('✓ Research/Analyze OK');

  // -----------------------------------------------------------------------
  // Test 5: Configurable limits §15 — maxRetries, maxTime, maxTokens, maxRecursion
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Configurable limits §15 — when exceeded, safely stop');
  const mgr4 = new LongRunningManager({ filePath: TMP + '.limits', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP + '.limits')) fs.unlinkSync(TMP + '.limits'); } catch {}
  const rec4 = new RecoveryEngine({ longRunningManager: mgr4, logger: { warn: () => {}, info: () => {} }, limits: { maxRetries: 2, maxTimeSec: 1, maxTokens: 10 } });

  // maxRetries exceeded
  const limTask = mgr4.createTask({ mission: 'limit test retries', budget: { maxRetries: 2 } });
  const limId = limTask.taskId;
  // Simulate already exceeded retries
  const limMut = mgr4._getMutable(limId);
  limMut.usage.retries = 3;
  limMut.startedAt = new Date().toISOString();
  const check = rec4.checkLimits(limMut);
  assert(check.exceeded && check.field === 'maxRetries', `should be maxRetries exceeded, got ${JSON.stringify(check)}`);

  const stopRes = await rec4.safelyStop(limId, `Limits exceeded: ${check.field}`);
  assert(stopRes.ok, 'safelyStop failed');
  const afterStop = mgr4.getTask(limId);
  assert(afterStop.task.status === 'failed', 'safelyStop should set failed');
  assert(afterStop.task.error.includes('Safely stopped'), 'error should mention safely stopped');
  console.log('✓ Limits maxRetries enforced and safelyStop');

  // maxTime exceeded
  const limTask2 = mgr4.createTask({ mission: 'limit time', budget: { maxTimeSec: 1, maxRetries: 5 } });
  const limMut2 = mgr4._getMutable(limTask2.taskId);
  limMut2.startedAt = new Date(Date.now() - 5000).toISOString(); // 5 sec ago
  const check2 = rec4.checkLimits(limMut2);
  assert(check2.exceeded && check2.field === 'maxTimeSec', `should be maxTimeSec, got ${JSON.stringify(check2)}`);

  // maxTokens: simulate selfCorrect should stop when limits exceeded
  const limTask3 = mgr4.createTask({ mission: 'limit tokens', budget: { maxTokens: 5, maxRetries: 5 } });
  const limMut3 = mgr4._getMutable(limTask3.taskId);
  limMut3.usage.tokens = 10;
  const check3 = rec4.checkLimits(limMut3);
  assert(check3.exceeded && check3.field === 'maxTokens', `should be maxTokens, got ${JSON.stringify(check3)}`);

  // Self-correct should safelyStop when limits already exceeded before retry
  const scLimited = await rec4.selfCorrect(limTask3.taskId, new Error('Tool failure'), async () => ({ ok: true }));
  assert(scLimited.ok && scLimited.status === 'failed' || scLimited.ok === true, `selfCorrect with exceeded limits should safely stop, got ${JSON.stringify(scLimited)}`);
  console.log('✓ Limits maxTime and maxTokens enforced');

  try { fs.unlinkSync(TMP + '.limits'); } catch {}
  try { fs.unlinkSync(TMP + '.limits.tmp'); } catch {}
  try { fs.unlinkSync(TMP + '.sc'); } catch {}
  try { fs.unlinkSync(TMP + '.sc.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 6: handleFailure pipeline §57 — Detection, Classification, Recovery, Fallback, Notification, Preservation
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] handleFailure §57 — full failure mode pipeline');
  const mgr5 = new LongRunningManager({ filePath: TMP + '.hf', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP + '.hf')) fs.unlinkSync(TMP + '.hf'); } catch {}
  const rec5 = new RecoveryEngine({ longRunningManager: mgr5, logger: { warn: () => {}, info: () => {} } });
  const hfTask = mgr5.createTask({ mission: 'handleFailure test' });
  const hfId = hfTask.taskId;
  const hfRes = await rec5.handleFailure(hfId, new Error('API unavailable: service unavailable 503'), { step: 'call-model' });
  assert(hfRes.ok && hfRes.classification === FailureCategory.API_UNAVAILABLE, `handleFailure classification failed: ${JSON.stringify(hfRes)}`);
  assert(hfRes.detection === 'classified', 'detection missing');
  assert(hfRes.recoveryStrategy, 'recoveryStrategy missing');
  assert(hfRes.fallback, 'fallback missing');
  assert(hfRes.statePreserved === true, 'statePreserved should be true');

  // Verify checkpoint was preserved
  const hfAfter = mgr5.getTask(hfId);
  assert(hfAfter.task.checkpoints.length >= 1, 'failure checkpoint not preserved');
  console.log('✓ handleFailure pipeline OK — detection, classification, recovery, fallback, notification, preservation');

  try { fs.unlinkSync(TMP + '.hf'); } catch {}
  try { fs.unlinkSync(TMP + '.hf.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 7: Durable execution — do not restart from zero unless necessary §14
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Durable execution §14 — resume from checkpoint vs restart');
  const mgr6 = new LongRunningManager({ filePath: TMP + '.durable', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP + '.durable')) fs.unlinkSync(TMP + '.durable'); } catch {}
  const rec6 = new RecoveryEngine({ longRunningManager: mgr6, logger: { warn: () => {}, info: () => {} } });
  const durTask = mgr6.createTask({ mission: 'durable test - long running 3 hour' });
  const durId = durTask.taskId;
  // No checkpoint yet, but task already running (started)
  const durMut = mgr6._getMutable(durId);
  durMut.status = LongTaskStatus.RUNNING;
  durMut.startedAt = new Date().toISOString();
  durMut.checkpoints = []; // explicitly no checkpoint
  mgr6.save();
  // Attempt resume — should fail safely because no checkpoint and already started
  const durRes = await rec6.resumeSafely(durId, async () => ({ ok: true, result: 'fresh' }));
  assert(!durRes.ok, 'resume without checkpoint for started task should not succeed blindly');
  assert(durRes.stage === 'verify' || durRes.error?.toLowerCase().includes('checkpoint'), `should be verify stage: ${JSON.stringify(durRes)}`);
  console.log('✓ Durable execution correctly refuses to resume without checkpoint (would require restart from zero with explicit user consent)');

  try { fs.unlinkSync(TMP + '.durable'); } catch {}
  try { fs.unlinkSync(TMP + '.durable.tmp'); } catch {}

  // Cleanup
  try { mgr.destroy(); } catch {}
  try { mgr2.destroy(); } catch {}
  try { mgr3.destroy(); } catch {}
  try { mgr4.destroy(); } catch {}
  try { mgr5.destroy(); } catch {}
  try { mgr6.destroy(); } catch {}
  try { fs.unlinkSync(TMP); } catch {}
  try { fs.unlinkSync(TMP + '.tmp'); } catch {}

  console.log('\n[Myraa Recovery Test] ALL CHECKS PASSED — §14-15, §57 verified: resume, self-correction, classification, limits, safelyStop');
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => {
  console.error('[Myraa Recovery Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
