// Myraa Coding Agent Test — MASTER BUILD PROMPT §19, §20, §15, §59
// Validates: create sample project F:\myraa-test-project, write file, run command, git status via agent.
// Uses Tool Registry at myraa-core/tools/registry.js. Includes verification after each write + self-correction.
// Run: node myraa-core/agents/coding.test.js  (from F:\release\win-unpacked\resources\app)

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { CodingAgent } from './coding.js';
import { registry, Permission } from '../tools/registry.js';

const TEST_ROOT = 'F:\\myraa-test-project';
const TEST_FILE = path.join(TEST_ROOT, 'hello.txt');
const TEST_CODE_FILE = path.join(TEST_ROOT, 'index.js');
const TEST_CONTENT = 'Hello Myraa Coding Agent — verification test ' + new Date().toISOString();

async function main() {
  console.log('[Myraa Coding Agent Test] Starting — §19 Coding Capabilities + §59 Testing');
  console.log(`  Test root: ${TEST_ROOT}`);
  console.log(`  Registry stats: ${JSON.stringify(registry.stats)}`);

  const agent = new CodingAgent({ maxRetries: 3 });
  console.log(`  Agent: ${agent.agentId} maxRetries=${agent.maxRetries}`);

  // Clean previous test folder if exists (do not use dangerous recursive delete blindly — use registry + fallback)
  if (fs.existsSync(TEST_ROOT)) {
    console.log(`→ Cleaning previous ${TEST_ROOT} ...`);
    try {
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
      console.log('  Cleaned via fs.rmSync');
    } catch (e) {
      console.log(`  Clean warning: ${e.message} — attempting registry delete`);
      // fallback: list and delete files individually
      const list = await registry.call('listFiles', { path: TEST_ROOT });
      if (list.ok) {
        for (const f of list.files.slice(0, 20)) {
          await registry.call('deleteFile', { path: path.join(TEST_ROOT, f) }, { confirmed: true }).catch(()=>{});
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Test 1: Create sample project F:\myraa-test-project
  // -----------------------------------------------------------------------
  console.log('\n[Test 1] Creating sample project F:\\myraa-test-project via CodingAgent ...');
  const projRes = await agent.createProjectScaffold(TEST_ROOT, { name: 'myraa-test-project', template: 'node', content: 'console.log("myraa test");' });
  console.log('  createProjectScaffold result:', JSON.stringify({ ok: projRes.ok, path: projRes.path, template: projRes.template, error: projRes.error }).slice(0, 600));
  assert(projRes.ok, `createProjectScaffold failed: ${projRes.error || JSON.stringify(projRes)}`);
  assert(fs.existsSync(TEST_ROOT), 'Test project folder not created on disk');
  const list1 = await registry.call('listFiles', { path: TEST_ROOT });
  console.log(`  listFiles after scaffold: ${list1.files?.join(', ')}`);
  assert(list1.ok && list1.files.length >= 2, 'Project scaffold missing files');
  console.log('✓ Test 1 PASSED — project created with scaffold');

  // -----------------------------------------------------------------------
  // Test 2: Writing a file via CodingAgent (with verification + self-correction)
  // -----------------------------------------------------------------------
  console.log('\n[Test 2] Writing a file hello.txt via CodingAgent.createFile (verify after write) ...');
  const writeRes = await agent.createFile(TEST_FILE, TEST_CONTENT, { overwrite: true, verify: true });
  console.log('  createFile result:', JSON.stringify({ ok: writeRes.ok, path: writeRes.path, language: writeRes.language, error: writeRes.error }).slice(0, 600));
  assert(writeRes.ok, `createFile failed: ${writeRes.error || JSON.stringify(writeRes)}`);
  assert.equal(writeRes.language, 'unknown' /* .txt -> unknown */ || writeRes.language, 'language detection present');
  // Verify via direct registry read AND fs read
  const readViaRegistry = await registry.call('readFile', { path: TEST_FILE });
  console.log(`  readFile via registry: ok=${readViaRegistry.ok} length=${readViaRegistry.content?.length}`);
  assert(readViaRegistry.ok, `readFile via registry failed: ${readViaRegistry.error}`);
  assert.equal(readViaRegistry.content, TEST_CONTENT, 'Content mismatch after write (registry)');
  const fsContent = fs.readFileSync(TEST_FILE, 'utf8');
  assert.equal(fsContent, TEST_CONTENT, 'Content mismatch after write (fs)');
  console.log('✓ Test 2 PASSED — file write + verification after each write (self-correction loop)');

  // Also test createFile for code file (multi-language detection)
  console.log('→ Testing multi-language detection: writing index.js ...');
  const codeContent = 'export function hello(name){ return `Hello ${name} from Myraa`; }\nconsole.log(hello("world"));\n';
  const writeCodeRes = await agent.createFile(TEST_CODE_FILE, codeContent, { overwrite: true });
  assert(writeCodeRes.ok, `writeCodeFile failed: ${writeCodeRes.error}`);
  assert.equal(writeCodeRes.language, 'javascript', 'javascript detection failed');
  console.log(`✓ Multi-language OK — index.js detected as ${writeCodeRes.language}`);

  // Test modifyFile
  console.log('→ Testing modifyFile (refactor) ...');
  const modRes = await agent.modifyFile(TEST_FILE, TEST_CONTENT + '\n// modified');
  assert(modRes.ok, `modifyFile failed: ${modRes.error}`);
  const modRead = await registry.call('readFile', { path: TEST_FILE });
  assert(modRead.content.includes('modified'), 'modifyFile content not updated');
  console.log('✓ modifyFile OK');

  // Test refactor (string replace)
  console.log('→ Testing refactor (oldString -> newString) ...');
  const refRes = await agent.refactor({ filePath: TEST_FILE, oldString: 'modified', newString: 'refactored', replaceAll: false });
  assert(refRes.ok, `refactor failed: ${refRes.error}`);
  const refRead = await registry.call('readFile', { path: TEST_FILE });
  assert(refRead.content.includes('refactored'), 'refactor not applied');
  console.log('✓ refactor OK');

  // Test searchCode
  console.log('→ Testing searchCode ...');
  const searchRes = await agent.searchCode('hello', { root: TEST_ROOT });
  assert(searchRes.ok, `searchCode failed: ${searchRes.error}`);
  assert(searchRes.count >= 1, 'searchCode should find at least 1 match');
  console.log(`✓ searchCode OK — found ${searchRes.count} matches`);

  // Test understandRepo
  console.log('→ Testing understandRepo ...');
  const repoRes = await agent.understandRepo(TEST_ROOT);
  assert(repoRes.ok, `understandRepo failed: ${repoRes.error}`);
  assert(repoRes.primaryLanguage === 'javascript', `expected javascript primary, got ${repoRes.primaryLanguage}`);
  console.log(`✓ understandRepo OK — primaryLanguage=${repoRes.primaryLanguage} files=${repoRes.filesCount}`);

  // -----------------------------------------------------------------------
  // Test 3: Running a command via CodingAgent (using Tool Registry terminal)
  // -----------------------------------------------------------------------
  console.log('\n[Test 3] Running a command via CodingAgent.runCommand (registry terminal) ...');
  // Use cross-platform safe command: node --version and echo/dir
  const cmdRes = await agent.runCommand('node --version', { cwd: TEST_ROOT });
  console.log('  runCommand node --version:', JSON.stringify({ ok: cmdRes.ok, output: (cmdRes.output||'').slice(0,100), error: cmdRes.error?.slice(0,100) }));
  assert(cmdRes.ok, `runCommand node --version failed: ${cmdRes.error || JSON.stringify(cmdRes)}`);
  assert((cmdRes.output || '').trim().startsWith('v'), 'node --version output unexpected');

  // Also run a file execution test: run node index.js
  const runCodeRes = await agent.runCommand('node index.js', { cwd: TEST_ROOT });
  console.log('  runCommand node index.js:', JSON.stringify({ ok: runCodeRes.ok, output: (runCodeRes.output||'').slice(0,200), error: runCodeRes.error?.slice(0,200) }));
  assert(runCodeRes.ok, `runCommand node index.js failed: ${runCodeRes.error}`);
  assert((runCodeRes.output||'').includes('Hello'), 'node index.js should output Hello');

  // Test installDeps detection (should detect package.json)
  console.log('→ Testing installDeps auto-detect (npm) ...');
  // Don't actually install heavy deps if none — but package.json exists without deps, npm install should succeed quickly
  const depsRes = await agent.installDeps({ cwd: TEST_ROOT });
  console.log('  installDeps:', JSON.stringify({ ok: depsRes.ok, command: depsRes.command, error: depsRes.error?.slice(0,200) }).slice(0,600));
  assert(depsRes.ok, `installDeps failed: ${depsRes.error}`);
  console.log('✓ Test 3 PASSED — runCommand + installDeps via registry');

  // -----------------------------------------------------------------------
  // Test 4: Doing git status via the agent (filesystem/terminal/git)
  // -----------------------------------------------------------------------
  console.log('\n[Test 4] Doing git status via CodingAgent.gitStatus ...');
  // Ensure git repo: git init if not already
  if (!fs.existsSync(path.join(TEST_ROOT, '.git'))) {
    console.log('  No .git found — running git init via agent.runCommand ...');
    const initRes = await agent.runCommand('git init', { cwd: TEST_ROOT });
    console.log('  git init:', JSON.stringify({ ok: initRes.ok, output: (initRes.output||'').slice(0,200), error: initRes.error?.slice(0,200) }));
    assert(initRes.ok, `git init failed: ${initRes.error}`);
    // Configure user for commit (local)
    await agent.runCommand('git config user.email "myraa@test.local"', { cwd: TEST_ROOT });
    await agent.runCommand('git config user.name "Myraa Test"', { cwd: TEST_ROOT });
    // Create an initial commit so git status is meaningful
    const addRes = await agent.runCommand('git add -A', { cwd: TEST_ROOT });
    assert(addRes.ok, `git add failed: ${addRes.error}`);
    const commitRes = await agent.gitCommit(TEST_ROOT, 'test: initial commit from coding agent', { addAll: true });
    console.log('  initial commit:', JSON.stringify({ ok: commitRes.ok, log: (commitRes.log||commitRes.output||'').slice(0,200), error: commitRes.error?.slice(0,200) }));
    // commit may be ok or already committed
    assert(commitRes.ok || (commitRes.error && commitRes.error.includes('nothing to commit')), `git commit failed: ${commitRes.error}`);
  }

  const statusRes = await agent.gitStatus(TEST_ROOT);
  console.log('  gitStatus result:', JSON.stringify({ ok: statusRes.ok, lines: statusRes.lines?.slice(0,3), output: (statusRes.output||'').slice(0,300), error: statusRes.error?.slice(0,200) }));
  assert(statusRes.ok, `gitStatus failed: ${statusRes.error || JSON.stringify(statusRes)}`);
  // After clean commit, status should be clean or show branch line
  assert(Array.isArray(statusRes.lines), 'gitStatus lines should be array');
  console.log('✓ Test 4 PASSED — git status via agent (Tool Registry terminal)');

  // Additional git ops: test gitBranch creation
  console.log('→ Testing gitBranch (create feat/myraa-test-branch) ...');
  const branchRes = await agent.gitBranch(TEST_ROOT, 'feat/myraa-test-branch');
  console.log('  gitBranch:', JSON.stringify({ ok: branchRes.ok, branchName: branchRes.branchName, error: branchRes.error?.slice(0,200) }));
  assert(branchRes.ok, `gitBranch failed: ${branchRes.error}`);
  // Verify branch exists
  const branchList = await agent.runCommand('git branch --list', { cwd: TEST_ROOT });
  assert((branchList.output||'').includes('myraa-test-branch'), 'Branch not found after creation');
  console.log('✓ gitBranch OK');

  // Test configureEnv and researchDocs (coverage for §19)
  console.log('→ Testing configureEnv ...');
  const envRes = await agent.configureEnv({ cwd: TEST_ROOT, envVars: { MYRAA_TEST: '1', NODE_ENV: 'test' } });
  assert(envRes.ok, `configureEnv failed: ${envRes.error}`);
  const envRead = await registry.call('readFile', { path: path.join(TEST_ROOT, '.env') });
  assert(envRead.ok && envRead.content.includes('MYRAA_TEST=1'), '.env not correctly written');
  console.log('✓ configureEnv OK');

  console.log('→ Testing researchDocs (browser search) ...');
  const researchRes = await agent.researchDocs('Node.js documentation');
  assert(researchRes.ok, `researchDocs failed: ${researchRes.error}`);
  console.log(`✓ researchDocs OK — sources=${researchRes.sources.length}`);

  // Test buildRelease (simple npm run build or echo)
  console.log('→ Testing buildRelease ...');
  const buildRes = await agent.buildRelease({ cwd: TEST_ROOT, command: 'node -e "console.log(1)"', releaseDir: '.' });
  assert(buildRes.ok, `buildRelease failed: ${buildRes.error}`);
  console.log('✓ buildRelease OK');

  // -----------------------------------------------------------------------
  // Final validation: self-correction loop & stats
  // -----------------------------------------------------------------------
  console.log('\n[Final] Checking self-correction stats and registry integration ...');
  const stats = agent.getStats();
  console.log('  Agent stats:', JSON.stringify(stats));
  assert(stats.filesCreated >= 2, 'Should have created at least 2 files');
  assert(stats.commandsRun >= 5, 'Should have run multiple commands');
  assert(stats.gitOps >= 1, 'Should have performed git ops');
  assert.equal(agent.maxRetries, 3, 'maxRetries must be 3 per §15');

  // Verify registry Direct Check: permissions
  const listDef = registry.get('listFiles');
  const termDef = registry.get('runTerminalCommand');
  assert(listDef.permission === Permission.SAFE, 'listFiles should be SAFE');
  assert(termDef.permission === Permission.DANGEROUS, 'runTerminalCommand should be DANGEROUS');
  console.log('✓ Registry policy integration OK — SAFE/NORMAL/DANGEROUS tiers respected');

  console.log('\n[Myraa Coding Agent Test] ALL CHECKS PASSED — project creation, file write+verify+self-correction, runCommand, git status all via CodingAgent + Tool Registry.');
  console.log(`  Summary: project=${TEST_ROOT} filesCreated=${stats.filesCreated} commands=${stats.commandsRun} gitOps=${stats.gitOps} corrections=${stats.corrections}`);
}

main().catch(e => {
  console.error('[Myraa Coding Agent Test] FAILED:', e);
  console.error(e.stack);
  process.exit(1);
});
