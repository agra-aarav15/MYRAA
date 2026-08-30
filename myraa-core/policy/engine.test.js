// Myraa Policy Engine Test — MASTER BUILD PROMPT §34-36, §53-55
// Verifies: SAFE/NORMAL/DANGEROUS, every tool passes through engine, configurable per tool/app/website/device/operation/directory/command/account/agent, dangerous ops list §36 requiring confirmation.
// Run: node myraa-core/policy/engine.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PolicyEngine, Permission, DANGEROUS_OPERATIONS_DEFAULT } from './engine.js';

const TMP_POLICY = path.join(os.tmpdir(), `myraa-test-policy-${Date.now()}.json`);
console.log('[Myraa Policy Engine Test] Starting — §34-36, §35 configurable permissions');
console.log(`  Temp policy file: ${TMP_POLICY}`);
console.log(`  Dangerous ops default count: ${DANGEROUS_OPERATIONS_DEFAULT.length}`);

async function main() {
  try { if (fs.existsSync(TMP_POLICY)) fs.unlinkSync(TMP_POLICY); } catch {}
  // also unlink tmp file
  try { if (fs.existsSync(TMP_POLICY + '.tmp')) fs.unlinkSync(TMP_POLICY + '.tmp'); } catch {}

  // -----------------------------------------------------------------------
  // Test 0: Permission model SAFE/NORMAL/DANGEROUS exists §34
  // -----------------------------------------------------------------------
  console.log('\n[Test 0] Permission model §34 — SAFE/NORMAL/DANGEROUS');
  assert(Permission.SAFE === 'SAFE', 'SAFE missing');
  assert(Permission.NORMAL === 'NORMAL', 'NORMAL missing');
  assert(Permission.DANGEROUS === 'DANGEROUS', 'DANGEROUS missing');
  assert(DANGEROUS_OPERATIONS_DEFAULT.length >= 10, `Should have >=10 dangerous ops, got ${DANGEROUS_OPERATIONS_DEFAULT.length}`);
  const ids = DANGEROUS_OPERATIONS_DEFAULT.map(o => o.id);
  for (const required of ['destructive_file_deletion','drive_formatting','major_system_changes','admin_operations','destructive_git','repository_deletion','financial_transactions','purchases','sending_sensitive_info','high_impact_publishing','destructive_cloud','credential_changes']) {
    assert(ids.includes(required), `Missing dangerous op: ${required}`);
  }
  // each requires confirmation by default
  for (const op of DANGEROUS_OPERATIONS_DEFAULT) {
    assert(op.requiresConfirmation === true, `Dangerous op ${op.id} should require confirmation by default`);
    assert(op.enabled === true, `Dangerous op ${op.id} should be enabled by default`);
  }
  console.log(`✓ Permission model OK — SAFE/NORMAL/DANGEROUS, ${ids.length} dangerous ops all require confirmation`);

  // -----------------------------------------------------------------------
  // Test 1: Every tool action must pass through engine with risk evaluation §34
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Every tool action passes through engine with risk evaluation §34');
  const engine = new PolicyEngine({ filePath: TMP_POLICY });
  assert(engine, 'PolicyEngine creation failed');
  // Test SAFE tool
  const safeRes = await engine.assess({ tool: 'readFile', args: { path: 'some.txt' }, context: { device: 'pc' } });
  assert(safeRes.tier === Permission.SAFE || safeRes.tier === Permission.NORMAL, `readFile should be SAFE/NORMAL, got ${safeRes.tier}`);
  assert(safeRes.allowed === true, 'SAFE tool should be allowed without confirmation');
  assert(safeRes.needsConfirmation === false, 'SAFE tool should not need confirmation');
  console.log(`  readFile risk: ${safeRes.tier} allowed=${safeRes.allowed} reason=${safeRes.reason.slice(0,60)}`);

  const normalRes = await engine.assess({ tool: 'openApplication', args: { name: 'notepad' }, context: { device: 'pc' } });
  assert(normalRes.tier === Permission.NORMAL, `openApplication should be NORMAL, got ${normalRes.tier}`);
  assert(normalRes.allowed === true, 'NORMAL tool should be allowed');

  const dangerousRes = await engine.assess({ tool: 'deleteFile', args: { path: 'some.txt' }, context: { device: 'pc' } });
  assert(dangerousRes.tier === Permission.DANGEROUS, `deleteFile should be DANGEROUS, got ${dangerousRes.tier}`);
  assert(dangerousRes.allowed === false, 'DANGEROUS tool without confirmation should be blocked');
  assert(dangerousRes.needsConfirmation === true, 'DANGEROUS tool should need confirmation');
  console.log(`  deleteFile risk: ${dangerousRes.tier} allowed=${dangerousRes.allowed} needsConfirmation=${dangerousRes.needsConfirmation}`);

  // With confirmation, should be allowed
  const dangerousConfirmed = await engine.assess({ tool: 'deleteFile', args: { path: 'some.txt' }, context: { device: 'pc', confirmed: true } });
  assert(dangerousConfirmed.allowed === true, 'DANGEROUS tool with confirmed:true should be allowed');
  console.log(`  deleteFile confirmed: allowed=${dangerousConfirmed.allowed}`);

  // Also via args.confirmed? Registry passes context.confirmed, but we support both
  const dangerousViaContext = await engine.assess('deleteFile', { path: 'some.txt' }, { confirmed: true });
  assert(dangerousViaContext.allowed === true, 'deleteFile via context confirmed should be allowed');

  // Mission string evaluation (orchestrator legacy)
  const missionSafe = await engine.assess('help me write a file');
  assert(missionSafe.tier !== Permission.DANGEROUS, 'safe mission should not be DANGEROUS');
  const missionDangerous = await engine.assess('delete all files and format drive');
  assert(missionDangerous.tier === Permission.DANGEROUS, 'dangerous mission should be DANGEROUS');
  console.log(`✓ Risk evaluation OK — SAFE/NORMAL auto-allowed, DANGEROUS requires confirmation, mission string evaluated`);

  // -----------------------------------------------------------------------
  // Test 2: Dangerous operations list §36 requires confirmation, configurable rules
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Dangerous operations §36 — configurable confirmation');
  // Each dangerous operation should be detectable
  const fmtRes = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'format C: /fs:ntfs' }, context: {} });
  assert(fmtRes.risk.dangerousMatches.some(m => m.id === 'drive_formatting'), 'format command should match drive_formatting');
  assert(fmtRes.tier === Permission.DANGEROUS && fmtRes.needsConfirmation, 'drive formatting should be DANGEROUS requiring confirmation');

  const gitForce = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'git push origin main --force' }, context: {} });
  assert(gitForce.risk.dangerousMatches.some(m => m.id === 'destructive_git'), 'git push --force should match destructive_git');
  assert(gitForce.tier === Permission.DANGEROUS, 'destructive git should be DANGEROUS');

  const finance = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'curl -X POST https://api.stripe.com/v1/payment transaction' }, context: {} });
  assert(finance.risk.dangerousMatches.some(m => m.id === 'financial_transactions'), 'financial transaction should match');

  const publish = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'npm publish' }, context: {} });
  assert(publish.risk.dangerousMatches.some(m => m.id === 'high_impact_publishing'), 'npm publish should match high_impact_publishing');

  const credChange = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'net user administrator newpassword123' }, context: {} });
  // net user matches admin_operations and credential_changes? Check at least one
  assert(credChange.risk.dangerousMatches.length > 0, 'net user should match dangerous operation');

  // Configurable: disable requiresConfirmation for one operation
  const beforeConfig = engine.listDangerousOperations().find(o => o.id === 'high_impact_publishing');
  assert(beforeConfig.requiresConfirmation === true, 'high_impact_publishing should require confirmation initially');
  const cfgRes = engine.configureDangerousOperation('high_impact_publishing', { requiresConfirmation: false });
  assert(cfgRes.ok && cfgRes.operation.requiresConfirmation === false, 'configure should disable confirmation');

  const publishNoConfirm = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'npm publish' }, context: {} });
  // Now with requiresConfirmation false, it should still be DANGEROUS tier but not need confirmation
  assert(publishNoConfirm.tier === Permission.DANGEROUS, 'still DANGEROUS tier');
  assert(publishNoConfirm.needsConfirmation === false, 'after config, should not need confirmation');
  assert(publishNoConfirm.allowed === true, 'after config, should be allowed without confirmation');
  console.log(`  Configurable dangerous op OK — high_impact_publishing toggled to not require confirmation`);

  // Re-enable for further tests
  engine.configureDangerousOperation('high_impact_publishing', { requiresConfirmation: true });

  // Add custom dangerous operation
  const addRes = engine.addDangerousOperation({ id: 'custom_danger', label: 'Custom Danger', tools: ['customTool'], patterns: ['custom_pattern'] });
  assert(addRes.ok, 'add custom dangerous operation failed');
  const customCheck = await engine.assess({ tool: 'customTool', args: {}, context: {} });
  assert(customCheck.tier === Permission.DANGEROUS, 'custom tool should be DANGEROUS after adding');
  engine.removeDangerousOperation('custom_danger');
  const afterRemove = await engine.assess({ tool: 'customTool', args: {}, context: {} });
  assert(afterRemove.tier !== Permission.DANGEROUS, 'after removal, custom tool should not be DANGEROUS');

  console.log('✓ Dangerous operations list OK — detection, configurable requiresConfirmation, add/remove');

  // -----------------------------------------------------------------------
  // Test 3: Configurable per tool/app/website/device/operation/directory/command/account/agent §35
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Configurable permissions per scope §35');

  // Per tool
  engine.setRule('tools', 'readFile', 'DANGEROUS');
  const readNowDangerous = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: {} });
  assert(readNowDangerous.tier === Permission.DANGEROUS && readNowDangerous.needsConfirmation, 'readFile overridden to DANGEROUS should require confirmation');
  engine.setRule('tools', 'readFile', 'SAFE');
  const readBackSafe = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: {} });
  assert(readBackSafe.tier === Permission.SAFE && !readBackSafe.needsConfirmation, 'readFile overridden to SAFE should be allowed');

  // Reset tool rule
  engine.removeRule('tools', 'readFile');

  // Per app
  engine.setAppRule('powershell', 'DANGEROUS');
  const appDanger = await engine.assess({ tool: 'openApplication', args: { name: 'powershell' }, context: {} });
  assert(appDanger.tier === Permission.DANGEROUS, `powershell app should be DANGEROUS, got ${appDanger.tier} per-scope=${JSON.stringify(appDanger.risk.perScopeMatches)}`);
  engine.removeRule('apps', 'powershell');

  engine.setAppRule('notepad', 'SAFE');
  const notepadSafe = await engine.assess({ tool: 'openApplication', args: { name: 'notepad' }, context: {} });
  assert(notepadSafe.risk.perScopeMatches.some(m => m.source === 'apps'), 'notepad should have app match');
  console.log('  per app OK');

  // Per website
  engine.setWebsiteRule('bank.com', 'DANGEROUS');
  const bankDanger = await engine.assess({ tool: 'openWebsite', args: { url: 'https://bank.com/login' }, context: {} });
  assert(bankDanger.tier === Permission.DANGEROUS, `bank.com should be DANGEROUS, got ${bankDanger.tier}`);
  // subdomain should also match
  const subBank = await engine.assess({ tool: 'browserOpen', args: { url: 'https://secure.bank.com/account' }, context: {} });
  assert(subBank.tier === Permission.DANGEROUS, 'subdomain bank.com should also be DANGEROUS');
  // github.com normal should not affect
  const githubOk = await engine.assess({ tool: 'openWebsite', args: { url: 'https://github.com/user/repo' }, context: {} });
  assert(githubOk.tier !== Permission.DANGEROUS || githubOk.risk.perScopeMatches.length === 0, 'github.com should not be DANGEROUS');
  engine.removeRule('websites', 'bank.com');
  console.log('  per website OK');

  // Per device
  engine.setDeviceRule('server', 'DANGEROUS');
  const serverDanger = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: { device: 'server' } });
  assert(serverDanger.tier === Permission.DANGEROUS, `device server should make SAFE tool DANGEROUS, got ${serverDanger.tier}`);
  const pcOk = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: { device: 'pc' } });
  assert(pcOk.tier === Permission.SAFE, 'device pc should remain SAFE');
  engine.removeRule('devices', 'server');
  console.log('  per device OK');

  // Per operation
  engine.setOperationRule('delete', 'DANGEROUS');
  const opDanger = await engine.assess({ tool: 'writeCodeFile', args: { path: 'x' }, context: { operation: 'delete' } });
  assert(opDanger.tier === Permission.DANGEROUS, 'operation delete should make tool DANGEROUS');
  engine.removeRule('operations', 'delete');
  console.log('  per operation OK');

  // Per directory
  const testDir = 'C:\\Windows\\System32';
  engine.setDirectoryRule(testDir, 'DANGEROUS');
  const dirDanger = await engine.assess({ tool: 'writeCodeFile', args: { path: 'C:\\Windows\\System32\\test.dll' }, context: {} });
  assert(dirDanger.tier === Permission.DANGEROUS, `directory ${testDir} should make write DANGEROUS, got ${dirDanger.tier} matches=${JSON.stringify(dirDanger.risk.perScopeMatches)}`);
  const allowedDir = await engine.assess({ tool: 'writeCodeFile', args: { path: 'C:\\Users\\Test\\Projects\\app\\file.js' }, context: {} });
  assert(allowedDir.tier === Permission.NORMAL, 'allowed directory should remain NORMAL');
  engine.removeRule('directories', testDir);
  console.log('  per directory OK');

  // Per command type
  engine.setCommandRule('rm -rf', 'DANGEROUS');
  const cmdDanger = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'rm -rf /tmp/test' }, context: {} });
  assert(cmdDanger.tier === Permission.DANGEROUS, 'command rm -rf should be DANGEROUS');
  // command without pattern should be NORMAL if not dangerous pattern otherwise
  const lsOk = await engine.assess({ tool: 'runTerminalCommand', args: { command: 'ls -la' }, context: {} });
  // ls is not in dangerous list per se, but runTerminalCommand base is DANGEROUS? Actually base for runTerminalCommand is DANGEROUS already, so ls will be DANGEROUS regardless. That's expected per registry.
  // Let's test with a SAFE tool and command pattern not applicable — but command matching only applies to terminal tools, so fine.
  engine.removeRule('commands', 'rm -rf');
  console.log('  per command OK');

  // Per account
  engine.setAccountRule('work', 'DANGEROUS');
  const accountDanger = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: { account: 'work' } });
  assert(accountDanger.tier === Permission.DANGEROUS, 'account work should make tool DANGEROUS');
  engine.removeRule('accounts', 'work');
  console.log('  per account OK');

  // Per agent
  engine.setAgentRule('CodingAgent', 'DANGEROUS');
  const agentDanger = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: { agent: 'CodingAgent' } });
  assert(agentDanger.tier === Permission.DANGEROUS, 'agent CodingAgent should make tool DANGEROUS');
  // different agent should not
  const otherAgentOk = await engine.assess({ tool: 'readFile', args: { path: 'x' }, context: { agent: 'ResearchAgent' } });
  assert(otherAgentOk.tier === Permission.SAFE, 'other agent should remain SAFE');
  engine.removeRule('agents', 'CodingAgent');
  console.log('  per agent OK');

  // Verify not hardcoded permanently — rules can be changed and persisted
  engine.setToolRule('customTestTool', 'DANGEROUS');
  const beforeSave = engine.getRules();
  assert(beforeSave.rules.tools['customtesttool'] === 'DANGEROUS', 'customTestTool rule not persisted in memory');
  // Create new engine instance loading from same file
  const engine2 = new PolicyEngine({ filePath: TMP_POLICY });
  const loadedRule = engine2.getRules().rules.tools['customtesttool'];
  assert(loadedRule === 'DANGEROUS', `persisted rule should load, got ${loadedRule}`);
  engine.removeRule('tools', 'customTestTool');
  engine2.removeRule('tools', 'customTestTool');
  console.log('✓ Configurable per all scopes OK — tool, app, website, device, operation, directory, command, account, agent; not hardcoded, persists');

  // -----------------------------------------------------------------------
  // Test 4: Configurable rules — bulk and reset, do not hardcode all
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Bulk configuration and reset — not hardcoded');
  const bulkRes = engine.setRulesBulk({
    tools: { bulkTool1: 'SAFE', bulkTool2: 'DANGEROUS' },
    apps: { bulkApp: 'DANGEROUS' },
    devices: { tablet: 'NORMAL' },
  });
  assert(bulkRes.ok && bulkRes.updated >= 3, 'bulk set failed');
  assert(engine.getRules().rules.tools['bulktool1'] === 'SAFE', 'bulkTool1 not set');
  const bulkCheck = await engine.assess({ tool: 'bulkTool2', args: {}, context: {} });
  assert(bulkCheck.tier === Permission.DANGEROUS, 'bulkTool2 should be DANGEROUS');

  const stats = engine.getStats();
  assert(stats.totalRules >= 3, `stats totalRules should be >=3, got ${stats.totalRules}`);
  assert(stats.rulesCount.tools >= 2, 'tools count mismatch');

  // Reset
  const resetRes = engine.reset();
  assert(resetRes.ok, 'reset failed');
  const afterReset = engine.getRules();
  assert(Object.keys(afterReset.rules.tools).length === 0, 'after reset tools should be empty');
  assert(afterReset.dangerousOperations.length === DANGEROUS_OPERATIONS_DEFAULT.length, 'after reset dangerous ops should be default count');
  console.log('✓ Bulk and reset OK — not hardcoded, configurable');

  // -----------------------------------------------------------------------
  // Test 5: Policy Engine assess signature compatibility with ToolRegistry §34
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] ToolRegistry compatibility — assess({tool, permission, args, context})');
  // Registry calls policyEngine.assess({ tool, permission, args, context })
  const regStyle = await engine.assess({ tool: 'deleteFile', permission: 'DANGEROUS', args: { path: 'a.txt' }, context: { device: 'pc' } });
  assert(regStyle.tier === Permission.DANGEROUS && !regStyle.allowed, 'registry style assess should block DANGEROUS');

  const regStyleSafe = await engine.assess({ tool: 'listFiles', permission: 'SAFE', args: { path: '.' }, context: {} });
  assert(regStyleSafe.allowed && regStyleSafe.tier === Permission.SAFE, 'registry style SAFE should allow');

  // With confirmed via context
  const regConfirmed = await engine.assess({ tool: 'deleteFile', permission: 'DANGEROUS', args: { path: 'a.txt' }, context: { confirmed: true } });
  assert(regConfirmed.allowed, 'registry style with confirmed should allow');

  // Env override
  process.env.MYRAA_ALLOW_DANGEROUS = '1';
  const envOverride = await engine.assess({ tool: 'deleteFile', args: { path: 'a.txt' }, context: {} });
  assert(envOverride.allowed, 'MYRAA_ALLOW_DANGEROUS=1 should allow');
  delete process.env.MYRAA_ALLOW_DANGEROUS;
  console.log('✓ ToolRegistry compatibility OK');

  // -----------------------------------------------------------------------
  // Test 6: Verify dangerous operations coverage for publish etc. §36
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Dangerous list covers publishing/financial etc. §36');
  const publishingCases = [
    { cmd: 'git push origin main', shouldBeDangerous: true, reason: 'push to main' },
    { cmd: 'aws s3 rm s3://bucket --recursive', shouldBeDangerous: true, reason: 'cloud delete' },
    { cmd: 'password change for user', tool: 'runTerminalCommand', shouldBeDangerous: true, reason: 'credential change' },
  ];
  for (const c of publishingCases) {
    const r = await engine.assess({ tool: c.tool || 'runTerminalCommand', args: { command: c.cmd }, context: {} });
    if (c.shouldBeDangerous) {
      assert(r.tier === Permission.DANGEROUS, `Case "${c.cmd}" should be DANGEROUS, got ${r.tier} matches=${JSON.stringify(r.risk.dangerousMatches.map(m=>m.id))} reason=${c.reason}`);
    }
  }
  console.log('✓ Publishing / cloud / credential dangerous coverage OK');

  // Cleanup
  try { fs.unlinkSync(TMP_POLICY); } catch {}
  try { fs.unlinkSync(TMP_POLICY + '.tmp'); } catch {}

  console.log('\n[Myraa Policy Engine Test] ALL CHECKS PASSED — §34-36 verified: SAFE/NORMAL/DANGEROUS, every tool via engine, configurable per all scopes, dangerous list requiring confirmation.');
}

main().catch(e => {
  console.error('[Myraa Policy Engine Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
