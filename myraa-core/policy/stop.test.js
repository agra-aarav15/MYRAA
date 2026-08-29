// Myraa Emergency STOP Test — MASTER BUILD PROMPT §37
// Verifies: cancel agents, queued tasks, computer-control, terminate tools, prevent new autonomous actions, preserve state, independent.
// Run: node myraa-core/policy/stop.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StopController } from './stop.js';

const TMP_STOP = path.join(os.tmpdir(), `myraa-test-stop-${Date.now()}.json`);
console.log('[Myraa Emergency STOP Test] Starting — §37 verification');
console.log(`  Temp stop state file: ${TMP_STOP}`);

async function main() {
  // Cleanup
  try { if (fs.existsSync(TMP_STOP)) fs.unlinkSync(TMP_STOP); } catch {}
  try { if (fs.existsSync(TMP_STOP + '.tmp')) fs.unlinkSync(TMP_STOP + '.tmp'); } catch {}

  const stop = new StopController({ stateFile: TMP_STOP });

  // -----------------------------------------------------------------------
  // Test 0: Initial state — not stopped, independent
  // -----------------------------------------------------------------------
  console.log('\n[Test 0] Initial state — not stopped, independent of normal logic');
  assert(stop.isStopped() === false, 'should not be stopped initially');
  assert(stop.canProceed() === true, 'should be able to proceed initially');
  assert(stop.getState().stopped === false, 'getState stopped should be false');
  console.log('✓ Initial state OK — independent, not stopped');

  // -----------------------------------------------------------------------
  // Test 1: Cancel active agents §37
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Cancel active agents — agents must be cancelled independently');
  let agent1Cancelled = false;
  let agent2Aborted = false;
  const agent1 = { id: 'agent-1', type: 'CodingAgent', taskId: 'task-1', cancel: (reason) => { agent1Cancelled = true; assert(reason, 'reason should be provided to cancel'); } };
  const agent2 = { id: 'agent-2', type: 'BrowserAgent', abort: (reason) => { agent2Aborted = true; } };
  const agent3 = { id: 'agent-3', type: 'ResearchAgent' }; // no cancel method — still counted via preserve

  stop.registerAgent(agent1);
  stop.registerAgent(agent2);
  stop.registerAgent(agent3);
  assert(stop.getActiveAgents().length === 3, 'should have 3 active agents');

  // -----------------------------------------------------------------------
  // Test 2: Cancel queued tasks when possible
  // -----------------------------------------------------------------------
  console.log('[Test 2] Queued tasks — should be cancelled on STOP');
  stop.registerQueuedTask({ id: 'task-q-1', mission: 'Build project', status: 'queued', device: 'pc' });
  stop.registerQueuedTask({ id: 'task-q-2', mission: 'Research topic', status: 'queued', device: 'server' });
  stop.registerQueuedTask({ id: 'task-q-3', mission: 'Long running task' });
  assert(stop.getQueuedTasks().length === 3, 'should have 3 queued tasks');
  console.log(`  queuedTasks before stop: ${stop.getQueuedTasks().length}`);

  // -----------------------------------------------------------------------
  // Test 3: Computer-control activity §37
  // -----------------------------------------------------------------------
  console.log('[Test 3] Computer-control — should be stopped');
  stop.setComputerControlActive(true, { id: 'cc-1', tool: 'mouseClick' });
  stop.registerComputerControlSession({ id: 'cc-2', tool: 'takeScreenshot' });
  assert(stop.getState().computerControlActive === true, 'computerControl should be active');
  console.log(`  computerControlActive before stop: ${stop.getState().computerControlActive}`);

  // -----------------------------------------------------------------------
  // Test 4: Terminate unsafe tool execution
  // -----------------------------------------------------------------------
  console.log('[Test 4] Tool executions — should be terminated via AbortController');
  const ctrl1 = new AbortController();
  const ctrl2 = new AbortController();
  let ctrl1Aborted = false;
  ctrl1.signal.addEventListener('abort', () => { ctrl1Aborted = true; });
  let ctrl2Aborted = false;
  ctrl2.signal.addEventListener('abort', () => { ctrl2Aborted = true; });

  stop.registerToolExecution('tool-1', ctrl1);
  stop.registerToolExecution('tool-2', ctrl2);
  stop.registerToolExecution('tool-3', new AbortController());
  assert(stop.getToolExecutions().length === 3, 'should have 3 tool executions');
  console.log(`  toolExecutions before stop: ${stop.getToolExecutions().length}`);

  // -----------------------------------------------------------------------
  // Test 5: Emergency STOP — all actions together §37
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Emergency STOP — cancel agents, queued tasks, computer-control, terminate tools, prevent new actions, preserve state');
  const stopRes = stop.emergencyStop({ reason: 'test emergency', initiator: 'test' });
  assert(stopRes.ok && stopRes.stopped === true, 'emergencyStop should succeed');
  assert(stopRes.summary, 'summary missing');
  assert(stopRes.summary.actions.agentsCancelled >= 2, `agentsCancelled should be >=2, got ${stopRes.summary.actions.agentsCancelled}`);
  assert(stopRes.summary.actions.queuedTasksCancelled === 3, `queuedTasksCancelled should be 3, got ${stopRes.summary.actions.queuedTasksCancelled}`);
  assert(stopRes.summary.actions.computerControlStopped === true, 'computerControlStopped should be true');
  assert(stopRes.summary.actions.toolExecutionsTerminated === 3, `toolExecutionsTerminated should be 3, got ${stopRes.summary.actions.toolExecutionsTerminated}`);
  assert(stopRes.summary.actions.newActionsBlocked === true, 'newActionsBlocked should be true');
  assert(stopRes.summary.actions.statePreserved === true, 'statePreserved should be true');

  // Verify individual cancellations were invoked
  assert(agent1Cancelled === true, 'agent1 cancel not called');
  assert(agent2Aborted === true, 'agent2 abort not called');
  assert(ctrl1Aborted === true, 'ctrl1 not aborted');
  assert(ctrl2Aborted === true, 'ctrl2 not aborted');

  // Verify state after stop
  assert(stop.isStopped() === true, 'isStopped should be true after stop');
  assert(stop.canProceed() === false, 'canProceed should be false after stop');
  assert(stop.getState().stopped === true, 'getState stopped true');
  assert(stop.getState().blockNewActions === true, 'blockNewActions true');
  assert(stop.getQueuedTasks().length === 0, 'queued tasks should be cleared after stop');
  assert(stop.getState().computerControlActive === false, 'computerControl should be inactive after stop');

  // Verify assertNotStopped throws
  let threw = false;
  try { stop.assertNotStopped(); } catch (e) { threw = true; assert(e.message.includes('STOP active'), 'error should mention STOP active'); }
  assert(threw, 'assertNotStopped should throw when stopped');

  // Verify preserved state exists and contains required info
  const preserved = stop.getPreservedState();
  assert(preserved, 'preservedState should exist');
  assert(preserved.stopped === true, 'preserved stopped true');
  assert(preserved.reason === 'test emergency', 'preserved reason mismatch');
  assert(Array.isArray(preserved.activeAgents) && preserved.activeAgents.length === 3, `preserved activeAgents should be 3, got ${preserved.activeAgents.length}`);
  assert(Array.isArray(preserved.queuedTasks) && preserved.queuedTasks.length === 3, `preserved queuedTasks should be 3, got ${preserved.queuedTasks.length}`);
  assert(preserved.computerControl, 'preserved computerControl missing');

  // Verify file persisted
  assert(fs.existsSync(TMP_STOP), `stop state file should exist: ${TMP_STOP}`);
  const fileData = JSON.parse(fs.readFileSync(TMP_STOP, 'utf8'));
  assert(fileData.preservedState, 'file preservedState missing');
  assert(fileData.preservedState.reason === 'test emergency', 'file reason mismatch');
  assert(Array.isArray(fileData.history) && fileData.history.length >= 1, 'file history missing');
  console.log(`  emergencyStop summary: agents=${stopRes.summary.actions.agentsCancelled} queued=${stopRes.summary.actions.queuedTasksCancelled} tools=${stopRes.summary.actions.toolExecutionsTerminated} preserved=${stopRes.summary.actions.statePreserved}`);
  console.log('✓ Emergency STOP core actions OK');

  // -----------------------------------------------------------------------
  // Test 6: Prevent new autonomous actions §37
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Prevent new autonomous actions — block while stopped');
  assert(stop.isStopped() === true, 'still stopped');
  assert(stop.canProceed() === false, 'should not be able to proceed');
  // Try to register new agent while stopped — should still be allowed to register but canProceed false indicates new actions blocked?
  // Our implementation allows registration but logical gate via isStopped should block execution.
  // Verify that new stopController check would block new tool calls
  let newAgentBlocked = false;
  try {
    stop.assertNotStopped();
  } catch {
    newAgentBlocked = true;
  }
  assert(newAgentBlocked, 'new agent should be blocked via assertNotStopped');

  // Verify that even after preserving, history tracks
  assert(stop.getHistory().length >= 1, 'history should have at least 1 entry');
  console.log('✓ Prevent new actions OK — blocked while STOP active');

  // -----------------------------------------------------------------------
  // Test 7: Independent of normal agent logic — STOP functions even if agents fail to cancel gracefully
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Independence — STOP must succeed even if agent cancellation throws');
  const stop2 = new StopController({ stateFile: TMP_STOP + '.2' });
  // Register agent whose cancel throws
  const faultyAgent = { id: 'faulty', cancel: () => { throw new Error('agent cancel explosion'); } };
  stop2.registerAgent(faultyAgent);
  stop2.registerQueuedTask({ id: 'q-faulty', mission: 'faulty task' });
  const ctrlFaulty = new AbortController();
  stop2.registerToolExecution('tool-faulty', ctrlFaulty);
  const res2 = stop2.emergencyStop({ reason: 'faulty test' });
  assert(res2.ok, 'emergencyStop should still succeed even if agent throws');
  assert(res2.summary.actions.agentsFailed >= 0, 'should track failed agents');
  assert(res2.summary.actions.queuedTasksCancelled === 1, 'queued task should still be cancelled');
  assert(res2.summary.actions.toolExecutionsTerminated === 1, 'tool should still be terminated');
  assert(fs.existsSync(TMP_STOP + '.2'), 'state should still be preserved even with faulty agent');
  console.log('✓ Independence OK — STOP succeeded despite agent failure, preserved state');

  // Cleanup stop2 files
  try { fs.unlinkSync(TMP_STOP + '.2'); } catch {}
  try { fs.unlinkSync(TMP_STOP + '.2.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 8: Reset — allow new actions again
  // -----------------------------------------------------------------------
  console.log('\n[Test 8] Reset — should allow new actions, preserve inspection state until cleared');
  assert(stop.isStopped() === true, 'should be stopped before reset');
  const resetRes = stop.reset({ initiator: 'test' });
  assert(resetRes.ok && resetRes.reset === true, 'reset should succeed');
  assert(stop.isStopped() === false, 'should not be stopped after reset');
  assert(stop.canProceed() === true, 'should be able to proceed after reset');
  // assertNotStopped should not throw after reset
  let stillThrows = false;
  try { stop.assertNotStopped(); } catch { stillThrows = true; }
  assert(!stillThrows, 'assertNotStopped should not throw after reset');

  // Preserved state should still exist after reset for inspection
  assert(stop.getPreservedState() !== null, 'preserved state should remain after reset for inspection');
  assert(fs.existsSync(TMP_STOP), 'preserved file should remain after reset');

  // New actions should be possible: register new agent and ensure not blocked
  const newAfterReset = stop.registerAgent({ id: 'after-reset', cancel: () => {} });
  assert(newAfterReset.ok, 'registration after reset should work');
  console.log('✓ Reset OK — new actions allowed, preserved state retained');

  // -----------------------------------------------------------------------
  // Test 9: Clear preserved state
  // -----------------------------------------------------------------------
  console.log('\n[Test 9] Clear preserved state for inspection lifecycle');
  const clearRes = stop.clearPreservedState();
  assert(clearRes.ok, 'clearPreservedState failed');
  assert(stop.getPreservedState() === null, 'preserved state should be null after clear');
  assert(!fs.existsSync(TMP_STOP) || (() => { try { const c = fs.readFileSync(TMP_STOP, 'utf8'); return false; } catch { return true; } })(), 'file should be removed after clear');
  console.log('✓ Clear preserved state OK');

  // Also test stop.trigger alias
  console.log('\n[Test 10] Alias methods — trigger, stop, cancelAll');
  stop.registerAgent({ id: 'alias-test', cancel: () => {} });
  const aliasRes = stop.trigger({ reason: 'alias test' });
  assert(aliasRes.ok && aliasRes.stopped, 'trigger alias should work');
  stop.reset();
  const alias2 = stop.stop({ reason: 'alias2' });
  assert(alias2.ok, 'stop alias should work');
  stop.reset();
  const alias3 = stop.cancelAll({ reason: 'alias3' });
  assert(alias3.ok, 'cancelAll alias should work');
  stop.reset();
  stop.clearPreservedState();
  console.log('✓ Alias methods OK');

  // Final cleanup
  try { fs.unlinkSync(TMP_STOP); } catch {}
  try { fs.unlinkSync(TMP_STOP + '.tmp'); } catch {}

  console.log('\n[Myraa Emergency STOP Test] ALL CHECKS PASSED — §37 verified: cancel agents, queued tasks, computer-control, terminate tools, prevent new actions, preserve state, independent.');
}

main().catch(e => {
  console.error('[Myraa Emergency STOP Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
