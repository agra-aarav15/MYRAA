// Myraa Audit Log Test — MASTER BUILD PROMPT §38
// Verifies: timestamp, agent, task, tool, result, permission, confirmation, device, error, no secrets
// Run: node myraa-core/policy/audit.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuditLogger } from './audit.js';

const TMP_AUDIT = path.join(os.tmpdir(), `myraa-test-audit-${Date.now()}.json`);
console.log('[Myraa Audit Log Test] Starting — §38 verification');
console.log(`  Temp audit file: ${TMP_AUDIT}`);

async function main() {
  try { if (fs.existsSync(TMP_AUDIT)) fs.unlinkSync(TMP_AUDIT); } catch {}
  try { if (fs.existsSync(TMP_AUDIT + '.tmp')) fs.unlinkSync(TMP_AUDIT + '.tmp'); } catch {}

  const audit = new AuditLogger({ filePath: TMP_AUDIT, maxEntries: 100 });

  // -----------------------------------------------------------------------
  // Test 1: Required fields §38
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Required audit fields §38 — timestamp, agent, task, tool, result, permission, confirmation, device, error, no secrets');
  const log1 = audit.log({
    agent: 'CodingAgent',
    task: 'task-123',
    taskId: 'task-123',
    tool: 'deleteFile',
    action: 'deleteFile',
    result: 'Deleted file: C:\\test\\file.txt',
    permission: 'DANGEROUS',
    permissionDecision: 'DANGEROUS',
    confirmation: true,
    confirmationState: true,
    device: 'pc',
    error: null,
    durationMs: 120,
  });
  assert(log1.ok, `log1 failed: ${log1.error}`);
  const entry1 = log1.entry;
  assert(entry1.timestamp, 'timestamp missing');
  // ISO format
  assert(!isNaN(new Date(entry1.timestamp).getTime()), 'timestamp not valid ISO');
  assert(entry1.agent === 'CodingAgent', 'agent mismatch');
  assert(entry1.task === 'task-123' || entry1.taskId === 'task-123', 'task missing');
  assert(entry1.tool === 'deleteFile', 'tool missing');
  assert(entry1.action === 'deleteFile', 'action missing');
  assert(entry1.result.includes('Deleted'), 'result missing');
  assert(entry1.permission === 'DANGEROUS', 'permission missing');
  assert(entry1.confirmation === true || entry1.confirmationState === true, 'confirmation missing');
  assert(entry1.device === 'pc', 'device missing');
  assert(entry1.error === null, 'error should be null');
  console.log(`  log1 entry: id=${entry1.id} ts=${entry1.timestamp} tool=${entry1.tool} permission=${entry1.permission}`);

  // error case
  const logErr = audit.log({
    agent: 'TerminalAgent',
    task: 'task-err',
    tool: 'runTerminalCommand',
    action: 'runTerminalCommand',
    result: null,
    permission: 'DANGEROUS',
    confirmation: false,
    device: 'pc',
    error: 'Command failed: permission denied',
  });
  assert(logErr.ok, 'logErr failed');
  assert(logErr.entry.error.includes('permission denied'), 'error not recorded');
  assert(logErr.entry.permission === 'DANGEROUS', 'error permission missing');
  console.log('✓ Required fields OK — timestamp, agent, task, tool, result, permission, confirmation, device, error');

  // -----------------------------------------------------------------------
  // Test 2: No secrets in audit logs §23, §38 never log secrets
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Never log secrets §23 — audit must redact');
  const secretCases = [
    { tool: 'browserFillForm', args: { apiKey: 'sk-1234567890abcdef1234567890', username: 'test' } },
    { token: 'ghp_123456789012345678901234567890123456' },
    { password: 'supersecret123' },
    { raw: 'apiKey=sk-abcdefghijklmnopqrstuv and token=ghp_abc' },
  ];

  for (let i = 0; i < secretCases.length; i++) {
    const c = secretCases[i];
    const res = audit.log({
      agent: 'TestAgent',
      task: `task-secret-${i}`,
      tool: 'testTool',
      action: 'testTool',
      result: typeof c.raw === 'string' ? c.raw : JSON.stringify(c),
      args: c,
      permission: 'SAFE',
      confirmation: true,
      device: 'pc',
      error: c.token || c.password || null,
    });
    assert(res.ok, `secret case ${i} log failed`);
    const e = res.entry;
    const blob = JSON.stringify(e);
    // Should contain [REDACTED] and not raw secrets
    assert(blob.includes('[REDACTED]') || !/(sk-|ghp_)/.test(JSON.stringify(c)), `secret case ${i} should be redacted, got ${blob.slice(0,200)}`);
    assert(!blob.includes('sk-1234567890abc'), `raw sk leaked in case ${i}: ${blob.slice(0,200)}`);
    assert(!blob.includes('ghp_1234567890'), `raw ghp leaked in case ${i}`);
    if (c.password) assert(!blob.includes('supersecret123'), 'raw password leaked');
  }

  // Also test args redaction: apiKey key should be redacted
  const argsSecret = audit.log({
    agent: 'CredTest',
    task: 'task-args-secret',
    tool: 'runTerminalCommand',
    args: { command: 'echo hello', apiKey: 'sk-99999999999999999999', token: 'ghp_999999999999999999999999999999999999' },
    permission: 'DANGEROUS',
    confirmation: false,
    device: 'pc',
  });
  assert(argsSecret.ok, 'args secret log failed');
  const argsBlob = JSON.stringify(argsSecret.entry);
  assert(!argsBlob.includes('sk-9999'), 'args raw sk leaked');
  assert(!argsBlob.includes('ghp_9999'), 'args raw ghp leaked');
  assert(argsBlob.includes('[REDACTED]'), 'args should contain [REDACTED]');
  console.log('✓ No secrets OK — all secrets redacted with [REDACTED]');

  // Verify file also has no raw secrets
  const fileText = fs.readFileSync(TMP_AUDIT, 'utf8');
  assert(!fileText.includes('sk-1234567890abc'), 'Raw secret found in persisted audit file!');
  assert(!fileText.includes('ghp_1234567890'), 'Raw ghp found in file!');
  assert(fileText.includes('[REDACTED]'), 'File should contain redacted marker');
  console.log('✓ Persisted audit file has no raw secrets');

  // Use verifyNoSecrets helper
  const verify = audit.verifyNoSecrets();
  assert(verify.ok, `verifyNoSecrets failed: ${JSON.stringify(verify.violations.slice(0,2))}`);
  console.log(`✓ verifyNoSecrets helper OK — checked ${verify.checked} entries`);

  // -----------------------------------------------------------------------
  // Test 3: Query and inspection
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Query, search, stats, persistence');

  // Add more entries for querying
  audit.log({ agent: 'CodingAgent', task: 'task-123', tool: 'writeCodeFile', permission: 'NORMAL', confirmation: true, device: 'pc', result: 'Written file' });
  audit.log({ agent: 'BrowserAgent', task: 'task-browser', tool: 'browserOpen', permission: 'NORMAL', confirmation: true, device: 'pc', result: 'Opened https://example.com' });
  audit.log({ agent: 'CodingAgent', task: 'task-123', tool: 'runTerminalCommand', permission: 'DANGEROUS', confirmation: true, device: 'server', result: 'Command executed', error: null });

  // Query by agent
  const byAgent = audit.query({ agent: 'CodingAgent' });
  assert(byAgent.ok && byAgent.results.length >= 3, `query by agent CodingAgent should find >=3, got ${byAgent.results.length}`);
  // Query by tool
  const byTool = audit.query({ tool: 'writeCodeFile' });
  assert(byTool.results.length >= 1, 'query by tool writeCodeFile failed');

  // Query by permission
  const byPerm = audit.query({ permission: 'DANGEROUS' });
  assert(byPerm.total >= 2, `DANGEROUS query should find >=2, got ${byPerm.total}`);

  // Query by device
  const byDevice = audit.query({ device: 'server' });
  assert(byDevice.results.length >= 1 && byDevice.results[0].device === 'server', 'query by device server failed');

  // Search
  const searchRes = audit.search('file');
  assert(searchRes.ok && searchRes.total >= 1, 'search "file" should find at least 1');

  // getByTask
  const byTask = audit.getByTask('task-123');
  assert(byTask.ok && byTask.results.length >= 2, `getByTask task-123 should find >=2, got ${byTask.results.length}`);

  // getByAgent
  const byAg = audit.getByAgent('BrowserAgent');
  assert(byAg.results.length >= 1, 'getByAgent BrowserAgent failed');

  // Stats
  const stats = audit.getStats();
  assert(stats.ok && stats.total >= 6, `stats total should be >=6, got ${stats.total}`);
  assert(stats.byAgent['CodingAgent'] >= 3, 'stats byAgent CodingAgent count mismatch');
  assert(stats.byPermission['DANGEROUS'] >= 2, 'stats byPermission DANGEROUS mismatch');
  console.log(`  stats: total=${stats.total} byAgent=${JSON.stringify(stats.byAgent)} byPermission=${JSON.stringify(stats.byPermission)}`);

  // Persistence: reload via new instance
  const audit2 = new AuditLogger({ filePath: TMP_AUDIT, maxEntries: 100 });
  assert(audit2.getAll().length === audit.getAll().length, `Reloaded audit should have same count: ${audit2.getAll().length} vs ${audit.getAll().length}`);
  console.log('✓ Query and persistence OK');

  // -----------------------------------------------------------------------
  // Test 4: All required fields present for each entry via spec checklist
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Spec checklist — every entry has required fields and no secrets');
  const allEntries = audit.getAll();
  for (const e of allEntries) {
    assert(e.timestamp, `Entry ${e.id} missing timestamp`);
    assert(e.agent, `Entry ${e.id} missing agent`);
    assert(e.tool || e.action, `Entry ${e.id} missing tool/action`);
    // result or error at least one present (but both could be null for some? Still check fields exist)
    assert('permission' in e || 'permissionDecision' in e, `Entry ${e.id} missing permission`);
    assert('confirmation' in e || 'confirmationState' in e, `Entry ${e.id} missing confirmation`);
    // device may be null for some? But check field existence
    assert('device' in e, `Entry ${e.id} missing device field`);
    assert('error' in e, `Entry ${e.id} missing error field`);
    // no secrets
    const blob = JSON.stringify(e);
    assert(!/sk-[a-zA-Z0-9]{20,}/.test(blob) || blob.includes('[REDACTED]'), `Entry ${e.id} leaked raw sk`);
  }
  console.log(`✓ Spec checklist OK — ${allEntries.length} entries all have required fields, no secrets`);

  // -----------------------------------------------------------------------
  // Test 5: Clear and maxEntries cap
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Clear and cap');
  const smallAudit = new AuditLogger({ filePath: TMP_AUDIT + '.small', maxEntries: 3 });
  for (let i = 0; i < 5; i++) {
    smallAudit.log({ agent: 'Test', task: `t-${i}`, tool: 'test', permission: 'SAFE', device: 'pc', result: `result ${i}` });
  }
  assert(smallAudit.getAll().length === 3, `maxEntries cap should be 3, got ${smallAudit.getAll().length}`);
  assert(smallAudit.getAll()[0].task === 't-2' || smallAudit.getAll().slice(-1)[0].task === 't-4', 'cap should keep newest');
  smallAudit.clear();
  assert(smallAudit.getAll().length === 0, 'clear should empty');
  console.log('✓ Clear and cap OK');
  try { fs.unlinkSync(TMP_AUDIT + '.small'); } catch {}
  try { fs.unlinkSync(TMP_AUDIT + '.small.tmp'); } catch {}

  // Cleanup
  audit.clear();
  assert(audit.getAll().length === 0, 'clear audit failed');
  assert(audit.getStats().total === 0, 'stats after clear should be 0');
  try { fs.unlinkSync(TMP_AUDIT); } catch {}
  try { fs.unlinkSync(TMP_AUDIT + '.tmp'); } catch {}

  console.log('\n[Myraa Audit Log Test] ALL CHECKS PASSED — §38 verified: timestamp, agent, task, tool, result, permission, confirmation, device, error, no secrets, query, persistence.');
}

main().catch(e => {
  console.error('[Myraa Audit Log Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
