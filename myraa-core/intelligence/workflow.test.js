// Myraa Workflow Learning Test — MASTER BUILD PROMPT §31-32
// Verifies: observe repeated patterns → analyze → propose → user approves → save automation
// and §32 self-created tools: generate → validate → execute → delete/retain per policy.
// Do NOT silently create dangerous automations — DANGEROUS requires confirmation.
// Usage: node myraa-core/intelligence/workflow.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkflowLearner, WORKFLOW_STATUS, TOOL_STATUS } from './workflow.js';
import { PolicyEngine } from '../policy/engine.js';

const TMP_PATH = path.join(os.tmpdir(), `myraa-test-workflow-${Date.now()}.json`);
console.log('[Myraa Workflow Test] Starting — §31-32 Workflow Learning + Self-Created Tools');
console.log(`  Temp file: ${TMP_PATH}`);

async function main() {
  try { if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH); } catch {}
  try { if (fs.existsSync(TMP_PATH + '.tmp')) fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}

  const policy = new PolicyEngine({ filePath: TMP_PATH + '.policy', autoLoad: false, logger: { warn: () => {} } });
  try { if (fs.existsSync(TMP_PATH + '.policy')) fs.unlinkSync(TMP_PATH + '.policy'); } catch {}

  // Mock tool registry for executeAutomation tests
  const mockRegistry = {
    calls: [],
    async call(tool, args, context) {
      this.calls.push({ tool, args, context });
      // Simulate dangerous tool blocking if not confirmed?
      if (['deleteFile', 'runTerminalCommand'].includes(tool) && !context.confirmed) {
        return { ok: false, error: 'requires confirmation', needsConfirmation: true, tier: 'DANGEROUS' };
      }
      return { ok: true, result: `executed ${tool}`, tool };
    },
    get(name) { return null; },
    register(def) { this.registered = this.registered || []; this.registered.push(def); return def; },
    unregister(name) { if (this.registered) this.registered = this.registered.filter(d => d.name !== name); return true; },
  };

  // -----------------------------------------------------------------------
  // Test 1: Observe repeated patterns §31
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Observe repeated patterns §31');
  const learner = new WorkflowLearner({ filePath: TMP_PATH, policyEngine: policy, toolRegistry: mockRegistry, logger: { warn: () => {}, info: () => {} }, autoLoad: false });
  assert(learner, 'WorkflowLearner creation failed');

  const steps = [{ tool: 'readFile', args: { path: 'a.txt' } }, { tool: 'writeCodeFile', args: { path: 'b.js', content: 'hi' } }, { tool: 'openApplication', args: { name: 'notepad' } }];
  // Observe same workflow 3 times
  for (let i = 0; i < 3; i++) {
    const obs = learner.observe({ taskId: `task-${i}`, mission: 'Build project', steps, projectId: 'proj1' });
    assert(obs.ok, `observe ${i} failed: ${obs.error}`);
    assert(obs.hash, 'hash missing');
  }
  assert(learner.observations.length === 3, `should have 3 observations, got ${learner.observations.length}`);
  // Analyze should detect repeated
  const analysis = learner.analyze({ minRepeats: 3 });
  assert(analysis.ok && analysis.patterns.length >= 1, `analyze should find >=1 pattern, got ${analysis.patterns.length}`);
  const pattern = analysis.patterns[0];
  assert(pattern.repetitions === 3, `pattern repetitions should be 3, got ${pattern.repetitions}`);
  assert(pattern.confidence >= 0.5, `confidence should be >=0.5, got ${pattern.confidence}`);
  assert(pattern.hash, 'pattern hash missing');
  console.log(`  Pattern hash=${pattern.hash.slice(0,16)} reps=${pattern.repetitions} confidence=${pattern.confidence}`);

  // Different workflow should not cluster
  learner.observe({ taskId: 'other', mission: 'Other task', steps: [{ tool: 'searchWeb', args: { query: 'test' } }], projectId: 'proj1' });
  const analysis2 = learner.analyze({ minRepeats: 3 });
  // Still only one pattern with 3 reps
  assert(analysis2.patterns.length === 1, `should still have 1 pattern with minRepeats 3, got ${analysis2.patterns.length}`);
  console.log('✓ Observe & Analyze OK');

  // -----------------------------------------------------------------------
  // Test 2: Create workflow proposal §31 "Create workflow proposal"
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Create workflow proposal — present to user §31');
  const propRes = await learner.createProposalForPattern(pattern);
  assert(propRes.ok, `createProposalForPattern failed: ${propRes.error}`);
  assert(propRes.proposal.id, 'proposal id missing');
  assert(propRes.proposal.hash === pattern.hash, 'proposal hash mismatch');
  assert(propRes.proposal.description.length > 0, 'proposal description missing');
  assert(propRes.proposal.estimatedSavings, 'estimatedSavings missing');
  assert(propRes.proposal.status === WORKFLOW_STATUS.PENDING, `status should be pending, got ${propRes.proposal.status}`);
  // First proposal is SAFE/NORMAL (readFile, writeCodeFile are SAFE/NORMAL) — should not require confirmation
  assert(propRes.proposal.riskTier === 'SAFE' || propRes.proposal.riskTier === 'NORMAL', `riskTier should be SAFE/NORMAL, got ${propRes.proposal.riskTier}`);
  console.log(`  Proposal id=${propRes.proposal.id} riskTier=${propRes.proposal.riskTier} requiresConfirm=${propRes.proposal.requiresConfirmation}`);

  // Duplicate for same hash should return existing (handle auto-creation race from observe)
  // If propRes was already a duplicate (auto-created), then first call returned existing; second duplicate should still match
  const beforeDupCount = learner.listProposals().total;
  const dup = await learner.createProposalForPattern(pattern);
  assert(dup.ok, `duplicate call should succeed: ${dup.error}`);
  // It should be marked duplicate and not increase total count beyond beforeDupCount
  assert(dup.duplicate === true || dup.proposal.id === propRes.proposal.id, 'duplicate should return existing proposal');
  const afterDupCount = learner.listProposals().total;
  assert(afterDupCount === beforeDupCount, `duplicate should not increase proposal count, before ${beforeDupCount} after ${afterDupCount}`);
  // The proposal id should match one of the existing pending proposals for that hash
  const dupCheck = learner.listProposals().proposals.find(p => p.hash === pattern.hash);
  assert(dupCheck, 'should have proposal for hash after duplicate check');

  // Manual proposal via steps (new hash)
  const manualProp = await learner.createProposal({ steps: [{ tool: 'listFiles', args: { path: '.' } }], description: 'Manual test' });
  assert(manualProp.ok, 'manual createProposal failed');
  console.log('✓ Create proposal OK');

  // -----------------------------------------------------------------------
  // Test 3: Approve workflow — save automation §31 "User approves → Save automation"
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Approve proposal → save automation §31');
  const approveRes = await learner.approveProposal(propRes.proposal.id, { approvedBy: 'test-user', confirmed: true });
  assert(approveRes.ok, `approve failed: ${JSON.stringify(approveRes).slice(0,300)}`);
  assert(approveRes.proposal.status === WORKFLOW_STATUS.APPROVED, `proposal status should be approved, got ${approveRes.proposal.status}`);
  assert(approveRes.automation, 'automation missing after approve');
  assert(approveRes.automation.proposalId === propRes.proposal.id, 'automation proposalId mismatch');
  assert(approveRes.automation.id, 'automation id missing');

  const automations = learner.listAutomations();
  assert(automations.total >= 1, `should have >=1 automation, got ${automations.total}`);
  assert(automations.automations[0].hash === pattern.hash, 'automation hash mismatch');
  console.log(`  Automation id=${approveRes.automation.id} runs=${approveRes.automation.runs}`);

  // Re-approve should be idempotent
  const reApprove = await learner.approveProposal(propRes.proposal.id, { confirmed: true });
  assert(reApprove.ok && reApprove.alreadyApproved, 're-approve should be idempotent');
  console.log('✓ Approve → automation OK');

  // -----------------------------------------------------------------------
  // Test 4: Dangerous automation NOT silent §31-32
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Dangerous automation requires confirmation — not silent §32');
  const dangerousSteps = [{ tool: 'deleteFile', args: { path: 'important.txt' } }, { tool: 'runTerminalCommand', args: { command: 'rm -rf /' } }];
  const dangObs = [];
  for (let i = 0; i < 3; i++) {
    learner.observe({ taskId: `dang-${i}`, mission: 'Dangerous workflow', steps: dangerousSteps });
  }
  const dangAnalysis = learner.analyze({ minRepeats: 3 });
  const dangPattern = dangAnalysis.patterns.find(p => p.hash.includes('deletefile') || p.steps.some(s => s.tool === 'deleteFile'));
  assert(dangPattern, 'dangerous pattern should be detected');
  const dangProp = await learner.createProposalForPattern(dangPattern);
  assert(dangProp.ok, `dangerous proposal create failed: ${dangProp.error}`);
  assert(dangProp.proposal.riskTier === 'DANGEROUS', `dangerous proposal should be DANGEROUS, got ${dangProp.proposal.riskTier}`);
  assert(dangProp.proposal.requiresConfirmation === true, 'dangerous should require confirmation');
  assert(dangProp.proposal.status === WORKFLOW_STATUS.PENDING, 'dangerous proposal should be pending, not auto-approved');

  // Try approving without confirmed — should fail
  const approveNoConfirm = await learner.approveProposal(dangProp.proposal.id, { approvedBy: 'user' });
  assert(!approveNoConfirm.ok && approveNoConfirm.needsConfirmation, `dangerous approve without confirmed should fail, got ${JSON.stringify(approveNoConfirm).slice(0,200)}`);

  // Approving with confirmed should succeed
  const approveDangerConfirmed = await learner.approveProposal(dangProp.proposal.id, { confirmed: true, approvedBy: 'user' });
  assert(approveDangerConfirmed.ok, `dangerous approve with confirmed should succeed, got ${JSON.stringify(approveDangerConfirmed).slice(0,200)}`);
  assert(approveDangerConfirmed.automation.riskTier === 'DANGEROUS', 'dangerous automation should retain DANGEROUS tier');

  // Executing dangerous automation without confirmed should be gated
  const execNoConfirm = await learner.executeAutomation(approveDangerConfirmed.automation.id, { confirmed: false });
  assert(!execNoConfirm.ok && execNoConfirm.needsConfirmation, `dangerous execute without confirmed should be gated, got ${JSON.stringify(execNoConfirm).slice(0,200)}`);

  // With confirmed, should execute
  const execWithConfirm = await learner.executeAutomation(approveDangerConfirmed.automation.id, { confirmed: true });
  assert(execWithConfirm.ok || execWithConfirm.results, `dangerous execute with confirmed should proceed, got ${JSON.stringify(execWithConfirm).slice(0,300)}`);
  console.log('✓ Dangerous automation gating OK — requires confirmation, not silent');

  // -----------------------------------------------------------------------
  // Test 5: Execute approved workflow §31 May eventually execute automatically
  // -----------------------------------------------------------------------
  console.log('\n[Test 5] Execute approved workflow — automatic within policy §31');
  // Create a safe automation (already approved first one)
  const safeAutoId = approveRes.automation.id;
  mockRegistry.calls = [];
  const execRes = await learner.executeAutomation(safeAutoId, { confirmed: true });
  assert(execRes.ok, `execute safe automation failed: ${JSON.stringify(execRes).slice(0,300)}`);
  assert(execRes.results.length === 3, `should have 3 step results, got ${execRes.results.length}`);
  assert(execRes.results.every(r => r.ok), `all steps should succeed, got ${JSON.stringify(execRes.results)}`);
  assert(mockRegistry.calls.length === 3, `registry should have been called 3 times, got ${mockRegistry.calls.length}`);
  assert(mockRegistry.calls[0].tool === 'readFile', 'first tool should be readFile');

  const autoAfterExec = learner.getAutomation(safeAutoId);
  assert(autoAfterExec.ok && autoAfterExec.automation.runs === 1, `runs should be 1 after exec, got ${autoAfterExec.automation.runs}`);
  assert(autoAfterExec.automation.lastRun, 'lastRun should be set');

  // Test autoExecute flag
  const setAuto = learner.setAutoExecute(safeAutoId, true);
  assert(setAuto.ok && setAuto.automation.auto === true, 'setAutoExecute should enable');
  // For dangerous, setAuto should be gated if config.autoExecute false
  const setAutoDanger = learner.setAutoExecute(approveDangerConfirmed.automation.id, true);
  // Should fail because config.autoExecute is false by default
  assert(!setAutoDanger.ok || setAutoDanger.automation.auto !== true, `dangerous setAuto should be gated when global autoExecute false, got ${JSON.stringify(setAutoDanger).slice(0,200)}`);
  console.log('✓ Execute automation OK — safe auto executes, dangerous gated');

  // -----------------------------------------------------------------------
  // Test 6: Self-created tools §32 — generate, validate, execute, delete/retain
  // -----------------------------------------------------------------------
  console.log('\n[Test 6] Self-created tools §32 — generate → validate → execute → delete/retain');

  // No existing converter tool -> generate controlled utility (e.g., CSV to JSON converter)
  const converterSpec = {
    name: 'csvToJson',
    description: 'Convert CSV string to JSON array',
    code: `
      // Controlled utility: csvToJson
      const lines = (args.csv || '').trim().split('\\n');
      if (!lines.length || !lines[0]) return { ok: false, error: 'empty csv' };
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => obj[h] = vals[i] || '');
        return obj;
      });
      return { ok: true, result: rows, json: JSON.stringify(rows) };
    `,
    inputSchema: { type: 'object', properties: { csv: { type: 'string' } }, required: ['csv'] },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, result: { type: 'object' } } },
  };

  const createRes = await learner.createTemporaryTool(converterSpec, { expiresInMs: 60000 });
  assert(createRes.ok, `createTemporaryTool failed: ${createRes.error}`);
  assert(createRes.tool.name === 'csvToJson', 'tool name mismatch');
  assert(createRes.tool.status === TOOL_STATUS.TEMPORARY, `status should be temporary, got ${createRes.tool.status}`);

  // Validate it
  const validateRes = await learner.validateTool('csvToJson');
  assert(validateRes.ok, `validateTool failed: ${validateRes.error}`);
  assert(validateRes.tool.status === TOOL_STATUS.VALIDATED, 'should be validated');

  // Execute it
  const execTool = await learner.executeTemporaryTool('csvToJson', { csv: 'name,age\nAlice,30\nBob,25' }, {});
  assert(execTool.ok, `executeTemporaryTool failed: ${execTool.error} ${JSON.stringify(execTool).slice(0,200)}`);
  assert(Array.isArray(execTool.result) && execTool.result.length === 2, `result should be 2 rows, got ${JSON.stringify(execTool).slice(0,200)}`);
  assert(execTool.result[0].name === 'Alice', 'first row name should be Alice');

  // After execution, temp tool should be marked DELETED per policy (default delete after exec)
  const afterExec = learner.getTool('csvToJson');
  assert(afterExec.ok && afterExec.tool.status === TOOL_STATUS.DELETED, `temp tool should be deleted after exec per §32, got ${afterExec.tool.status}`);

  // Create another temp that is persistent
  const persistentSpec = {
    name: 'tempUpper',
    description: 'Uppercase text',
    code: `return { ok: true, result: String(args.text || '').toUpperCase() };`,
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  };
  const createPersist = await learner.createTemporaryTool(persistentSpec, { persistent: true });
  assert(createPersist.ok, `create persistent temp failed: ${createPersist.error}`);
  const execPersist = await learner.executeTemporaryTool('tempUpper', { text: 'hello' }, {});
  assert(execPersist.ok && execPersist.result === 'HELLO', `persistent tool exec failed: ${JSON.stringify(execPersist).slice(0,200)}`);
  // Persistent should remain, not deleted
  const persistAfter = learner.getTool('tempUpper');
  // It may be EXECUTED status but not DELETED
  assert(persistAfter.ok && persistAfter.tool.status !== TOOL_STATUS.DELETED, `persistent tool should not be deleted, got ${persistAfter.tool.status}`);

  // Propose to retain persistent (already persistent, but test retain flow)
  const retainRes = await learner.proposePersistentTool('tempUpper', { confirmed: true });
  assert(retainRes.ok, `proposePersistentTool failed: ${retainRes.error}`);
  assert(retainRes.tool.status === TOOL_STATUS.RETAINED, `should be retained, got ${retainRes.tool.status}`);

  // Test delete
  const delRes = learner.deleteTool('tempUpper', 'test cleanup');
  assert(delRes.ok && delRes.deleted === 'tempUpper', 'deleteTool failed');
  assert(!learner.getTool('tempUpper').ok, 'tool should not exist after delete');

  console.log('✓ Self-created tools OK — generate, validate, execute, delete/retain per policy');

  // -----------------------------------------------------------------------
  // Test 7: Workflow proposal lifecycle — list, reject, stats, persistence
  // -----------------------------------------------------------------------
  console.log('\n[Test 7] Proposal lifecycle — list/reject/stats/persistence');
  // Reject a proposal
  const rejectPattern = { steps: [{ tool: 'listFiles', args: { path: '.' } }], repetitions: 3, confidence: 0.9, description: 'To reject' };
  const rejectProp = await learner.createProposal(rejectPattern);
  assert(rejectProp.ok, 'create reject proposal failed');
  const rejectRes = learner.rejectProposal(rejectProp.proposal.id, 'not needed');
  assert(rejectRes.ok && rejectRes.proposal.status === WORKFLOW_STATUS.REJECTED, 'reject failed');

  // List filters
  const pendingList = learner.listProposals({ status: WORKFLOW_STATUS.PENDING });
  assert(pendingList.ok, 'list pending failed');
  // Should have at least some pending (maybe 1 manual)
  const rejectedList = learner.listProposals({ status: WORKFLOW_STATUS.REJECTED });
  assert(rejectedList.total >= 1, `should have >=1 rejected, got ${rejectedList.total}`);

  // Stats
  const stats = learner.getStats();
  assert(stats.observations >= 7, `observations should be >=7, got ${stats.observations}`);
  assert(stats.proposals >= 3, `proposals should be >=3, got ${stats.proposals}`);
  assert(stats.automations >= 2, `automations should be >=2, got ${stats.automations}`);
  console.log(`  Stats: obs=${stats.observations} props=${stats.proposals} autos=${stats.automations} tools=${stats.tempTools}`);

  // Persistence: save and reload
  learner.save();
  assert(fs.existsSync(TMP_PATH), 'persist file should exist');
  const learner2 = new WorkflowLearner({ filePath: TMP_PATH, policyEngine: policy, toolRegistry: mockRegistry, logger: { warn: () => {}, info: () => {} } });
  const stats2 = learner2.getStats();
  assert(stats2.observations === stats.observations, `reloaded observations mismatch ${stats2.observations} vs ${stats.observations}`);
  assert(stats2.proposals === stats.proposals, 'reloaded proposals mismatch');
  assert(stats2.automations === stats.automations, 'reloaded automations mismatch');
  console.log('  Reloaded stats match');

  // Verify no secrets
  // Add a proposal with secret-like string — should be redacted
  learner.observe({ taskId: 'secret-test', mission: 'test', steps: [{ tool: 'writeCodeFile', args: { content: 'apiKey=sk-12345678901234567890' } }] });
  const secretVerify = learner.verifyNoSecrets();
  assert(secretVerify.ok, `verifyNoSecrets should pass after redaction, violations=${JSON.stringify(secretVerify.violations)}`);

  // Clear
  const clearRes = learner.clear({ proposals: true });
  assert(clearRes.ok && clearRes.cleared === 'proposals', 'clear proposals failed');
  assert(learner.proposals.length === 0, 'proposals should be empty after clear');
  learner.clear({ observations: true });
  learner.clear({ automations: true });
  learner.clear({ tools: true });
  const afterClear = learner.getStats();
  assert(afterClear.observations === 0 && afterClear.proposals === 0 && afterClear.automations === 0, 'clear all should empty');

  console.log('✓ Lifecycle, stats, persistence, secrets OK');

  // Cleanup
  learner.destroy();
  try { learner2.destroy(); } catch {}
  try { fs.unlinkSync(TMP_PATH); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.tmp'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.policy'); } catch {}
  try { fs.unlinkSync(TMP_PATH + '.policy.tmp'); } catch {}

  console.log('\n[Myraa Workflow Test] ALL CHECKS PASSED — §31-32 verified: observe→analyze→propose→approve→automate + self-created tools (validate→execute→delete/retain), dangerous not silent');
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => {
  console.error('[Myraa Workflow Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
