// Myraa System Monitor Test — MASTER BUILD PROMPT §44, §45, §10
// Verifies: CPU, Memory, Disk, Battery, Processes, App State, Power Management (battery/charging, throttling, adaptation, sleep/wake, authorized power, scheduling)
// Usage: node myraa-core/system/monitor.test.js

import assert from 'node:assert/strict';
import { SystemMonitor } from './monitor.js';

console.log('[Myraa System Monitor Test] Starting — §44-45 System Monitoring + Power Management');
console.log(`  Platform: ${process.platform} Node ${process.version}`);

// Allow power actions dry-run
process.env.MYRAA_ALLOW_POWER_ACTIONS = '0';

async function main() {
  const monitor = new SystemMonitor({ intervalMs: 500, thresholds: { cpuHigh: 90, memHigh: 90, diskLowGB: 1, batteryLow: 20, batteryCritical: 10 }, logger: { warn: () => {}, info: () => {} } });

  // -----------------------------------------------------------------------
  // Test 1: CPU §44 — CPU usage, count, model
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] CPU §44 — usage, count, model');
  const cpu1 = monitor.getCpuUsage();
  assert(cpu1.count > 0, 'cpu count should be >0');
  assert(cpu1.model, 'cpu model missing');
  assert(cpu1.uptimeSec >= 0, 'uptime missing');
  console.log(`  CPU: ${cpu1.count} cores, model=${cpu1.model.slice(0,40)}, usage=${cpu1.usagePercent ?? 'null (first sample)'}`);
  // Wait a bit and get second sample for usagePercent
  await new Promise(r => setTimeout(r, 300));
  const cpu2 = monitor.getCpuUsage();
  if (cpu2.usagePercent !== null) {
    assert(typeof cpu2.usagePercent === 'number' && cpu2.usagePercent >= 0 && cpu2.usagePercent <= 100, `cpu usage should be 0-100, got ${cpu2.usagePercent}`);
    console.log(`  CPU usage second sample: ${cpu2.usagePercent}%`);
  } else {
    console.log('  CPU usage still null after second sample — acceptable on some platforms');
  }
  console.log('✓ CPU OK');

  // -----------------------------------------------------------------------
  // Test 2: Memory §44
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Memory §44 — total, free, usedPercent, process');
  const mem = monitor.getMemoryUsage();
  assert(mem.totalGB > 0, 'totalGB should be >0');
  assert(mem.freeGB >= 0, 'freeGB should be >=0');
  assert(mem.usedPercent >= 0 && mem.usedPercent <= 100, `usedPercent should be 0-100, got ${mem.usedPercent}`);
  assert(mem.process && mem.process.rssMB > 0, 'process rss missing');
  console.log(`  Memory: total=${mem.totalGB}GB free=${mem.freeGB}GB used=${mem.usedPercent}% rss=${mem.process.rssMB}MB`);
  console.log('✓ Memory OK');

  // -----------------------------------------------------------------------
  // Test 3: Disk §44 — Storage
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Disk/Storage §44 — drives, freeGB, usedPercent');
  const disk = monitor.getDiskUsage();
  assert(disk, 'disk missing');
  // disk may have drives array or error, but should not throw
  if (disk.drives && disk.drives.length > 0) {
    assert(disk.drives[0].freeGB !== undefined, 'drive freeGB missing');
    console.log(`  Disk drives: ${disk.drives.length}, first free=${disk.drives[0].freeGB}GB used=${disk.drives[0].usedPercent}%`);
  } else if (disk.freeGB !== null) {
    console.log(`  Disk free=${disk.freeGB}GB total=${disk.totalGB}GB`);
  } else {
    console.log(`  Disk info limited: ${JSON.stringify(disk).slice(0,200)}`);
  }
  // Test specific drive C:
  const driveC = monitor.getDiskUsage('C:');
  if (driveC && driveC.freeGB !== undefined) {
    console.log(`  C: free=${driveC.freeGB}GB`);
  }
  console.log('✓ Disk OK');

  // -----------------------------------------------------------------------
  // Test 4: Battery §44-45 — battery awareness, charging awareness
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Battery §44-45 — battery & charging awareness');
  const battery = monitor.getBatteryInfo();
  assert(battery && typeof battery === 'object', 'battery info should be object');
  // battery.available false on desktop is OK, true on laptop; just verify structure
  if (battery.available) {
    assert(typeof battery.level === 'number' && battery.level >= 0 && battery.level <= 100, `battery level should be 0-100, got ${battery.level}`);
    assert(typeof battery.charging === 'boolean', 'charging should be boolean');
    console.log(`  Battery: ${battery.level}% charging=${battery.charging} source=${battery.source}`);
  } else {
    console.log(`  Battery: not available (desktop) reason=${battery.reason || 'no battery'} desktop=${battery.desktop}`);
    assert(battery.level === null || battery.level === undefined || battery.available === false, 'battery level should be null when not available');
  }
  // Power state wrapper
  const powerState = monitor.getPowerState();
  assert(powerState && 'battery' in powerState, 'powerState should have battery');
  assert('charging' in powerState, 'powerState missing charging');
  console.log(`  PowerState: available=${powerState.available} level=${powerState.level} charging=${powerState.charging}`);
  console.log('✓ Battery OK');

  // -----------------------------------------------------------------------
  // Test 5: Processes §44 — process list
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Processes §44 — running processes');
  const procs = monitor.getProcessList(10);
  assert(procs.ok || procs.processes, 'process list should succeed or have processes');
  if (procs.processes && procs.processes.length > 0) {
    assert(procs.processes[0].name || procs.processes[0].pid, 'process entry missing name/pid');
    console.log(`  Processes: ${procs.count} found, first=${procs.processes[0].name} pid=${procs.processes[0].pid}`);
  } else {
    console.log(`  Processes: ${JSON.stringify(procs).slice(0,200)}`);
  }
  console.log('✓ Processes OK');

  // -----------------------------------------------------------------------
  // Test 6: Application state §44 — app state, build status
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Application state §44 — app, build, devices');
  const app = monitor.getAppState();
  assert(app.pid === process.pid, 'app pid mismatch');
  assert(app.uptimeSec >= 0, 'app uptime missing');
  assert(app.platform, 'app platform missing');
  console.log(`  App: pid=${app.pid} uptime=${app.uptimeSec}s buildExists=${app.build.exists} myraaFound=${app.myraaProcessFound}`);
  console.log('✓ App State OK');

  // -----------------------------------------------------------------------
  // Test 7: Network §44
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Network §44 — interfaces, internet');
  const net = monitor.getNetworkState();
  assert(Array.isArray(net.interfaces), 'network interfaces should be array');
  console.log(`  Network interfaces: ${net.interfaces.length}, hasNetwork=${net.hasNetwork}`);
  // checkInternet is async, but should not throw
  const online = await monitor.checkInternet({ timeout: 2000 });
  assert(typeof online === 'boolean', 'checkInternet should return boolean');
  console.log(`  Internet available: ${online}`);
  console.log('✓ Network OK');

  // -----------------------------------------------------------------------
  // Test 8: GPU §44
  // -----------------------------------------------------------------------
  console.log('\n[Test 8] GPU §44 — GPU info');
  const gpu = monitor.getGpuInfo();
  assert(gpu && typeof gpu === 'object', 'gpu info should be object');
  console.log(`  GPU: ${JSON.stringify(gpu).slice(0,200)}`);
  console.log('✓ GPU OK');

  // -----------------------------------------------------------------------
  // Test 9: System Snapshot §44 — aggregated
  // -----------------------------------------------------------------------
  console.log('\n[Test 9] System Snapshot §44 — aggregated snapshot');
  const snap = monitor.getSystemSnapshot();
  assert(snap.ts, 'snapshot ts missing');
  assert(snap.cpu && snap.memory && snap.disk && snap.battery && snap.network && snap.app, 'snapshot missing sections');
  console.log(`  Snapshot ts=${snap.ts} cpu=${snap.cpu.count} cores mem=${snap.memory.usedPercent}% batteryAvail=${snap.battery.available}`);
  console.log('✓ Snapshot OK');

  // -----------------------------------------------------------------------
  // Test 10: Power Management §45 — battery awareness, charging, throttling, adaptation, scheduling
  // -----------------------------------------------------------------------
  console.log('\n[Test 10] Power Management §45 — throttling, adaptation, scheduling');

  // isBatteryLow
  const isLow = monitor.isBatteryLow();
  assert(typeof isLow === 'boolean', 'isBatteryLow should be boolean');
  console.log(`  isBatteryLow: ${isLow} (threshold ${monitor.getThresholds().batteryLow}%)`);
  const isCritical = monitor.isBatteryCritical();
  assert(typeof isCritical === 'boolean', 'isBatteryCritical should be boolean');

  // shouldThrottle — should return boolean and consider CPU/memory/battery
  const throttle = monitor.shouldThrottle();
  assert(typeof throttle === 'boolean', 'shouldThrottle should be boolean');
  console.log(`  shouldThrottle: ${throttle}`);

  // adaptBackgroundTasks
  const adaptation = monitor.adaptBackgroundTasks();
  assert(adaptation && adaptation.recommendation, 'adaptation missing recommendation');
  assert(['normal','reduce_workload','defer_all_non_critical','throttle'].includes(adaptation.recommendation), `unknown recommendation ${adaptation.recommendation}`);
  console.log(`  Adaptation: ${adaptation.recommendation} reason=${adaptation.reason} maxConcurrency=${adaptation.maxConcurrency}`);

  // powerAwareSchedule: heavy vs light
  const heavyTask = { mission: 'Build standalone APK with no bridge', metadata: { heavy: true }, priority: 8 };
  const lightTask = { mission: 'Quick search', metadata: { heavy: false }, priority: 1 };
  const heavySched = monitor.powerAwareSchedule(heavyTask);
  const lightSched = monitor.powerAwareSchedule(lightTask);
  assert(typeof heavySched.shouldRun === 'boolean', 'heavySched shouldRun missing');
  assert(typeof lightSched.shouldRun === 'boolean', 'lightSched shouldRun missing');
  console.log(`  Heavy schedule: shouldRun=${heavySched.shouldRun} reason=${heavySched.reason}`);
  console.log(`  Light schedule: shouldRun=${lightSched.shouldRun} reason=${lightSched.reason}`);
  // On desktop with no battery, both should run
  if (!powerState.available) {
    assert(heavySched.shouldRun === true && lightSched.shouldRun === true, 'on desktop both should run');
  }
  console.log('✓ Power Management OK — battery awareness, throttling, adaptation, scheduling');

  // -----------------------------------------------------------------------
  // Test 11: Sleep/wake awareness §45
  // -----------------------------------------------------------------------
  console.log('\n[Test 11] Power Management §45 — sleep/wake awareness');
  let sleepFired = false;
  let wakeFired = false;
  monitor.onSleep(() => { sleepFired = true; });
  monitor.onWake(() => { wakeFired = true; });
  monitor.simulateSleep();
  monitor.simulateWake();
  assert(sleepFired, 'sleep handler not fired');
  assert(wakeFired, 'wake handler not fired');
  console.log('✓ Sleep/wake OK');

  // -----------------------------------------------------------------------
  // Test 12: Authorized shutdown/restart §45 — gated power actions
  // -----------------------------------------------------------------------
  console.log('\n[Test 12] Power Management §45 — authorized shutdown/restart (gated)');
  // Should not actually shutdown — dry-run
  const reqRes = await monitor.requestPowerAction('shutdown');
  // requestPowerAction may return token or require confirmation; both OK
  if (reqRes.ok) {
    assert(reqRes.token, 'request should return token');
    console.log(`  Power request token: ${reqRes.token.slice(0,8)}...`);
    const execRes = await monitor.executePowerAction(reqRes.token, 'shutdown');
    assert(execRes.dryRun === true || execRes.ok, `execute should be dry-run, got ${JSON.stringify(execRes)}`);
    console.log(`  Power execute dry-run: ${execRes.result?.slice(0,80)}`);
  } else {
    // May be blocked by policy if no confirmation — check structure
    assert(reqRes.error, 'request failed should have error');
    console.log(`  Power request blocked (expected if policy): ${reqRes.error.slice(0,80)}`);
  }
  // Invalid action should fail
  const invalid = await monitor.requestPowerAction('invalid_action');
  assert(!invalid.ok, 'invalid action should fail');
  console.log('✓ Authorized power actions OK — gated, dry-run');

  // -----------------------------------------------------------------------
  // Test 13: Monitoring loop §44, §50 — event-driven
  // -----------------------------------------------------------------------
  console.log('\n[Test 13] Monitoring loop §44, §50 — start/stop, events');
  // Mock checkInternet to avoid network delay in test loop
  const origCheckInternet = monitor.checkInternet.bind(monitor);
  monitor.checkInternet = async () => true;
  const events = [];
  const handler = (data) => events.push(data);
  monitor.on('system:metrics', handler);
  const startRes = monitor.startMonitoring(300);
  assert(startRes.ok, `startMonitoring failed: ${startRes.error}`);
  assert(monitor.isMonitoring() === true, 'should be monitoring');
  // Wait for at least 2 ticks
  await new Promise(r => setTimeout(r, 800));
  assert(events.length >= 2, `should have at least 2 metrics events, got ${events.length}`);
  console.log(`  Metrics events received: ${events.length}, first ts=${events[0].ts}`);
  const stopRes = monitor.stopMonitoring();
  assert(stopRes.ok, 'stopMonitoring failed');
  assert(monitor.isMonitoring() === false, 'should not be monitoring after stop');
  const countAfterStop = events.length;
  await new Promise(r => setTimeout(r, 400));
  assert(events.length === countAfterStop, 'should not receive events after stop');
  monitor.off('system:metrics', handler);
  // Restore
  monitor.checkInternet = origCheckInternet;
  console.log('✓ Monitoring loop OK — start, events, stop');

  // -----------------------------------------------------------------------
  // Test 14: Example §45 — Battery 15% → heavy task → check charging → reduce/defer
  // -----------------------------------------------------------------------
  console.log('\n[Test 14] Example §45 — Battery 15% → detect heavy → check charging → reduce/defer');
  // Create a monitor with mocked battery low, not charging
  const mockMonitor = new SystemMonitor({ intervalMs: 500, thresholds: { batteryLow: 20, batteryCritical: 10 }, logger: { warn: () => {}, info: () => {} } });
  // Mock getBatteryInfo to simulate 15% not charging
  mockMonitor.getBatteryInfo = () => ({ available: true, level: 15, charging: false, powerOnline: false, status: 1, source: 'mock' });
  const isLow15 = mockMonitor.isBatteryLow();
  assert(isLow15 === true, '15% not charging should be low');
  const heavyAt15 = mockMonitor.powerAwareSchedule({ mission: 'Build APK heavy', metadata: { heavy: true }, priority: 8 });
  assert(heavyAt15.deferred === true && heavyAt15.shouldRun === false, `heavy at 15% not charging should be deferred, got ${JSON.stringify(heavyAt15)}`);
  console.log(`  Battery 15% heavy task: deferred=${heavyAt15.deferred} reason=${heavyAt15.reason}`);
  // Now mock charging = true, should run
  mockMonitor.getBatteryInfo = () => ({ available: true, level: 15, charging: true, powerOnline: true, status: 2, source: 'mock-charging' });
  const heavyCharging = mockMonitor.powerAwareSchedule({ mission: 'Build APK heavy', metadata: { heavy: true } });
  assert(heavyCharging.shouldRun === true, `heavy when charging should run, got ${JSON.stringify(heavyCharging)}`);
  console.log(`  Battery 15% charging heavy task: shouldRun=${heavyCharging.shouldRun}`);
  // Adaptation should recommend reduce/defer
  mockMonitor.getBatteryInfo = () => ({ available: true, level: 15, charging: false, powerOnline: false, status: 1, source: 'mock' });
  const adaptLow = mockMonitor.adaptBackgroundTasks();
  assert(adaptLow.recommendation === 'reduce_workload' || adaptLow.recommendation === 'defer_all_non_critical', `adaptation at 15% should be reduce/defer, got ${adaptLow.recommendation}`);
  console.log(`  Adaptation at 15%: ${adaptLow.recommendation} maxConcurrency=${adaptLow.maxConcurrency}`);
  console.log('✓ Battery 15% example OK — detect, check charging, reduce/defer');

  monitor.destroy();
  mockMonitor.destroy();

  console.log('\n[Myraa System Monitor Test] ALL CHECKS PASSED — §44-45 verified: CPU, memory, disk, battery, processes, app state, power management (battery, throttling, adaptation, sleep/wake, authorized power, scheduling, monitoring loop)');
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => {
  console.error('[Myraa System Monitor Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
