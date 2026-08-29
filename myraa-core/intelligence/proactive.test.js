// Myraa Proactive Behavior Test — MASTER BUILD PROMPT §30 + §34-36, §50, §52
// Verifies: detectors (build failed, disk, system, device, repeated), policy gating (§30 within policy),
// cooldown, notifications, task completion, improvement suggestions, persistence, monitoring loop.
// Usage: node myraa-core/intelligence/proactive.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProactiveEngine, ProactiveType, Severity, DEFAULT_THRESHOLDS } from './proactive.js';
import { PolicyEngine, Permission } from '../policy/engine.js';

const TMP_PATH = path.join(os.tmpdir(), `myraa-test-proactive-${Date.now()}.json`);
console.log('[Myraa Proactive Test] Starting — §30 Proactive Behavior (within policy)');
console.log(`  Temp file: ${TMP_PATH}`);
console.log(`  Thresholds: ${JSON.stringify(DEFAULT_THRESHOLDS).slice(0,120)}`);

async function main() {
  try { if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH); } catch {}
  try { if (fs.existsSync(TMP_PATH + '.tmp')) fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}

  // Mock policy engine: allow SAFE/NORMAL, block DANGEROUS without confirmed
  const policy = new PolicyEngine({ filePath: TMP_PATH + '.policy', autoLoad: false, logger: { warn: () => {} } });
  // Ensure policy file not interfering
  try { if (fs.existsSync(TMP_PATH + '.policy')) fs.unlinkSync(TMP_PATH + '.policy'); } catch {}

  // -----------------------------------------------------------------------
  // Test 1: Persistence & Config §52, §30 enabled
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Persistence & Config §52');
  const engine = new ProactiveEngine({
    filePath: TMP_PATH,
    policyEngine: policy,
    logger: { warn: () => {}, info: () => {} },
    autoLoad: false,
  });
  assert(engine, 'ProactiveEngine creation failed');
  const cfg = engine.getConfig();
  assert(cfg.enabled === true, 'should be enabled by default');
  assert(cfg.thresholds.diskLowGB === DEFAULT_THRESHOLDS.diskLowGB, 'threshold mismatch');
  assert(cfg.detectors.buildFailed === true, 'buildFailed detector should be enabled');

  // Update config
  const upd = engine.updateConfig({ thresholds: { diskLowGB: 10 }, detectors: { buildFailed: false } });
  assert(upd.ok && upd.config.thresholds.diskLowGB === 10, 'updateConfig threshold failed');
  assert(upd.config.detectors.buildFailed === false, 'detector disable failed');
  // Re-enable
  engine.updateConfig({ detectors: { buildFailed: true }, thresholds: { diskLowGB: 5 } });
  const saved = engine.save();
  assert(saved.ok, 'save failed');
  assert(fs.existsSync(TMP_PATH), 'persisted file not found');
  const engine2 = new ProactiveEngine({ filePath: TMP_PATH, policyEngine: policy, logger: { warn: () => {}, info: () => {} } });
  const loadedCfg = engine2.getConfig();
  assert(loadedCfg.thresholds.diskLowGB === 5, 'reloaded threshold mismatch');
  // reset for further tests
  engine2.clear();
  engine.clear();
  console.log('✓ Persistence & Config OK');

  // -----------------------------------------------------------------------
  // Test 2: Disk detection §30 Detect disk problems
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Disk detection — disk low / full §30');
  const engDisk = new ProactiveEngine({ filePath: TMP_PATH + '.disk', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.disk')) fs.unlinkSync(TMP_PATH + '.disk'); } catch {}

  // Disk low snapshot
  const snapLow = {
    disk: { freeGB: 3, totalGB: 100, drives: [{ drive: 'C:', freeGB: 3, totalGB: 100 }] },
    cpu: { usagePercent: 30, count: 8 },
    memory: { usedPercent: 40, freeGB: 10 },
    battery: { available: false },
  };
  const lowRes = await engDisk.evaluateSnapshot(snapLow);
  assert(lowRes.ok, 'evaluateSnapshot failed');
  // Should have detected disk_low (SAFE -> auto-notified, not requiring confirmation)
  const proposalsLow = engDisk.getProposals({ type: ProactiveType.DISK_LOW });
  assert(proposalsLow.total >= 1, `should have disk_low proposal, got ${proposalsLow.total} results=${JSON.stringify(lowRes.results).slice(0,300)}`);
  assert(engDisk.getProposals({ type: ProactiveType.DISK_FULL }).total === 0, 'should not be disk_full');

  // Disk full
  const snapFull = {
    disk: { freeGB: 0.5, totalGB: 100, drives: [{ drive: 'C:', freeGB: 0.5, totalGB: 100 }] },
    cpu: { usagePercent: 30 },
    memory: { usedPercent: 40 },
    battery: { available: false },
  };
  // Policy: disk_full is DANGEROUS -> should be needs_confirmation but still created
  const fullRes = await engDisk.evaluateSnapshot(snapFull);
  assert(fullRes.ok, 'full evaluate failed');
  const fullProps = engDisk.getProposals({ type: ProactiveType.DISK_FULL });
  assert(fullProps.total >= 1, `should have disk_full proposal, got ${fullProps.total}`);
  const fullProposal = fullProps.results[0];
  assert(fullProposal.tier === Permission.DANGEROUS || fullProposal.tier === 'DANGEROUS', `disk_full should be DANGEROUS tier, got ${fullProposal.tier}`);
  assert(fullProposal.requiresConfirmation === true, 'disk_full should require confirmation');
  assert(fullProposal.status === 'needs_confirmation', `disk_full status should be needs_confirmation, got ${fullProposal.status}`);

  // Approve with confirmation should succeed
  const approveFull = await engDisk.approveProposal(fullProposal.id, { confirmed: true });
  assert(approveFull.ok, `approve disk_full with confirmed should succeed, got ${JSON.stringify(approveFull).slice(0,200)}`);
  assert(approveFull.proposal.status === 'approved', 'should be approved');

  engDisk.clear();
  try { fs.unlinkSync(TMP_PATH + '.disk'); } catch {}
  console.log('✓ Disk detection OK — low (SAFE auto-notified), full (DANGEROUS needs confirmation + approve)');

  // -----------------------------------------------------------------------
  // Test 3: Build failure detection §30 Detect failed builds
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Build failure detection §30');
  const engBuild = new ProactiveEngine({ filePath: TMP_PATH + '.build', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.build')) fs.unlinkSync(TMP_PATH + '.build'); } catch {}

  const buildPayload = { buildFailed: { message: 'gradle build failed: aapt2 error, failed to compile resources', category: 'build_failure' }, taskId: 'build-123' };
  const buildRes = await engBuild.handleBuildFailed(buildPayload);
  assert(buildRes.ok, `handleBuildFailed failed: ${JSON.stringify(buildRes)}`);
  assert(buildRes.proposal.type === ProactiveType.BUILD_FAILED, `type should be build_failed, got ${buildRes.proposal.type}`);
  // Build failed is DANGEROUS per our mapping — requires confirmation
  assert(buildRes.proposal.requiresConfirmation === true, 'build_failed should require confirmation (DANGEROUS)');

  // Try notify without confirmation should fail
  // The proposal is already created with needs_confirmation status, notify should gate
  const notifyWithoutConfirm = await engBuild.notify(buildRes.proposal.id);
  assert(!notifyWithoutConfirm.ok && notifyWithoutConfirm.needsConfirmation, 'notify without confirmation should fail for DANGEROUS');

  // Approve then notify
  const approveBuild = await engBuild.approveProposal(buildRes.proposal.id, { confirmed: true });
  assert(approveBuild.ok, `approve build should succeed with confirmed, got ${JSON.stringify(approveBuild).slice(0,200)}`);
  const notifyAfterApprove = await engBuild.notify(buildRes.proposal.id);
  assert(notifyAfterApprove.ok, `notify after approve should succeed`);

  // Direct evaluateSnapshot with build context via recent failures
  engBuild.trackFailure({ message: 'build failure: vite error', category: 'build_failure' });
  engBuild.trackFailure({ message: 'build failure: gradle fail', category: 'build_failure' });
  engBuild.trackFailure({ message: 'build failure: aapt2 fail', category: 'build_failure' });
  // Should have triggered repeated detection via trackFailure auto? Check proposals
  // For now ensure handleBuildFailed still gates via policy
  try { fs.unlinkSync(TMP_PATH + '.build'); } catch {}
  console.log('✓ Build failure detection OK — DANGEROUS gated, requires confirmation');

  // -----------------------------------------------------------------------
  // Test 4: System detectors — CPU high, memory, battery §44-45
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] System detectors — CPU/memory/battery §30 + §44');
  const engSys = new ProactiveEngine({ filePath: TMP_PATH + '.sys', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.sys')) fs.unlinkSync(TMP_PATH + '.sys'); } catch {}

  const snapHigh = {
    cpu: { usagePercent: 92, count: 8 },
    memory: { usedPercent: 90, freeGB: 1.2 },
    disk: { freeGB: 20, totalGB: 100, drives: [] },
    battery: { available: true, level: 15, charging: false },
  };
  // CPU high is first detector; it will create one proposal per evaluateSnapshot (detectors run sequential, each creates proposal if detected)
  // But our detectors each return single proposal type; evaluateSnapshot runs buildFailed, disk, system, device — system returns CPU_HIGH first found, not both memory and battery.
  // So test each separately after clearing cooldown.

  // CPU
  const cpuSnap = { cpu: { usagePercent: 92, count: 8 }, memory: { usedPercent: 40, freeGB: 10 }, disk: { freeGB: 20, drives: [] }, battery: { available: false } };
  await engSys.evaluateSnapshot(cpuSnap);
  const cpuProps = engSys.getProposals({ type: ProactiveType.CPU_HIGH });
  assert(cpuProps.total >= 1, `should detect cpu_high, got ${cpuProps.total}`);
  assert(cpuProps.results[0].severity === Severity.WARN || cpuProps.results[0].severity === Severity.CRITICAL, 'cpu severity');
  engSys.clear();

  // Battery low
  const batSnap = { cpu: { usagePercent: 30 }, memory: { usedPercent: 40, freeGB: 10 }, disk: { freeGB: 20, drives: [] }, battery: { available: true, level: 15, charging: false } };
  await engSys.evaluateSnapshot(batSnap);
  const batProps = engSys.getProposals({ type: ProactiveType.BATTERY_LOW });
  assert(batProps.total >= 1, `should detect battery_low, got ${batProps.total}`);
  assert(batProps.results[0].message.includes('15%'), 'battery message should contain level');
  engSys.clear();

  // Battery critical
  const batCriticalSnap = { cpu: { usagePercent: 30 }, memory: { usedPercent: 40 }, disk: { freeGB: 20, drives: [] }, battery: { available: true, level: 5, charging: false } };
  await engSys.evaluateSnapshot(batCriticalSnap);
  const batCrit = engSys.getProposals({ type: ProactiveType.BATTERY_CRITICAL });
  assert(batCrit.total >= 1, `should detect battery_critical, got ${batCrit.total}`);
  assert(batCrit.results[0].requiresConfirmation === true, 'battery_critical should require confirmation (DANGEROUS)');
  engSys.clear();

  // Memory high
  const memSnap = { cpu: { usagePercent: 30 }, memory: { usedPercent: 90, freeGB: 1.2 }, disk: { freeGB: 20, drives: [] }, battery: { available: false } };
  await engSys.evaluateSnapshot(memSnap);
  const memProps = engSys.getProposals({ type: ProactiveType.MEMORY_HIGH });
  // may be MEMORY_HIGH or MEMORY_PRESSURE depending on threshold
  const memTotal = memProps.total + engSys.getProposals({ type: ProactiveType.MEMORY_PRESSURE }).total;
  assert(memTotal >= 1, `should detect memory high/pressure, got ${memTotal}`);

  engSys.clear();
  try { fs.unlinkSync(TMP_PATH + '.sys'); } catch {}
  console.log('✓ System detectors OK — cpu_high, battery_low/critical, memory_high (tiers & gating)');

  // -----------------------------------------------------------------------
  // Test 5: Task completion & failure notifications §30 Notify when long tasks finish, Warn about failures
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Task completion/failure notifications §30');
  const engTask = new ProactiveEngine({ filePath: TMP_PATH + '.task', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.task')) fs.unlinkSync(TMP_PATH + '.task'); } catch {}

  const completed = await engTask.handleTaskCompleted('task-abc', { result: 'Build APK done', mission: 'Build standalone APK' }, { mission: 'Build standalone APK' });
  assert(completed.ok, `handleTaskCompleted failed: ${JSON.stringify(completed)}`);
  assert(completed.proposal.type === ProactiveType.TASK_COMPLETED, 'should be task_completed');
  assert(completed.proposal.status === 'notified', 'task_completed is SAFE and should auto-notify (status notified)');

  const failed = await engTask.handleTaskFailed('task-xyz', new Error('Tool failure: unknown tool'), { category: 'tool_failure' });
  assert(failed.ok, `handleTaskFailed failed: ${JSON.stringify(failed)}`);
  assert(failed.proposal.type === ProactiveType.TASK_FAILED, 'should be task_failed');
  // Check repeated detection: 3 failures in window should propose repeated_failure
  engTask.trackFailure({ message: 'api unavailable', category: 'api_unavailable' });
  engTask.trackFailure({ message: 'api unavailable again', category: 'api_unavailable' });
  engTask.trackFailure({ message: 'api unavailable third', category: 'api_unavailable' });
  // After 3, should have repeated_failure proposal (may be async, wait)
  await new Promise(r => setTimeout(r, 50));
  const repeated = engTask.getProposals({ type: ProactiveType.REPEATED_FAILURE });
  assert(repeated.total >= 1, `should detect repeated_failure after 3 same category, got ${repeated.total}`);

  engTask.clear();
  try { fs.unlinkSync(TMP_PATH + '.task'); } catch {}
  console.log('✓ Task notifications OK — completed auto-notified, failed + repeated detection');

  // -----------------------------------------------------------------------
  // Test 6: Policy gating §30 within policy, §34-36 tiers
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Policy gating — proactive must pass through engine §30 + §34');
  const engPolicy = new ProactiveEngine({ filePath: TMP_PATH + '.policy2', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.policy2')) fs.unlinkSync(TMP_PATH + '.policy2'); } catch {}

  // Make a DANGEROUS type proposal without confirmation — should be gated
  const dangerousProposal = await engPolicy.createProposal({
    type: ProactiveType.DISK_FULL,
    severity: Severity.CRITICAL,
    message: 'Test dangerous proposal for policy gate',
    context: { freeGB: 0.1 },
  });
  assert(dangerousProposal.ok, `dangerous create should still succeed but mark needs_confirmation, got ${JSON.stringify(dangerousProposal)}`);
  assert(dangerousProposal.proposal.requiresConfirmation === true, 'DANGEROUS should require confirmation');
  // Try notify without confirmed — should fail policy gate
  const gatedNotify = await engPolicy.notify(dangerousProposal.proposal.id);
  assert(!gatedNotify.ok && gatedNotify.needsConfirmation, 'notify DANGEROUS without confirmed should be gated');

  // Now with policy allowing dangerous via context.confirmed (simulated via approve)
  const approveDanger = await engPolicy.approveProposal(dangerousProposal.proposal.id, { confirmed: true });
  assert(approveDanger.ok, `approve with confirmed should pass gate, got ${JSON.stringify(approveDanger).slice(0,200)}`);
  // After approve, notify should succeed (already approved)
  const notifyAfter = await engPolicy.notify(dangerousProposal.proposal.id);
  assert(notifyAfter.ok, 'notify after approve should succeed');

  // Test custom policy rule: make disk_low DANGEROUS via policy override
  policy.setRule('tools', 'proactive:disk_low', 'DANGEROUS');
  const diskLowOverride = await engPolicy.createProposal({
    type: ProactiveType.DISK_LOW,
    message: 'disk low with overridden policy DANGEROUS',
    context: { freeGB: 4 },
  });
  assert(diskLowOverride.proposal.tier === 'DANGEROUS' || diskLowOverride.gated?.tier === 'DANGEROUS', `overridden disk_low should be DANGEROUS, got ${diskLowOverride.proposal.tier} gated=${JSON.stringify(diskLowOverride.gated).slice(0,100)}`);
  assert(diskLowOverride.proposal.requiresConfirmation === true, 'overridden should require confirmation');
  // Cleanup policy override
  policy.removeRule('tools', 'proactive:disk_low');
  engPolicy.clear();
  try { fs.unlinkSync(TMP_PATH + '.policy2'); } catch {}
  console.log('✓ Policy gating OK — DANGEROUS requires confirmation, custom per-tool override works');

  // -----------------------------------------------------------------------
  // Test 7: Improvement & automation suggestions §30 Suggest automations
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Improvement & automation suggestions §30');
  const engImprove = new ProactiveEngine({ filePath: TMP_PATH + '.improve', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.improve')) fs.unlinkSync(TMP_PATH + '.improve'); } catch {}

  const improve = await engImprove.suggestImprovement({ title: 'Cleanup suggestion', message: 'Consider cleaning gradle cache — saves 2GB', context: { savedGB: 2 }, severity: Severity.INFO });
  assert(improve.ok && improve.proposal.type === ProactiveType.IMPROVEMENT, 'improve should be improvement type');
  assert(improve.proposal.tier === 'NORMAL' || improve.proposal.tier === 'SAFE', `improve tier should be NORMAL/SAFE, got ${improve.proposal.tier}`);

  const autoSug = await engImprove.suggestAutomation({ description: 'Repeated workflow: build APK 5 times — suggest automation', steps: [{ tool: 'readFile' }, { tool: 'writeCodeFile' }], estimatedSavings: '15 min' });
  assert(autoSug.ok && autoSug.proposal.type === ProactiveType.AUTOMATION_SUGGESTION, 'should be automation_suggestion');
  assert(autoSug.proposal.status === 'notified' || autoSug.proposal.status === 'pending', `auto suggestion should be notified/pending, got ${autoSug.proposal.status}`);

  engImprove.clear();
  try { fs.unlinkSync(TMP_PATH + '.improve'); } catch {}
  console.log('✓ Improvement suggestions OK');

  // -----------------------------------------------------------------------
  // Test 8: Cooldown to avoid spam §10, §30
  // -----------------------------------------------------------------------
  console.log('\n[Test 8] Cooldown — avoid spam notifications §30');
  const engCooldown = new ProactiveEngine({ filePath: TMP_PATH + '.cooldown', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 60000 } });
  try { if (fs.existsSync(TMP_PATH + '.cooldown')) fs.unlinkSync(TMP_PATH + '.cooldown'); } catch {}
  const snapCooldown = { disk: { freeGB: 3, totalGB: 100, drives: [{ drive: 'C:', freeGB: 3, totalGB: 100 }] }, cpu: { usagePercent: 20 }, memory: { usedPercent: 40 }, battery: { available: false } };
  const first = await engCooldown.evaluateSnapshot(snapCooldown);
  assert(first.results.some(r => r.proposal), 'first should create proposal');
  const firstCount = engCooldown.getProposals().total;
  const second = await engCooldown.evaluateSnapshot(snapCooldown);
  // Second should be on cooldown — no new proposal
  const secondCount = engCooldown.getProposals().total;
  assert(secondCount === firstCount, `second evaluate should be on cooldown, counts ${firstCount} vs ${secondCount}, results=${JSON.stringify(second.results).slice(0,200)}`);
  // Clear cooldown and should allow again
  engCooldown.clearCooldown(ProactiveType.DISK_LOW);
  const third = await engCooldown.evaluateSnapshot(snapCooldown);
  const thirdCount = engCooldown.getProposals().total;
  assert(thirdCount === firstCount + 1, `after clearCooldown should create new proposal, got ${thirdCount} vs ${firstCount}`);

  engCooldown.clear();
  try { fs.unlinkSync(TMP_PATH + '.cooldown'); } catch {}
  console.log('✓ Cooldown OK — spam prevented, clearCooldown works');

  // -----------------------------------------------------------------------
  // Test 9: Monitoring loop §44 (§10 caching)
  // -----------------------------------------------------------------------
  console.log('\n[Test 9] Monitoring loop — poll + events §44');
  const mockMonitor = {
    getSystemSnapshot: () => ({
      ts: new Date().toISOString(),
      cpu: { usagePercent: 92, count: 8, model: 'Intel' },
      memory: { usedPercent: 40, freeGB: 10, totalGB: 16 },
      disk: { freeGB: 20, totalGB: 100, drives: [{ drive: 'C:', freeGB: 20, totalGB: 100 }] },
      battery: { available: false, level: null },
      network: { hasNetwork: true },
      app: { pid: process.pid },
    }),
  };
  const engLoop = new ProactiveEngine({ filePath: TMP_PATH + '.loop', policyEngine: policy, monitor: mockMonitor, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { pollIntervalMs: 200, cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.loop')) fs.unlinkSync(TMP_PATH + '.loop'); } catch {}
  const events = [];
  engLoop.on('proactive:detected', (d) => events.push(d));
  const startRes = engLoop.start(200);
  assert(startRes.ok, `start failed: ${startRes.error}`);
  assert(engLoop.isMonitoring() === true, 'should be monitoring');
  await new Promise(r => setTimeout(r, 500));
  assert(events.length >= 2, `should have at least 2 detections, got ${events.length}`);
  assert(events[0].proposal.type === ProactiveType.CPU_HIGH, `first should be cpu_high, got ${events[0].proposal.type}`);
  const stopRes = engLoop.stop();
  assert(stopRes.ok, 'stop failed');
  assert(engLoop.isMonitoring() === false, 'should not be monitoring after stop');
  const countAfter = events.length;
  await new Promise(r => setTimeout(r, 250));
  assert(events.length === countAfter, 'should not receive events after stop');

  engLoop.destroy();
  try { fs.unlinkSync(TMP_PATH + '.loop'); } catch {}
  console.log('✓ Monitoring loop OK — poll interval, events, stop');

  // -----------------------------------------------------------------------
  // Test 10: Notification handlers §30 Notify user when long tasks finish
  // -----------------------------------------------------------------------
  console.log('\n[Test 10] Notification handlers — long task finished §30');
  const engNotif = new ProactiveEngine({ filePath: TMP_PATH + '.notif', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.notif')) fs.unlinkSync(TMP_PATH + '.notif'); } catch {}
  const notifs = [];
  engNotif.onNotification((p) => notifs.push(p));
  await engNotif.handleTaskCompleted('task-notif-1', { result: 'All done' }, { mission: 'Build APK' });
  // handleTaskCompleted auto-notifies (SAFE), so handler should fire
  // give event loop tick
  await new Promise(r => setTimeout(r, 20));
  assert(notifs.length >= 1, `notification handler should receive, got ${notifs.length}`);
  assert(notifs[0].type === ProactiveType.TASK_COMPLETED, 'notif type should be task_completed');
  engNotif.offNotification(notifs[0] ? () => {} : () => {}); // just test off doesn't throw
  engNotif.clear();
  try { fs.unlinkSync(TMP_PATH + '.notif'); } catch {}
  console.log('✓ Notification handlers OK');

  // -----------------------------------------------------------------------
  // Test 11: Dismiss / approve lifecycle + verifyNoSecrets
  // -----------------------------------------------------------------------
  console.log('\n[Test 11] Dismiss/approve lifecycle + verifyNoSecrets');
  const engLife = new ProactiveEngine({ filePath: TMP_PATH + '.life', policyEngine: policy, logger: { warn: () => {}, info: () => {} }, autoLoad: false, config: { cooldownMs: 0 } });
  try { if (fs.existsSync(TMP_PATH + '.life')) fs.unlinkSync(TMP_PATH + '.life'); } catch {}
  const p1 = await engLife.createProposal({ type: ProactiveType.IMPROVEMENT, message: 'Test improve to dismiss' });
  assert(p1.ok, 'create p1 failed');
  const dismissRes = engLife.dismissProposal(p1.proposal.id, 'not useful');
  assert(dismissRes.ok && dismissRes.proposal.status === 'dismissed', 'dismiss failed');

  // Create with secret in context — should be redacted
  const secretProposal = await engLife.createProposal({
    type: ProactiveType.IMPROVEMENT,
    message: 'Test with sk-ant-api03-1234567890123456789012345678901234567890 secret apiKey=secret123',
    context: { token: 'my-secret-token-abc', apiKey: 'sk-12345678901234567890' },
  });
  assert(secretProposal.ok, 'secret proposal create failed');
  const fetched = engLife.getProposal(secretProposal.proposal.id);
  assert(fetched.ok, 'getProposal failed');
  assert(!JSON.stringify(fetched.proposal).includes('sk-123'), 'secret should be redacted in stored proposal');
  // verifyNoSecrets should pass (no raw secrets)
  const verify = engLife.verifyNoSecrets();
  assert(verify.ok, `verifyNoSecrets should pass, violations=${JSON.stringify(verify.violations)}`);

  // Stats
  const stats = engLife.getStats();
  assert(stats.proposals >= 2, 'stats proposals should be >=2');
  assert(stats.byType[ProactiveType.IMPROVEMENT] >= 1, 'byType improve count missing');
  console.log(`  Stats: proposals=${stats.proposals} byType=${JSON.stringify(stats.byType).slice(0,80)}`);

  engLife.destroy();
  try { fs.unlinkSync(TMP_PATH + '.life'); } catch {}
  console.log('✓ Lifecycle + secrets OK');

  // Cleanup
  try { fs.unlinkSync(TMP_PATH); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.policy'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.policy.tmp'); } catch {}
  try { engine.destroy(); } catch {}
  try { engine2.destroy(); } catch {}

  console.log('\n[Myraa Proactive Test] ALL CHECKS PASSED — §30 verified: build/disk/device/task notifications, improvement suggestions, policy gating, cooldown, loop');
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => {
  console.error('[Myraa Proactive Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
