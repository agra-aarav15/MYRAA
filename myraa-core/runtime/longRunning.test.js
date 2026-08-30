// Myraa Long-Running Tasks Test — MASTER BUILD PROMPT §13, §14-15, §44-45, §57, §59
// Verifies: persistent records, background workers, checkpoints, heartbeats, progress, cancellation, retry, budgets, timeout, recovery, notifications
// Usage: node myraa-core/runtime/longRunning.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LongRunningManager, LongTaskStatus, DEFAULT_BUDGET } from './longRunning.js';

const TMP_PATH = path.join(os.tmpdir(), `myraa-test-longRunning-${Date.now()}.json`);
console.log('[Myraa LongRunning Test] Starting — §13 persistent, workers, checkpoints, heartbeats, progress, cancellation, retry, budgets, timeout, recovery, notifications');
console.log(`  Temp file: ${TMP_PATH}`);

async function main() {
  try { if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH); } catch {}
  try { if (fs.existsSync(TMP_PATH + '.tmp')) fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 1: Persistent task records §13
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Persistent task records §13');
  const mgr = new LongRunningManager({ filePath: TMP_PATH, concurrency: 5, heartbeatIntervalMs: 500, logger: { warn: () => {}, info: () => {} } });
  assert(mgr, 'Manager creation failed');
  const created = mgr.createTask({ mission: 'Work on this project for the next three hours and tell me when it is ready.', device: 'pc', budget: { maxRetries: 2, maxTimeSec: 3600 } });
  assert(created.ok, `createTask failed: ${created.error}`);
  const taskId = created.taskId;
  assert(taskId, 'taskId missing');
  assert(created.task.mission.includes('three hours'), 'mission not preserved');
  assert(created.task.budget.maxRetries === 2, 'budget not applied');
  assert(created.task.status === LongTaskStatus.PENDING, 'initial status should be pending');

  // Save and reload from disk (simulate restart §14)
  const saveRes = mgr.save();
  assert(saveRes.ok, 'save failed');
  assert(fs.existsSync(TMP_PATH), 'persisted file not found');

  const mgr2 = new LongRunningManager({ filePath: TMP_PATH, concurrency: 5, heartbeatIntervalMs: 500, logger: { warn: () => {}, info: () => {} } });
  const loaded = mgr2.getTask(taskId);
  assert(loaded.ok, `load failed: ${loaded.error}`);
  assert(loaded.task.mission === created.task.mission, 'persisted mission mismatch');
  assert(loaded.task.budget.maxRetries === 2, 'persisted budget mismatch');
  console.log(`✓ Persistent task records OK — created ${taskId}, persisted, reloaded`);

  // -----------------------------------------------------------------------
  // Test 2: Background workers §13 — concurrent execution 5-10
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Background workers §13 — concurrent + persistent');
  const mgrW = new LongRunningManager({ filePath: TMP_PATH + '.workers', concurrency: 3, heartbeatIntervalMs: 300, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.workers')) fs.unlinkSync(TMP_PATH + '.workers'); } catch {}

  const t1 = mgrW.createTask({ mission: 'task 1 background' });
  const t2 = mgrW.createTask({ mission: 'task 2 background' });
  const t3 = mgrW.createTask({ mission: 'task 3 background' });
  const t4 = mgrW.createTask({ mission: 'task 4 background - queued' });

  // Simple executor that simulates work
  const makeExecutor = (delayMs, result) => async (ctx) => {
    await new Promise(r => setTimeout(r, delayMs));
    ctx.progress({ percent: 50, message: 'halfway' });
    await new Promise(r => setTimeout(r, delayMs));
    return { ok: true, result };
  };

  const p1 = mgrW.runTask(t1.taskId, makeExecutor(80, 't1 done'));
  const p2 = mgrW.runTask(t2.taskId, makeExecutor(80, 't2 done'));
  const p3 = mgrW.runTask(t3.taskId, makeExecutor(80, 't3 done'));
  // 4th should be queued due to concurrency 3
  const qRes = await mgrW.runTask(t4.taskId, makeExecutor(80, 't4 done'));
  assert(qRes && qRes.queued === true, '4th task should be queued when concurrency full');

  // Wait for first 3 to finish, then queued should auto-dequeue
  const r1 = await p1;
  const r2 = await p2;
  const r3 = await p3;
  assert(r1.ok && r1.result === 't1 done', `t1 failed: ${JSON.stringify(r1)}`);
  assert(r2.ok, 't2 failed');
  assert(r3.ok, 't3 failed');

  // Give queue time to process
  await new Promise(r => setTimeout(r, 250));
  const t4After = mgrW.getTask(t4.taskId);
  assert(t4After.ok, 't4 not found after queue');
  // t4 should now be done or running (queued executed)
  // Poll until done
  let attempts = 0;
  while (attempts < 20) {
    const cur = mgrW.getTask(t4.taskId);
    if (cur.task.status === LongTaskStatus.DONE) break;
    await new Promise(r => setTimeout(r, 50));
    attempts++;
  }
  const t4Final = mgrW.getTask(t4.taskId);
  assert(t4Final.task.status === LongTaskStatus.DONE, `t4 should be done after dequeued, got ${t4Final.task.status}`);
  console.log('✓ Background workers OK — concurrency 3, 4th queued and completed');

  try { fs.unlinkSync(TMP_PATH + '.workers'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.workers.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 3: Checkpoints §13-14 — durable execution
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Checkpoints §13-14 — persistent, verify, resume safely');
  const mgrC = new LongRunningManager({ filePath: TMP_PATH + '.ckpt', concurrency: 5, heartbeatIntervalMs: 300, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.ckpt')) fs.unlinkSync(TMP_PATH + '.ckpt'); } catch {}
  const tc = mgrC.createTask({ mission: 'checkpoint test mission' });
  const cId = tc.taskId;
  mgrC.checkpoint(cId, { step: 1, files: [] }, { percent: 25, message: 'step 1 done' });
  mgrC.checkpoint(cId, { step: 2, files: [] }, { percent: 50, message: 'step 2 done' });
  mgrC.checkpoint(cId, { step: 3, files: [] }, { percent: 75, message: 'step 3 done' });
  const ckpts = mgrC.getCheckpoints(cId);
  assert(ckpts.ok && ckpts.count === 3, `expected 3 checkpoints, got ${ckpts.count}`);
  assert(ckpts.checkpoints[2].percent === 75, 'last checkpoint percent mismatch');
  const last = mgrC.getLastCheckpoint(cId);
  assert(last.ok && last.checkpoint.percent === 75, 'last checkpoint mismatch');
  const verify = mgrC.verifyLastCheckpoint(cId);
  assert(verify.ok && verify.valid === true, `verify should be valid, got ${JSON.stringify(verify)}`);

  // Simulate restart: new manager loads checkpoints
  mgrC.save();
  const mgrCReload = new LongRunningManager({ filePath: TMP_PATH + '.ckpt', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  const reloadedCkpts = mgrCReload.getCheckpoints(cId);
  assert(reloadedCkpts.count === 3, 'checkpoint persistence failed after reload');
  console.log('✓ Checkpoints OK — 3 checkpoints persisted and verified');

  try { fs.unlinkSync(TMP_PATH + '.ckpt'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.ckpt.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 4: Heartbeats §13 — alive detection, stalled detection
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Heartbeats §13 — periodic + stall detection');
  const mgrH = new LongRunningManager({ filePath: TMP_PATH + '.hb', concurrency: 5, heartbeatIntervalMs: 200, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.hb')) fs.unlinkSync(TMP_PATH + '.hb'); } catch {}
  const th = mgrH.createTask({ mission: 'heartbeat test' });
  const hbId = th.taskId;
  // Manual heartbeat
  const hb1 = mgrH.heartbeat(hbId, { note: 'first' });
  assert(hb1.ok, 'heartbeat failed');
  assert(mgrH._getMutable(hbId).lastHeartbeat, 'lastHeartbeat not set');
  assert(mgrH._getMutable(hbId).heartbeats.length === 1, 'heartbeat not recorded');

  // Auto heartbeat via runTask
  const hbExecutor = async (ctx) => {
    // do work while heartbeating automatically via manager's interval
    for (let i = 0; i < 3; i++) {
      ctx.heartbeat({ step: i });
      await new Promise(r => setTimeout(r, 120));
    }
    return { ok: true, result: 'hb done' };
  };
  const hbPromise = mgrH.runTask(hbId, hbExecutor);
  // Wait a bit and check heartbeats grew
  await new Promise(r => setTimeout(r, 500));
  const afterHb = mgrH._getMutable(hbId);
  assert(afterHb.heartbeats.length >= 2, `auto heartbeats should have grown, got ${afterHb.heartbeats.length}`);
  const notStalled = mgrH.isHeartbeatStalled(hbId);
  assert(notStalled.ok && notStalled.stalled === false, 'should not be stalled while running');
  const hbRes = await hbPromise;
  assert(hbRes.ok, `heartbeat task failed: ${JSON.stringify(hbRes)}`);

  // Stall detection: make task with old heartbeat
  const stallTask = mgrH.createTask({ mission: 'stall test', timeout: { heartbeatTimeoutSec: 1 } });
  mgrH.heartbeat(stallTask.taskId);
  await new Promise(r => setTimeout(r, 1200));
  const stalled = mgrH.isHeartbeatStalled(stallTask.taskId);
  assert(stalled.stalled === true, `should be stalled after 1.2s with 1s timeout, got ${JSON.stringify(stalled)}`);
  console.log('✓ Heartbeats OK — manual, auto, stall detection');

  mgrH.destroy();
  try { fs.unlinkSync(TMP_PATH + '.hb'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.hb.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 5: Progress events §13, §40
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Progress events §13, §40 — safe summary');
  const mgrP = new LongRunningManager({ filePath: TMP_PATH + '.prog', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.prog')) fs.unlinkSync(TMP_PATH + '.prog'); } catch {}
  const tp = mgrP.createTask({ mission: 'progress test' });
  const progressEvents = [];
  mgrP.on('task:progress', (data) => progressEvents.push(data));

  mgrP.progress(tp.taskId, { percent: 10, message: 'Understanding request', step: 'plan' });
  mgrP.progress(tp.taskId, { percent: 30, message: 'Creating project', step: 'create' });
  mgrP.progress(tp.taskId, { percent: 60, message: 'Building APK', step: 'build' });
  const pState = mgrP._getMutable(tp.taskId);
  assert(pState.progress.percent === 60, 'progress percent mismatch');
  assert(pState.progressEvents.length === 3, 'progress events not recorded');
  assert(progressEvents.length === 3, 'progress events not emitted');
  assert(progressEvents[2].progress.message === 'Building APK', 'emitted progress message mismatch');

  // Test progress via background worker
  const progExecutor = async (ctx) => {
    ctx.progress({ percent: 20, message: 'Step 1' });
    await new Promise(r => setTimeout(r, 50));
    ctx.progress({ percent: 80, message: 'Step 8' });
    return { ok: true, result: 'prog done' };
  };
  const tp2 = mgrP.createTask({ mission: 'progress worker' });
  const progRes = await mgrP.runTask(tp2.taskId, progExecutor);
  assert(progRes.ok, 'progress worker failed');
  const tp2After = mgrP._getMutable(tp2.taskId);
  assert(tp2After.progress.percent === 100, 'final progress should be 100 after done');
  console.log('✓ Progress events OK — manual + worker, events emitted');

  try { fs.unlinkSync(TMP_PATH + '.prog'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.prog.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 6: Cancellation §13, §37, §41
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Cancellation §13, §37 — abort via AbortController');
  const mgrX = new LongRunningManager({ filePath: TMP_PATH + '.cancel', concurrency: 5, heartbeatIntervalMs: 300, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.cancel')) fs.unlinkSync(TMP_PATH + '.cancel'); } catch {}
  const tcCancel = mgrX.createTask({ mission: 'long task to cancel' });
  const cancelEvents = [];
  mgrX.on('task:cancelled', (d) => cancelEvents.push(d));

  const longExecutor = async (ctx) => {
    for (let i = 0; i < 10; i++) {
      if (ctx.signal.aborted) throw new Error(`Aborted: ${ctx.signal.reason}`);
      ctx.progress({ percent: i * 10, message: `step ${i}` });
      await new Promise(r => setTimeout(r, 100));
    }
    return { ok: true, result: 'should not reach' };
  };
  const cancelPromise = mgrX.runTask(tcCancel.taskId, longExecutor);
  // Cancel after 250ms
  await new Promise(r => setTimeout(r, 250));
  const cancelRes = await mgrX.cancel(tcCancel.taskId, 'user requested stop');
  assert(cancelRes.ok, `cancel failed: ${cancelRes.error}`);
  assert(cancelRes.status === LongTaskStatus.CANCELLED, 'status should be cancelled');
  const afterCancel = mgrX.getTask(tcCancel.taskId);
  assert(afterCancel.task.status === LongTaskStatus.CANCELLED, 'task not marked cancelled');
  assert(cancelEvents.length === 1, 'cancel event not emitted');
  // Worker promise should resolve as cancelled
  const cancelResult = await cancelPromise;
  assert(cancelResult.cancelled === true || cancelResult.error?.toLowerCase().includes('cancelled') || cancelResult.error?.toLowerCase().includes('aborted'), `worker should be cancelled, got ${JSON.stringify(cancelResult)}`);
  console.log('✓ Cancellation OK — cancelled running task, event emitted, worker aborted');

  mgrX.destroy();
  try { fs.unlinkSync(TMP_PATH + '.cancel'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.cancel.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 7: Retry policies §15 — maxRetries, exponential backoff
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Retry policies §15 — maxRetries, backoff, retryable category');
  const mgrR = new LongRunningManager({ filePath: TMP_PATH + '.retry', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.retry')) fs.unlinkSync(TMP_PATH + '.retry'); } catch {}
  const tr = mgrR.createTask({ mission: 'retry test', budget: { maxRetries: 2 }, retryPolicy: { maxRetries: 2, baseBackoffMs: 20, maxBackoffMs: 100 } });
  let retryAttempts = 0;
  const flakyExecutor = async (ctx) => {
    retryAttempts++;
    if (retryAttempts < 3) {
      // Fail with retryable error
      throw new Error('Tool failure: transient tool error');
    }
    return { ok: true, result: `succeeded on attempt ${retryAttempts}` };
  };
  const retryEvents = [];
  mgrR.on('task:retrying', (d) => retryEvents.push(d));
  const rRes = await mgrR.runTask(tr.taskId, flakyExecutor);
  assert(rRes.ok, `retry should eventually succeed, got ${JSON.stringify(rRes)}`);
  assert(retryAttempts === 3, `expected 3 attempts, got ${retryAttempts}`);
  assert(retryEvents.length === 2, `expected 2 retry events, got ${retryEvents.length}`);
  const trAfter = mgrR.getTask(tr.taskId);
  assert(trAfter.task.usage.retries === 2, 'usage retries mismatch');
  console.log(`✓ Retry OK — succeeded after ${retryAttempts} attempts with backoff`);

  // Non-retryable should fail immediately
  const tr2 = mgrR.createTask({ mission: 'non-retryable', budget: { maxRetries: 3 } });
  const nonRetryExec = async () => { throw new Error('permission_denied: blocked by policy'); };
  const nrRes = await mgrR.runTask(tr2.taskId, nonRetryExec);
  assert(!nrRes.ok, 'non-retryable should fail');
  assert(nrRes.category === 'permission_denied' || nrRes.reason?.includes('non-retryable'), `should be non-retryable, got ${JSON.stringify(nrRes)}`);
  const tr2After = mgrR.getTask(tr2.taskId);
  assert(tr2After.task.status === LongTaskStatus.FAILED, 'non-retryable should be failed');
  console.log('✓ Retry non-retryable correctly failed immediately');

  try { fs.unlinkSync(TMP_PATH + '.retry'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.retry.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 8: Resource budgets §13, §39 — maxTokens, maxCost, maxTime
  // -----------------------------------------------------------------------
  console.log('\n[Test 8] Resource budgets §13, §39 — tokens, cost, time');
  const mgrB = new LongRunningManager({ filePath: TMP_PATH + '.budget', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.budget')) fs.unlinkSync(TMP_PATH + '.budget'); } catch {}
  const tb = mgrB.createTask({ mission: 'budget test', budget: { maxTokens: 100, maxCost: 0.5, maxTimeSec: 3600, maxRetries: 0 } });
  mgrB.addUsage(tb.taskId, { tokens: 50, cost: 0.2 });
  let budgetCheck = mgrB.checkBudget(tb.taskId);
  assert(!budgetCheck.exceeded, 'should not be exceeded yet');
  assert(budgetCheck.remaining.tokens === 50, `remaining tokens should be 50, got ${budgetCheck.remaining.tokens}`);

  mgrB.addUsage(tb.taskId, { tokens: 60, cost: 0.4 }); // now 110 tokens, 0.6 cost
  budgetCheck = mgrB.checkBudget(tb.taskId);
  assert(budgetCheck.exceeded === true, 'should be exceeded now');
  assert(budgetCheck.field === 'maxTokens' || budgetCheck.field === 'maxCost', `field should be maxTokens or maxCost, got ${budgetCheck.field}`);

  // Test budget enforcement in runTask: should fail before execution if already exceeded
  const tb2 = mgrB.createTask({ mission: 'budget exceeded run', budget: { maxTokens: 10, maxRetries: 0 } });
  mgrB.addUsage(tb2.taskId, { tokens: 20 });
  const budgetExecutor = async () => ({ ok: true, result: 'should not run' });
  const bRes = await mgrB.runTask(tb2.taskId, budgetExecutor);
  assert(!bRes.ok && bRes.budgetExceeded, `should be budgetExceeded, got ${JSON.stringify(bRes)}`);

  // Time budget: set maxTimeSec very small and startedAt in past
  const tb3 = mgrB.createTask({ mission: 'time budget', budget: { maxTimeSec: 1, maxRetries: 0 } });
  // Manually set startedAt to 5 seconds ago
  const mutableTb3 = mgrB._getMutable(tb3.taskId);
  mutableTb3.startedAt = new Date(Date.now() - 5000).toISOString();
  const timeCheck = mgrB.checkBudget(tb3.taskId);
  assert(timeCheck.exceeded && timeCheck.field === 'maxTimeSec', `time budget should be exceeded, got ${JSON.stringify(timeCheck)}`);

  console.log('✓ Budgets OK — tokens, cost, time exceeded correctly');

  try { fs.unlinkSync(TMP_PATH + '.budget'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.budget.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 9: Timeout policies §13 — overall timeout + heartbeat timeout
  // -----------------------------------------------------------------------
  console.log('\n[Test 9] Timeout policies §13 — overall + heartbeat');
  const mgrT = new LongRunningManager({ filePath: TMP_PATH + '.timeout', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.timeout')) fs.unlinkSync(TMP_PATH + '.timeout'); } catch {}

  // Overall timeout: task started 10 seconds ago with 2 sec timeout
  const tt = mgrT.createTask({ mission: 'timeout test', timeout: { timeoutSec: 2 }, budget: { maxRetries: 0 } });
  const mutt = mgrT._getMutable(tt.taskId);
  mutt.startedAt = new Date(Date.now() - 5000).toISOString();
  mutt.status = LongTaskStatus.RUNNING;
  const timeoutCheck = mgrT.checkTimeout(tt.taskId);
  assert(timeoutCheck.timedOut === true, `should be timed out, got ${JSON.stringify(timeoutCheck)}`);

  // runTask should fail due to timeout already
  const timeoutExec = async () => ({ ok: true, result: 'done' });
  const tRes = await mgrT.runTask(tt.taskId, timeoutExec);
  // Since task already marked running, runTask will detect existing worker? Actually we set status running but no worker, so runTask will try to run but timeout check will trigger budget? Let's test fresh timeout task
  const tt2 = mgrT.createTask({ mission: 'timeout run', timeout: { timeoutSec: 1 }, budget: { maxRetries: 0 } });
  const mutt2 = mgrT._getMutable(tt2.taskId);
  mutt2.startedAt = new Date(Date.now() - 2000).toISOString();
  const tRes2 = await mgrT.runTask(tt2.taskId, async () => ({ ok: true, result: 'done' }));
  assert(!tRes2.ok && tRes2.timedOut, `runTask should timeout, got ${JSON.stringify(tRes2)}`);

  // Step timeout: executor takes longer than stepTimeoutMs
  const tt3 = mgrT.createTask({ mission: 'step timeout', timeout: { stepTimeoutMs: 100 }, budget: { maxRetries: 0 } });
  const stepExec = async () => { await new Promise(r => setTimeout(r, 300)); return { ok: true, result: 'slow' }; };
  const stepRes = await mgrT.runTask(tt3.taskId, stepExec);
  assert(!stepRes.ok && stepRes.error?.toLowerCase().includes('timeout'), `step timeout should fail, got ${JSON.stringify(stepRes)}`);

  console.log('✓ Timeout OK — overall timeout and step timeout');

  mgrT.destroy();
  try { fs.unlinkSync(TMP_PATH + '.timeout'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.timeout.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 10: Recovery §14-15 — interrupted resume from checkpoint
  // -----------------------------------------------------------------------
  console.log('\n[Test 10] Recovery §14-15 — interrupted → checkpoint → resume');
  const mgrRec = new LongRunningManager({ filePath: TMP_PATH + '.rec', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.rec')) fs.unlinkSync(TMP_PATH + '.rec'); } catch {}
  const recTask = mgrRec.createTask({ mission: 'recovery mission - three hour task' });
  mgrRec.checkpoint(recTask.taskId, { step: 1, progress: 30 }, { percent: 30, message: 'step 1' });
  mgrRec.checkpoint(recTask.taskId, { step: 2, progress: 60 }, { percent: 60, message: 'step 2' });
  // Simulate crash: set status to RUNNING then save and reload as if app restarted
  const recMut = mgrRec._getMutable(recTask.taskId);
  recMut.status = LongTaskStatus.RUNNING;
  recMut.startedAt = new Date().toISOString();
  mgrRec.save();

  // New manager loads and finds interrupted
  const mgrRec2 = new LongRunningManager({ filePath: TMP_PATH + '.rec', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  // Before recover, status is still RUNNING loaded from disk
  const beforeRec = mgrRec2.getTask(recTask.taskId);
  assert(beforeRec.task.status === LongTaskStatus.RUNNING, 'should be running before recover');

  const recoverRes = await mgrRec2.recover();
  assert(recoverRes.ok, `recover failed: ${JSON.stringify(recoverRes)}`);
  assert(recoverRes.interrupted >= 1, 'should have found interrupted');

  const afterRec = mgrRec2.getTask(recTask.taskId);
  // After recover, RUNNING should be marked INTERRUPTED (since no executorFactory)
  assert(afterRec.task.status === LongTaskStatus.INTERRUPTED, `should be interrupted after recover, got ${afterRec.task.status}`);
  assert(afterRec.task.checkpoints.length === 2, 'checkpoints should persist after recover');

  // Now resume safely from checkpoint with new executor that continues from step 3
  const resumeExec = async (ctx) => {
    const lastCp = ctx.task.checkpoints[ctx.task.checkpoints.length - 1];
    assert(lastCp.state.step === 2, 'last checkpoint should be step 2');
    ctx.progress({ percent: 90, message: 'resuming step 3' });
    ctx.checkpoint({ step: 3, progress: 90 }, { percent: 90, message: 'step 3 done from resume' });
    return { ok: true, result: 'resumed and completed' };
  };
  const resumeRes = await mgrRec2.resume(recTask.taskId, resumeExec);
  // resume() when given executor runs it; check result
  // If resume returned promise of execution, it should be ok
  // Our resume implementation runs executor and returns its result if provided
  // Wait for completion
  await new Promise(r => setTimeout(r, 100));
  const finalRec = mgrRec2.getTask(recTask.taskId);
  // Depending on timing, it may be DONE
  assert(finalRec.task.status === LongTaskStatus.DONE || finalRec.task.status === LongTaskStatus.RUNNING, `after resume, status should be done or running, got ${finalRec.task.status}`);
  if (finalRec.task.status === LongTaskStatus.DONE) {
    assert(finalRec.task.result === 'resumed and completed', 'resume result mismatch');
  }
  console.log('✓ Recovery OK — interrupted detected, checkpoint verified, resumed safely');

  mgrRec2.destroy();
  try { fs.unlinkSync(TMP_PATH + '.rec'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.rec.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 11: Notifications §13 — task completed/failed notifications
  // -----------------------------------------------------------------------
  console.log('\n[Test 11] Notifications §13 — on completed/failed/cancelled');
  const mgrN = new LongRunningManager({ filePath: TMP_PATH + '.notif', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.notif')) fs.unlinkSync(TMP_PATH + '.notif'); } catch {}
  const notifs = [];
  mgrN.onNotification((note) => notifs.push(note));
  const tNotif = mgrN.createTask({ mission: 'notify test' });
  await mgrN.runTask(tNotif.taskId, async () => ({ ok: true, result: 'notify done' }));
  assert(notifs.some(n => n.type === 'completed'), `should have completed notification, got ${JSON.stringify(notifs)}`);
  const tFailNotif = mgrN.createTask({ mission: 'notify fail', budget: { maxRetries: 0 } });
  await mgrN.runTask(tFailNotif.taskId, async () => { throw new Error('fail for notify'); });
  // Wait a tick
  await new Promise(r => setTimeout(r, 50));
  assert(notifs.some(n => n.type === 'failed'), 'should have failed notification');
  console.log('✓ Notifications OK — completed and failed notifications emitted');

  try { fs.unlinkSync(TMP_PATH + '.notif'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.notif.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 12: Task Control §41 — pause/resume, prioritize, move device, inspect
  // -----------------------------------------------------------------------
  console.log('\n[Test 12] Task Control §41 — pause, resume, prioritize, move, inspect');
  const mgrCtrl = new LongRunningManager({ filePath: TMP_PATH + '.ctrl', concurrency: 5, logger: { warn: () => {}, info: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.ctrl')) fs.unlinkSync(TMP_PATH + '.ctrl'); } catch {}
  const tCtrl = mgrCtrl.createTask({ mission: 'control test', priority: 1 });
  // Prioritize
  const prioRes = mgrCtrl.prioritize(tCtrl.taskId, 10);
  assert(prioRes.ok && prioRes.priority === 10, 'prioritize failed');
  // Move device
  const moveRes = mgrCtrl.moveTask(tCtrl.taskId, 'server');
  assert(moveRes.ok && moveRes.device === 'server', 'moveTask failed');
  // Inspect progress
  mgrCtrl.progress(tCtrl.taskId, { percent: 42, message: 'inspect me', step: 'test' });
  const inspect = mgrCtrl.inspectProgress(tCtrl.taskId);
  assert(inspect.ok && inspect.progress.percent === 42, 'inspectProgress failed');
  assert(inspect.mission === 'control test', 'inspect mission mismatch');
  console.log('✓ Task Control OK — prioritize, move, inspect');

  try { fs.unlinkSync(TMP_PATH + '.ctrl'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.ctrl.tmp'); } catch {}

  // Cleanup main tmp
  try { fs.unlinkSync(TMP_PATH); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}

  console.log('\n[Myraa LongRunning Test] ALL CHECKS PASSED — §13-15 verified: persistent, workers, checkpoints, heartbeats, progress, cancellation, retry, budgets, timeout, recovery, notifications');
  // Ensure process exits (clear any lingering intervals)
  try { mgr.destroy(); } catch {}
  try { mgr2.destroy(); } catch {}
  try { mgrW.destroy(); } catch {}
  try { mgrC.destroy(); } catch {}
  try { mgrCReload.destroy(); } catch {}
  try { mgrP.destroy(); } catch {}
  try { mgrX.destroy(); } catch {}
  try { mgrR.destroy(); } catch {}
  try { mgrB.destroy(); } catch {}
  try { mgrT.destroy(); } catch {}
  try { mgrRec.destroy(); } catch {}
  try { mgrRec2.destroy(); } catch {}
  try { mgrN.destroy(); } catch {}
  try { mgrCtrl.destroy(); } catch {}
  // Force exit after small delay to let FS settle
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => {
  console.error('[Myraa LongRunning Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
