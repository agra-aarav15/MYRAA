# Myraa Core — JARVIS Autonomous Operating Layer

> **Master Build — `feat/myraa-master`** | Frozen UI → backend is the transformation | `F:\release\win-unpacked\resources\app\myraa-core`

Myraa is a *personal autonomous AI operating layer* (§1). Tell her the outcome — she figures out how to accomplish it, executes, verifies, handles failures, and reports. This `myraa-core/` directory is the open core that makes that true per MASTER BUILD PROMPT §46-47.

```
MYRAA UI  →  Session  →  Master Orchestrator  →  Agents  →  Policy  →  Tool Runtime  →  Computer/Browser/Terminal  →  Model Router  →  Cloud/Local/Specialized
```

---

## Quick Start (Development)

```powershell
# From F:\release\win-unpacked\resources\app
npm install

# Verify tool runtime (72 tools, SAFE/NORMAL/DANGEROUS)
node myraa-core/tools/registry.test.js

# Verify coding agent (project scaffold + self-correction)
node myraa-core/agents/coding.test.js

# Run all autonomous scenarios §60 (measurable criteria)
node myraa-core/tests/scenarios.js
# Or lane: push-to-GitHub via orchestrator (final test §59-60)
node myraa-core/tests/scenarios.js --scenario 4
```

CI uses **Node 22** + **`@google/genai`** + **`electron@33.2.1`** — no separate Python required for the checks above (computer/browser handlers fall back to PowerShell/simulated per §8).

---

## What Lives Here

| Path | Role | § |
|------|------|---|
| `orchestrator.js` | Master Orchestrator — intent→risk→plan→delegate→execute→verify→correct | §5 (§3 loop) |
| `task.js` `eventBus.js` | Task + Event Bus — structured `task:started/tool:invoked/...` events | §13, §50 |
| `tools/registry.js` | Tool Registry — 72 tools, JSON-schema, permission tiers, fallback chain | §8-10, §33-35 |
| `tools/computer.js` | Mouse/keyboard/screen/window/filesystem/terminal + system awareness | §8-10 |
| `tools/browser.js` | Local-agent + native browser automation | §17 |
| `policy/engine.js` | Policy Engine — per-tool/app/website/device/operation/directory/command/account/agent (§35) + 12 DANGEROUS ops (§36) | §34-36 |
| `policy/stop.js` `policy/audit.js` `policy/credentials.js` | Emergency STOP, audit log, secure credential store | §37-38, §23 |
| `memory/store.js` | Categorized persistent memory (7 categories, scoped retrieval, no secrets) | §21-22, §51 |
| `model/router.js` | Provider-independent router — quality/cost/latency/vision/tools/local-vs-cloud | §24-25 |
| `devices/manager.js` | Device Network — ecosystem, intelligent selection, phone→PC continuity | §26-29 |
| `runtime/longRunning.js` | Long-running tasks — persistent records, workers (5–10), checkpoints, heartbeats, progress (§40), cancellation, budgets/timeouts, recovery | §13-15, §39-41 |
| `runtime/recovery.js` | Task resume (LOAD→RECONSTRUCT→VERIFY→RESUME) + self-correction | §14-15, §57 |
| `intelligence/workflow.js` | Workflow learning — observations → patterns → proposals (gated) → automations | §31 |
| `intelligence/proactive.js` | Proactive behavior — disk/build failure suggestions | §30 |
| `system/monitor.js` | System awareness — CPU/mem/GPU/storage/network/battery | §44-45 |
| `observability/logger.js` | Structured logs, metrics, traces, costs, perf — dev diagnostics without polluting UI | §58 |
| `plugins/loader.js` | Plugin framework — metadata/version/permissions/schemas/auth | §33 |
| `tests/scenarios.js` | **Autonomous test scenarios §60** — 9 real workflows with measurable criteria | §59-60 |
| `DOCS.md` | Architecture + installation + development + tool/plugin/security/memory/model/device/API docs | §62 |

### UI Frozen

`dist/assets/black-glassmorphism.css` `dist/index.html` `evelyn/model.pmx` never redesigned. New capabilities appear naturally inside the existing Myraa chat/voice experience.

---

## The 9 Autonomous Scenarios (§60)

Run via `node myraa-core/tests/scenarios.js`:

1. **Open my project, run tests, fix the failing tests, and report the result.** — scaffold → `node --test` fail → `refactor` fix → rerun → `REPORT.md`.
2. **Research this topic and create a report.** — `searchWeb/GitHub` → synthesize `research-report.md` (≥500 chars, ≥1 citation).
3. **Build an application, test it, and package it.** — scaffold → `node build.js` → `node --test` → artifact `dist.txt`.
4. **Push the finished project to GitHub.** — `git init` → `add` → `commit` → `push` (to isolated bare remote by default) → `rev-parse HEAD === ls-remote`. **Final test**: `node myraa-core/tests/scenarios.js --scenario 4` verifies via `MasterOrchestrator.handle("Push the finished project to GitHub")` with fallback (see `dist/server.cjs:jarvisMission`).
5. **Find the error in this build and fix it.** — intentional `ReferenceError` → `RecoveryEngine.classify` → fix → `build ok` and error absent.
6. **Continue yesterday’s unfinished task.** — `LongRunningManager` persisted yesterday task + checkpoints → `recover()` → `resume` from `INTERRUPTED` → `DONE`.
7. **From my phone, start a build on my PC.** — `DeviceManager` registers `android` + `windows_pc` → `heartbeat` → `transferTask(phone→PC)` → `LongRunningManager.runTask(build)` on PC → notification.
8. **Notice that this workflow happens every day and suggest an automation.** — `WorkflowLearner.observe×3` → `analyze` → `proposal confidence≥0.8` → `riskTier` → dangerous gated → `approve` → `automation`.
9. **Continue a three-hour task after the application restarts.** — `budget maxTimeSec=10800` → checkpoint `50%` → crash → `recover()` → `verifyLastCheckpoint valid` → `resumeSafely fromCheckpoint` → `DONE`.

Each has **measurable acceptance criteria** (e.g., `S4-C4: localHead===remoteHead`, `S1-C4: rerun.ok && failures=0`) printed as `✓/✗ S<id>-C<id>` lines. All 9 must pass for `summary.ok===true`.

See `myraa-core/tests/scenarios.js:60` for the `SCENARIOS` array and `ScenarioRunner` implementation (parallel option respects §7 concurrency).

---

## Architecture at a Glance

### Execution Loop (§3)

```text
USER REQUEST → INTENT UNDERSTANDING → CONTEXT COLLECTION → RISK ASSESSMENT → GOAL FORMULATION
→ TASK DECOMPOSITION → PLAN GENERATION → AGENT DELEGATION → TOOL SELECTION → EXECUTION
→ OBSERVATION → VERIFICATION → ERROR DETECTION → SELF-CORRECTION → FINAL VERIFICATION → USER RESULT
```

Master selects mode automatically (conversation vs. search vs. computer-control vs. coding vs. multi-agent background).

### Failure Handling (§57)

Every important failure has Detection → Classification (`FailureCategory` + `classifyFailure()`) → Recovery Strategy (`getRecoveryStrategy()`) → Fallback → Notification → State Preservation (`checkpoint()`). See `runtime/recovery.js:57`.

---

## Security & Permissions (§34-36, §53-56)

- **Every tool action** passes `PolicyEngine.assess({tool, permission, args, context})`. Tiers: `SAFE` (read-only), `NORMAL` (reversible), `DANGEROUS` (destructive — needs `confirmed:true` or `MYRAA_ALLOW_DANGEROUS=1`).
- **Dangerous ops** (delete, format, system changes, admin, destructive git, repo deletion, financial, publishing, cloud, credentials) are regex + path-pattern matched and require confirmation by default.
- **Emergency STOP**: `policy/stop.js` → `STOP` cancels active agents/tool executions, blocks new autonomous actions, preserves state.
- **Audit log**: `policy/audit.js` records timestamp/agent/task/tool/action/result/permission/confirmation/device/error — never secrets.
- **Filesystem** restricted (§55) — `computer.js:validatePath` blocks `Windows\System32`, `credentials`, `token.txt`.
- **Credentials** isolated (§23) — `policy/credentials.js` uses OS keystore/encrypted storage, short-lived scoped tokens, redaction on logs.

---

## Device & Model Highlights

- **Devices**: `DeviceManager` selects execution device automatically (heavy build→PC, quick→phone, 24/7→server, GPU→GPU (§27)), but respects `opts.manualDevice` override. Cross-device continuity via `transferTask()`/`continueOnDevice()`.
- **Models**: `ModelRouter` picks `cloud` vs `local` (Ollama) vs `specialized` per quality/cost/latency/vision/tool-calling/local hardware/internet. When internet fails, switches to local and queues cloud ops (§25).
- **Proactive**: `intelligence/proactive.js` detects failed builds/disk issues/repeated workflows and proposes automations through policy.

---

## Documentation, Tests, Quality

- **DOCS.md** — full architecture, installation, development, agents, tool/plugin systems, security/permissions, memory, model providers, device pairing/remote control, contribution (open core §61), deployment, troubleshooting, API, extension dev (§62).
- **Tests** — unit + integration + e2e + security (permission bypass, command injection, path traversal) + recovery (crash/interrupted/restart) + performance (concurrent agents) per §59; autonomous scenarios per §60 via `tests/scenarios.js`.
- **Quality** (§64) — typed where beneficial, clear interfaces, no god classes, no hardcoded secrets, no fake completions (§65). Incremental milestones per §63, dev plan in `git log`.

---

## Integration: `dist/server.cjs` + Orchestrator

`dist/server.cjs:callDesktopAgent()` now handles tool `jarvisMission` (mission-driven autonomous work) via:

```js
// Lazy load myraa-core — fallback if not built
try { const {MasterOrchestrator}=await import('../myraa-core/orchestrator.js'); ... } catch { fallback }
async function jarvisMission(mission, {device}) {
  const orch = await getOrchestrator();
  if (orch) return orch.handle(mission,{device});
  return {ok:true, fallback:true, result:`Mission received (fallback): ${mission}`};
}
```

Route `POST /api/mission {mission, device}` added. Tool `DESKTOP_TOOLS` includes `jarvisMission` gated NORMAL (orchestrated) — all §34 policy still applies. If orchestrator missing, UI/server still boots (UI frozen guarantee).

---

## Contributing & Extending

- Open core stays open (§61); proprietary extensions import `myraa-core/*` without corruption.
- Add a tool: `registry.register({name, permission, category, inputSchema, handler, fallback})` then optionally `registerPlugin({id,tools})`.
- Add an agent: import `registry` + `bus` + `policyEngine`, emit `agent:started/completed`, delegate via `registry.call`.
- Self-created tools: `WorkflowLearner.createTemporaryTool({name, code/handler})` → validate → execute → delete/retain per policy (§32).

See `DOCS.md:17 Extension Development` for full plugin + temporary-tool examples.

---

*Myraa — "Tell Myraa what outcome you want. She figures out how to accomplish it, executes, verifies, handles failures, and reports."*

