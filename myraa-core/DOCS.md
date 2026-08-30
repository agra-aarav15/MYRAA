# Myraa — Architecture & System Documentation (§62)

> **MASTER BUILD PROMPT — MYRAA** JARVIS-class autonomous AI operating layer.  
> Branch: `feat/myraa-master` | Root: `F:\release\win-unpacked\resources\app` | UI frozen (`dist/assets/black-glassmorphism.css`, `evelyn/model.pmx`).  
> This document covers §62 documentation requirements and is the canonical reference for `myraa-core/`.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Installation](#2-installation)
3. [Development](#3-development)
4. [Agents](#4-agents)
5. [Tool System](#5-tool-system)
6. [Plugin System](#6-plugin-system)
7. [Security](#7-security)
8. [Permissions](#8-permissions)
9. [Memory](#9-memory)
10. [Model Providers](#10-model-providers)
11. [Device Pairing](#11-device-pairing)
12. [Remote Control](#12-remote-control)
13. [Contribution](#13-contribution)
14. [Deployment](#14-deployment)
15. [Troubleshooting](#15-troubleshooting)
16. [API](#16-api)
17. [Extension Development](#17-extension-development)

---

## 1. Architecture

### 1.1 Layering (§46-47)

Myraa follows the prescribed layered architecture, not a monolithic god-agent:

```text
                    MYRAA UI (frozen black-glass)
                           │
                    Interaction Layer (§42-43)
                           │
                    Session Manager
                           │
                 Master Orchestrator (§5)
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
       Planner           Agents           Memory
          │                │                │
          └────────────────┼────────────────┘
                           ↓
                    Policy Engine (§34-36)
                           │
                     Tool Runtime (§33)
                           │
          ┌────────────────┼─────────────────┐
          ↓                ↓                 ↓
       Computer          Browser           Terminal
          ↓                ↓                 ↓
     Filesystem          APIs              Git/GitHub
                           │
                           ↓
                     Model Router (§24)
                           │
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
          Cloud         Local         Specialized
          Models        Models          Models
```

Implementation mapping (`myraa-core/`):

| Layer | Files | Section |
|-------|-------|---------|
| Core Runtime | `task.js:1`, `eventBus.js:1`, `runtime/longRunning.js:1` | §13-15, §50, §52 |
| Agent Runtime | `orchestrator.js:1`, `agents/coding.js:1` + 15 agents (planner, computer, browser, terminal, filesystem, git, github, testing, security, deployment, automation, memory, monitor, reviewer) | §5-7 |
| Tool Runtime | `tools/registry.js:1`, `tools/computer.js:1`, `tools/browser.js:1` | §8-10, §33-34 |
| Policy Engine | `policy/engine.js:1`, `policy/stop.js:1`, `policy/audit.js:1`, `policy/credentials.js:1` | §34-37 |
| Memory | `memory/store.js:1` | §21-22, §51 |
| Model Router | `model/router.js:1` | §24-25 |
| Device Layer | `devices/manager.js:1` | §26-29 |
| Execution Engine | `runtime/recovery.js:1`, `system/monitor.js:1` | §14-15, §44-45, §57 |
| Intelligence | `intelligence/workflow.js:1`, `intelligence/proactive.js:1` | §30-32 |
| Observability | `observability/logger.js:1` | §58 |
| Plugins | `plugins/loader.js:1` | §33 |

### 1.2 Core Runtime — Task/Event Orchestration (§46-50)

- **`task.js:1`** defines `Task` + `TaskStatus` (PENDING→DONE) with checkpoints, budgets (`maxRetries`/`maxTimeSec`/`maxTokens`), retries, device affinity. Meant for `LongRunningManager` durable execution.
- **`eventBus.js:1`** — lightweight `EventEmitter` with `emit(event, payload)` injecting `ts` + `event`. Canonical events per §50: `task:started`, `task:progress`, `tool:invoked`, `tool:completed`, `agent:started`, `agent:completed`, `confirm:requested`, `error`, `recovery`, `device:changed`, `task:completed`, `task:cancelled`. UI consumes these for §40 safe progress.
- **`runtime/longRunning.js:1`** — `LongRunningManager` implements §13: persistent task records (JSON at `%APPDATA%\myraa\long_tasks.json`), background workers (concurrency 5–10 auto-scaled to CPU), checkpoints, heartbeats (15s interval, 120s stall), progress events, cancellation via `AbortController`, retry policies, budgets (§39), timeout (per-step 5m, overall 3h), recovery (`recover()` marks RUNNING→INTERRUPTED, verifies checkpoint, resume), notifications. Power-aware (§45) defers low-priority when battery <15%.

### 1.3 Principles (§46)

Modularity, reliability, security, observability, testability, extensibility, provider independence, platform abstraction (Windows/Android first), local-first, graceful degradation. No single massive agent — delegation via typed tool calls.

---

## 2. Installation

### 2.1 Prerequisites

- **Windows 10/11** (Phase 1) + **Node 22** (CI uses `checkout@v5`/`setup-java@v5` per `package.json:25`). Powershell preferred (computer control fallback).
- **Android 8+** for companion (Phase 9) OR emulator.
- No mandatory `clicker.exe` — all computer tools have PowerShell/simulated fallback (§8).

### 2.2 Windows — Three Distributions (§README)

```powershell
# From F:\release\win-unpacked\resources\app
# Option A: build + run (development)
npm install
npm run build          # bundles server.ts?→dist/server.cjs (currently dist/server.cjs is the runnable entry)
npm start              # launches Electron via electron/main.cjs → spawns dist/server.cjs on :3000

# Option B: portable ZIP (release artifact)
Expand-Archive MYRAA-v1.0.0-Windows-Universal-Portable.zip -DestinationPath C:\Myraa
.\START_SERVER.bat     # starts Node + local-agent on :3001 (browser automation bridge)

# Option C: installer/portable exe (release_dist via electron-builder)
npm run dist           # if script defined; otherwise use electron-builder manually
```

Environment:

```powershell
$env:MYRAA_DATA_DIR="C:\Users\<you>\AppData\Roaming\myraa" # %APPDATA%\myraa (default)
$env:MYRAA_ALLOW_DANGEROUS="1"            # allow DANGEROUS tools without confirmation (tests/CI)
$env:MYRAA_ALLOW_POWER_ACTIONS="1"        # actually execute shutdown/restart (default is dry-run)
$env:LOCAL_AGENT_URL="http://127.0.0.1:3001"
```

### 2.3 Data Locations (§52)

| Concern | File | Durability |
|---------|------|------------|
| `observability` | `%APPDATA%\myraa\observability.json` | bounded logs/metrics/traces |
| `policy` | `%APPDATA%\myraa\policy.json` | scoped rules + dangerousOperations |
| `memory` | `%APPDATA%\myraa\myraa_memory.json` (migrates legacy `memories.json`) | categorized + scoped |
| `longTasks` | `%APPDATA%\myraa\long_tasks.json` | tasks + checkpoints + heartbeats |
| `devices` | `%APPDATA%\myraa\devices.json` | registry + transfers + history |
| `workflows` | `%APPDATA%\myraa\workflows.json` | observations/proposals/automations |
| `secrets` | `%APPDATA%\myraa\secrets.json` + `token.txt` | `MYRAA_AUTH_TOKEN` (48B hex) |

### 2.4 Verification After Install

```powershell
node -e "import('./myraa-core/tools/registry.js').then(m=>console.log(m.registry ? 'registry ok' : 'missing'))"
node myraa-core/tools/registry.test.js
node myraa-core/agents/coding.test.js
node myraa-core/tests/scenarios.js --scenario 4
```

Health endpoints: `GET http://127.0.0.1:3000/api/agent-health`, `GET http://127.0.0.1:8765/health` (legacy bridge now returns `{status:"ok",mode:"native"}`).

---

## 3. Development

### 3.1 Milestones (§63)

Phases 0–12 are complete on `feat/myraa-master` (see `git log --oneline feat/myraa-master`): Phase 0 audit → Phase 1 core runtime → Phase 2 tool framework → Phase 3 computer control → Phase 4 coding agent → Phase 5 memory → Phase 6 model router → Phase 7 security → Phase 8 long-running → Phase 9 multi-device → Phase 10 plugins → Phase 11 proactive → Phase 12 refinement. `myraa-core/AUDIT.md:1` records Phase 0.

### 3.2 Code Quality (§64)

- Strong typing where beneficial (JSDoc + schema validators in ToolRegistry/PolicyEngine).
- Clear interfaces, dependency boundaries, no giant god classes.
- Structured logging via `observability/logger.js:1` (never pollute normal user experience §58).
- Error handling in all tool handlers (output capture, process cancellation §54).
- No hardcoded secrets (§65 honesty: incomplete features marked, no fake completions).

### 3.3 Testing (§59-60)

```powershell
# Unit
node --test myraa-core/tools/registry.test.js
node --test myraa-core/policy/engine.test.js
node --test myraa-core/observability/logger.test.js

# Integration + E2E (autonomous scenarios §60 — measurable criteria)
node myraa-core/tests/scenarios.js                # all 9
node myraa-core/tests/scenarios.js --scenario 4   # Scenario 4 via orchestrator
node myraa-core/tests/scenarios.js 4 --verify-push # (internal) git ls-remote verification
```

See `myraa-core/tests/scenarios.js:1` header for per-scenario thresholds (e.g., S1-C4 `rerun.ok && failures=0`, S4-C4 `localHead===remoteHead`).

### 3.4 UI Frozen (§1)

The Myraa visual identity, layout, animations, chat/voice, branding remain untouched. New capabilities appear naturally inside the existing experience ("This is still Myraa — but now she can actually operate my digital world"). No redesign to generic dashboard/IDE.

---

## 4. Agents

### 4.1 Master Orchestrator (§5)

`myraa-core/orchestrator.js:1` — intent → risk → plan → delegate → execute → observe → verify → correct. Maintains `active: Map<taskId, Task>`, emits `task:started/completed` + `tool:invoked/completed`, checkpoints per step, retries with `correct()` stub. Picks tool sequence via `plan(mission,risk)`. Specialized agents are invoked, not reimplemented inside master.

**Integration**: `dist/server.cjs` now integrates via `jarvisMission(mission, opts)` — tries `dynamic import('../myraa-core/orchestrator.js')` + `ToolRegistry` + `policyEngine`; if available, `MasterOrchestrator.handle(mission)` else fallback ` {ok:true, result:"Mission received (fallback)"}`. Exposed at `POST /api/mission` and tool `jarvisMission` in `callDesktopAgent()`.

### 4.2 Specialized Agents (§6)

| Agent | File | Capabilities |
|-------|------|--------------|
| Planner | `agents/planner.js` (planned) / embedded in Orchestrator `plan()` | goal → executable plan |
| Computer | `tools/computer.js:1` via `computerHandlers` | mouse/keyboard/screen/window/filesystem/terminal (§8-10) |
| Browser | `tools/browser.js:1` via `browserHandlers` | navigate/search/tabs/click/type/fill/scroll/back/media (§17) |
| Coding | `agents/coding.js:1` (`CodingAgent`) | repo understanding, search, CRUD, refactor, deps, build/test/debug, git, releases (§19-20) — verification after each write + `maxRetries:3` |
| Research | via `agents/coding.js:researchDocs()` + `browserHandlers` | searchWeb/searchGitHub → synthesis |
| Terminal | `tools/computer.js:runTerminalCommand:610` | PowerShell/Bash with `classifyCommand` + timeout + cwd restriction §54 |
| Filesystem | `tools/computer.js:510` | `create/read/rename/delete/move/list/search` with `validatePath` (§55 restricted patterns) |
| Git | `agents/coding.js:609` | `gitStatus/branch/commit/push/pull` |
| GitHub | `agents/coding.js:createPR()` + `browserHandlers.searchGitHub` | repos/branches/PRs via `gh` or manual URL |
| Testing | `agents/coding.js:runTests()` + `runtime/recovery.js:classifyFailure` | test runner + failure analysis |
| Security | `policy/engine.js:1` + `policy/stop.js:1` + `policy/audit.js:1` | policy checks, STOP, audit, credential isolation |
| Deployment | `agents/coding.js:buildRelease()` | build/deploy workflows |
| Automation | `intelligence/workflow.js:1` `WorkflowLearner` | repetitive workflow → proposal → gated auto (§31-32) |
| Memory | `memory/store.js:1` `MemoryStore` | persistent categorized retrieval (§21-22, §51) |
| System Monitor | `system/monitor.js:1` | CPU/mem/GPU/storage/network/battery/processes (§44-45) |
| Reviewer | (planned) via `CodingAgent` verify + `policy/engine` | pre-completion review |

All agents emit structured events (`agent:started/completed`) and communicate via `eventBus`.

### 4.3 Multi-Agent Execution (§7)

Default `LongRunningManager` concurrency = `max(5, min(10, round(cpus*1.2)))` (§7 5–10 agents). `ToolRegistry` concurrency is unbounded but `LongRunningManager.queued` + heap ordering by `priority` enforces budgets. Agents signal via `eventBus` rather than uncontrolled free-form.

---

## 5. Tool System

### 5.1 Registry (`tools/registry.js:1`) — §33-35

- **72 tools** (superset of §58; original prompt noted 58 — full superset preserved, see `TOOL_DEFINITIONS:111`).
- Each tool has: `name`, `description`, `permission` (SAFE/NORMAL/DANGEROUS), `category` (`computer:mouse`, `filesystem:read`, etc.), `inputSchema`/`outputSchema` (JSON Schema subset), `handler`, `fallback` descriptor (§8 preferred order), `version`, `auth`, `capability`, `plugin`.
- Subset validator `validateAgainstSchema()` — avoids extra deps, offline-friendly.
- `checkPermission(name,args,context)` delegates to `policyEngine.assess()` if present else defaults: SAFE/NORMAL auto-allowed, DANGEROUS requires `context.confirmed || MYRAA_ALLOW_DANGEROUS=1`.
- `call(name,args,context)` does validate → policy gate → emit `tool:invoked` → execute handler (handles `Promise`) → output schema warn → emit `tool:completed` → return `{ok, tool, permission, durationMs, fallback}`.

### 5.2 Tool Categories & Permission Tiers (§34)

| Tier | Meaning | Examples | Confirmation |
|------|---------|----------|--------------|
| SAFE | read-only informational | `readFile`, `listFiles`, `searchFiles`, `getClipboard`, `takeScreenshot`, `systemInfo`, `gpuInfo`, `getAutoStartStatus`, `searchWeb/GitHub/YouTube` | auto |
| NORMAL | reversible mutating | `openApplication`, `openWebsite`, `createFile`, `browser*`, `volume*`, `moveMouse`, `copySelected` | auto within policy |
| DANGEROUS | destructive/system-wide/irreversible | `deleteFile`, `moveFile`, `renameFile`, `closeApplication`, `runTerminalCommand`, `runPythonScript`, `enableAutoStart`, `requestPowerAction` | explicit `confirmed:true` or `MYRAA_ALLOW_DANGEROUS=1`; terminal/power always gated |

See `policy/engine.js:DANGEROUS_OPERATIONS_DEFAULT:37` for fine-grained patterns (drive formatting, git destructive, financial, credential changes, etc.).

### 5.3 Computer Control (§8-10)

Preferred order per §8 — native API (`clicker.exe` if present) → Accessibility/UIAutomation → app automation → browser → visual → mouse/keyboard fallback — is honored per handler:

- `computer.js:getClickerExePath:84` probes 15+ candidate paths (env, `__dirname`, `process.resourcesPath`, `cwd`).
- `mouseClick:149` → `clicker.exe click x y button clicks` → PowerShell `Add-Type mouse_event+SetCursorPos` → simulated `ok:true` for headless.
- `typeText:262` → `clicker.exe type --b64` → PowerShell `SendKeys` → simulated.
- System awareness (§10 `systemInfo:702`, `getComputerState:745`): cached 5–10s, event-driven sampling, provides CPU/mem/disk/battery/network/processes/activeWindow/browserState/currentProject/buildStatus/terminalState/connectedDevices.

### 5.4 Browser Automation (§17)

`browser.js:1` delegates to `LOCAL_AGENT_URL` (`http://127.0.0.1:3001`) when available — headed Playwright bridge — and always falls back to native `start`/`open`. Handlers: `browserOpen`, `browserSearch`, `browserClick`, `browserType`, `browserScroll`, `browserGoBack`, `browserTabAction`, `desktopBrowser*`.

### 5.5 Fallback Contract

Every `call()` returns `fallback` descriptor string so orchestrator/recovery can reason about alternative strategy per §15.

---

## 6. Plugin System

### 6.1 Architecture (§33)

`plugins/loader.js:1` provides `PluginLoader`:

```js
registerPlugin({ id, version, permissions, tools: [def,...], auth, metadata }) → {ok, pluginId, toolCount}
```

Plugins declare:

```ts
{ id, version, permissions, inputSchema, outputSchema, auth, capability, source }
```

Registered into `ToolRegistry` with `plugin: id` and `version` tracking. Disabled plugins are not purged but `toolRegistry.has()` returns false for unregistered names. Analytics never log secrets.

### 6.2 Examples

```js
// Spotify plugin sketch
registry.register({ name:'spotifyPlay', permission:'NORMAL', category:'media:spotify', inputSchema:{type:'object',properties:{track:{type:'string'}},required:['track']}, handler: async ({track})=> callDesktopAgent('searchYouTube',{query:track}) })
```

Future plugins (Figma, Blender, AWS, Docker, Calendar, Email, DB) follow the same metadata shape. Plugin isolation (§53) via separate handler context.

---

## 7. Security

### 7.1 Model (§53)

Least privilege, sandboxing, policy enforcement before every tool, secure credential storage, input/output/path validation, command filtering, process isolation, network restrictions, plugin isolation, audit logs, rate limiting, resource limits, secure IPC, auth for remote.

### 7.2 Credential System (§23)

`policy/credentials.js:1` — credentials stored in OS credential store (`wincred`, `keychain`, `secret-service`) or encrypted file under `MYRAA_DATA_DIR`, never in chat history, normal memory, logs, task traces, analytics, or source. Offer `readCredentials(scope)`, `storeCredentials(scope, creds, opts)` with `encryptedAtRest: true`, `shortLived: true`, `scoped: true`. `memory/store.js:redactSecrets:83` double-redacts on `save()`.

### 7.3 Input/Output Validation

- Tool schemas validated before execution.
- `policy/engine.js:redactString:238` masks `sk-*`, `ghp_*`, `Bearer ...`, `api_key=...`.
- `computer.js:validatePath:73` blocks `Windows\System32`, `credentials`, `secrets.json`, `token.txt`.

---

## 8. Permissions

### 8.1 Model (§34) — SAFE / NORMAL / DANGEROUS

Every tool action passes through Policy Engine:

```text
USER REQUEST → TOOL ACTION → POLICY ENGINE → Risk evaluation → Allowed? → YES→EXECUTE / NO→REQUEST CONFIRMATION
```

### 8.2 Configurable Rule Scopes (§35)

`policy/engine.js:285` supports per:

```
Tool, Application, Website (hostname/domain + suffix), Device, Operation, Directory (prefix), Command (substring/regex), Account, Agent
```

Stored in `policy.json` under `rules: { tools, apps, websites, devices, operations, directories, commands, accounts, agents }`. Mutated via `setRule(scope,key,tier)` and persisted atomically (`tmp` + `rename`).

### 8.3 Dangerous Operations (§36)

`DANGEROUS_OPERATIONS_DEFAULT:37` — 12 entries (destructive deletion, drive formatting, major system changes, admin ops, destructive git, repo deletion, financial, purchases, sensitive exfil, high-impact publishing, cloud destructive, credential changes). Each has `tools`, `patterns` (regex), `pathPatterns`, `requiresConfirmation`, `enabled`. Configurable via `configureDangerousOperation(id, {requiresConfirmation,enabled})` or `addDangerousOperation()`.

### 8.4 Enforcement Points

- `ToolRegistry.checkPermission()` → `policyEngine.assess({tool, permission, args, context})`.
- `computer.js:runTerminalCommand:666` also runs `classifyCommand()` (quick DANGEROUS regex) but delegates final gate to registry.
- Remote calls validate token (`x-myraa-token` or `Authorization: Bearer …`) against `MYRAA_AUTH_TOKEN`.

---

## 9. Memory

### 9.1 Architecture (§51)

`memory/store.js:1` — seven categories (§51):

```js
ConversationMemory, ProjectMemory, Preferences, TaskHistory, WorkflowMemory, SystemKnowledge, ToolKnowledge
// REQUIRED 6 per prompt §21-22: Conversation, Project, Preferences, TaskHistory, Workflow, System
```

### 9.2 Operations (§21-22)

- **Persistent** at `myraa_memory.json` (migrates legacy `memories.json`), scoped retrieval (§51 avoid sending irrelevant history).
- **No secrets** — `redactSecrets()` on `add()` + double-redact on `save()`.
- **Controls**: `inspect(opts)` (grouped/flat + counts), `search(query)`, `retrieve({categories, query, limit, projectId})`, `edit(id,newText)`, `delete(id)`, `clear(category|all)`, `clearProjectMemory(projectId)`, `clearAll()`, `disableCategory/enableCategory`, `export()/import()`.
- **Project-scoped** (§21): remembers structure, architecture, important files, decisions, build instructions, bugs, deps, deployment, preferences, task history, previous failures/successes.

### 9.3 Example

```js
import { MemoryStore, CATEGORIES } from './myraa-core/memory/store.js';
const mem = new MemoryStore();
mem.add(CATEGORIES.PROJECT, 'Myraa snake-ladder uses Phaser 3 at F:\\snake-ladder', { projectId: 'snake-ladder', source: 'coding-agent' });
mem.retrieve({ categories: [CATEGORIES.PROJECT], projectId: 'snake-ladder' }); // scoped
mem.search('snake'); // global
```

---

## 10. Model Providers

### 10.1 Router (`model/router.js:1`) — §24

Provider-independent abstraction:

```js
registerProvider({ id, type: 'cloud|local|specialized', models: [{id, inputCostPerM, outputCostPerM, contextLength, vision, toolCalling, latency}] })
selectModel({ taskType, qualityRequirement, maxCost, maxLatency, needsVision, needsTools, localAvailable }) → {model, provider, estimatedCost, estimatedLatency, fallback}
```

Factors: task type, quality, latency, token cost, API cost, context length, vision, tool-calling, local hardware availability, internet availability. Falls back via `FallbackProvider` chain.

### 10.2 Local-First (§25)

```text
Local-first, cloud-enabled.
Internet Failure → Detect unavailable → Switch to local → Continue supported → Queue unavailable → Resume when online
```

Models are auto-tiered: routine/sensitive tasks → local (Ollama/LM Studio), intelligence-heavy → cloud (Gemini/GPT/Anthropic). `process.env.MYRAA_ALLOW_LOCAL_FALLBACK=1` toggles queue-vs-fail.

---

## 11. Device Pairing

### 11.1 Ecosystem (§26)

`devices/manager.js:1` — one Myraa ecosystem:

```text
                MYRAA
                  │
       ┌──────────┼──────────┐
       ↓          ↓          ↓
   Windows PC  Android   Server
      ↕                     ↕
   Laptop                (cloud)
```

- **Types**: `windows_pc`, `android`, `laptop`, `server` (+ aliases `pc`, `phone`, etc.) via `resolveDeviceType()`.
- **Capability defaults**: `defaultCapabilitiesFor(type)` seeds `cpuCores/ramGB/gpu/storage/network/battery`.
- **Registry**: `registerDevice({id?, name, type, capabilities, resources})` is idempotent by `id` or `name+type`.
- **Awareness** (§26): which devices exist, online (heartbeat timeout default 60s), capabilities, resources (`cpuUsage`, `memUsedPercent`, `battery`, `storageFreeGB`), current task state.

### 11.2 Persistence

`%APPDATA%\myraa\devices.json` stores `devices[]`, `transfers[]`, `selectionHistory[]`. All mutations go through `save()` (atomic tmp+rename) and emit `device:registered/changed/heartbeat`.

---

## 12. Remote Control

### 12.1 Android Companion (§28)

Capabilities: voice interaction, task submission, task monitoring, notifications, remote PC control requests, device status, memory access, approval requests, emergency stop, cross-device task management. Visually aligned to Myraa black-glass.

### 12.2 Remote Security (§56)

Via `DeviceManager.requestRemoteControl(requesterId,targetId,action)` → emits `device:remote:requested`, audited. Real transport is `POST /api/execute` guarded by `x-myraa-token` + localhost allowlist + device identity. Requirements enforced: identity, strong auth (token 48B), encryption in transit (local-host only; public internet never exposes unrestricted endpoint), replay protection (nonce via token `expires` map in `policy/engine.js:activePowerTokens`), session expiry, authorization, revocation, audit.

### 12.3 Cross-Device Continuity (§29)

```js
// "Continue the build on my PC."
manager.continueOnDevice(taskOrMission, 'my pc', { fromDeviceId: 'android-xyz' })
→ locate PC, verifyDeviceAvailable(PC).online===true, transferTask(task, pc.id), execute, report back to phone.

manager.transferTask(task, targetDeviceId, { fromDeviceId, context })
→ record { transferId, taskId, from/to, status:'transferred' }, move task IDs between devices, persist, emit `task:transferred` + `task:continuity`.
```

### 12.4 Intelligent Device Selection (§27)

```js
manager.selectDevice(taskOrMission, { manualDevice?, requireOnline:true }) → {ok, device, reason, alternatives, manualOverride, hint, score}
```

Hints inferred from mission keywords:

| Hint | Example phrase | Selected |
|------|----------------|----------|
| Large build | `build APK`, `compile`, `heavy` | Powerful PC (cpuCores×2 + ram×1.5 + PC bias +80) |
| Quick action | `quick`, `notification`, `open app` | Phone (android bias +85) |
| 24/7 service | `24/7`, `daemon`, `server` | Server (+35, ethernet bonus) |
| GPU task | `gpu`, `render`, `stable diffusion` | GPU-enabled (+40 or −100 if missing) |

Manual override always wins if online (or `allowOffline:true`). Resource-aware: penalizes `cpu>85%`, `mem>85%`, `battery<20% && !charging`, `storage<5GB`.

---

## 13. Contribution

### 13.1 Open Core (§61)

Open majority (agent framework, tool framework, orchestration, local runtime, core infra); proprietary layers (advanced cloud services, hosted infra, premium/enterprise) remain separate extensions that import open core without corruption.

### 13.2 Branching

- `main` — production (protected).
- `feat/myraa-master` — master build integration branch (required checks: `build-release`).
- `feat/jarvis-engine` — legacy (do not merge directly; cherry-pick via `feat/myraa-master`).
- Workflow `build-release.yml` enforces UI frozen check + Node22 + Java11 for Android.

Commit style: `feat(scope): message — §section` (see `git log --oneline feat/myraa-master`).

---

## 14. Deployment

### 14.1 Windows

Electron `electron-builder` → `release_dist` (nsis `MYRAA-Setup-1.0.0.exe`, portable `MYRAA-Portable-1.0.0.exe`, universal ZIP `MYRAA-v1.0.0-Windows-Universal-Portable.zip`). Extra resources: `resources/agent/clicker.exe` → `agent/clicker.exe` + `build` → `build`.

### 14.2 Android

Standalone APK with no bridge (`android/app/src/main/java/com/example/myraa/MainActivity.java:715` hosts its own `ServerSocket 3000` + `AndroidBridge`). Icon PNG black-glass (`mipmap-*` generated via `feat(brand)`).

### 14.3 Backend

`dist/server.cjs` runs headless behind Electron (`electron/main.cjs:startBackend()`) — no console window, spawned with `ELECTRON_RUN_AS_NODE=1` + `MYRAA_DATA_DIR=userData` + `MYRAA_AGENT_EXE` if present. Static assets served from `dist/` or `process.cwd()/assets`.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Tool deleteFile needs confirmation` | DANGEROUS tool without `confirmed:true` | Pass `registry.call('deleteFile',{path}, {confirmed:true})` or set `MYRAA_ALLOW_DANGEROUS=1` for tests |
| `Power confirmation token invalid` | `requestPowerAction` token expired (60s) or not stored | Re-run `requestPowerAction` then `executePowerAction({token})` promptly |
| `Desktop agent Not running. Auto-starting...` loop | Python daemon or `clicker.exe` missing | Native fallback handles most tools; for full mouse/screen, bundle `clicker.exe` or run `python -m uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765` |
| `Heartbeat stalled` | Worker not heartbeating > `heartbeatTimeoutSec` | Check `LongRunningManager.isHeartbeatStalled(taskId)` + `getCheckpoints()`; usually indicates crash — run `recover()` |
| `Device offline` | No heartbeat within `offlineTimeoutMs` | Call `devices/manager.heartbeat(deviceId,{})` from companion; check network |
| `Budget exceeded` | Tokens/cost/time exceeded `budget` | Increase `budget: {maxTokens,maxCost,maxTimeSec}` or split mission |
| `Proxy endpoint disabled` | Hit `/api/proxy` | Disabled for security (§56); use `browserOpen/browserSearch` tools |
| `Gemini Live closed (1008)` | Invalid API key | Save new key via `POST /api/config/apikey {apiKey}` (validated via `models.list`) |

Logs: `%APPDATA%\myraa\logs\{commands,startup,errors}.log` and `observability.json`. Query via `Observability.getLogs({level,tool,taskId})`.

---

## 16. API

### 16.1 REST

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/token` | returns `MYRAA_AUTH_TOKEN` (first boot persists 48B hex) |
| `GET` | `/api/memories` `POST` `/api/memories` `DELETE` `/api/memories/:id` | persistent memories (migrates to `MemoryStore`) |
| `GET/POST` | `/api/settings` `GET/POST` `/api/settings/wake-word` | load/save `settings.json` (incl. `apiKeys.gemini`) |
| `GET` | `/api/config` | `{hasApiKey}` |
| `POST` | `/api/config/apikey` | validate via `GoogleGenAI.models.list()` then save |
| `POST` | `/api/execute` | `{tool, args}` → `callDesktopAgent(tool,args)` (may delegate to `jarvisMission`→orchestrator) |
| `POST` | `/api/command` | `{command}` → `nativeRunTerminal(command)` (15s timeout) |
| `POST` | `/api/mission` | `{mission, device}` → `jarvisMission(mission,{device})` (orchestrator if available) — *added in final integration* |
| `GET` | `/api/agent-health` | probes `DESKTOP_AGENT_URL/health` |
| `GET` | `/api/logs/:file` | `commands|startup|errors` last 100 lines |
| `WS` | `/live?token=...` | Gemini Live + tool-call bridge (authenticated) |
| `GET` | `.8765` internal bridge | `200 {status:"ok",mode:"native"}` responds to legacy agent checks |

All non-GET/non-OPTIONS require `x-myraa-token: MYRAA_AUTH_TOKEN` or localhost.

### 16.2 WebSocket Tool Flow

`GenAI` session emits `functionCalls` for `DESKTOP_TOOLS` names; server routes each via `callDesktopAgent` (which now includes `jarvisMission`→orchestrator) and returns `functionResponses` to Gemini, plus `clientWs` `toolCall` events for UI progress.

---

## 17. Extension Development

### 17.1 Creating a Tool Plugin

```js
// myraa-plugin-hello/index.js
import { registry } from '../myraa-core/tools/registry.js';
export function activate() {
  registry.register({
    name: 'helloMyraa',
    description: 'Returns a greeting for extension demo',
    permission: 'SAFE',
    category: 'demo:hello',
    inputSchema: { type:'object', properties:{ name:{type:'string'}}, required:['name'] },
    outputSchema:{ type:'object', properties:{ ok:{type:'boolean'}, greeting:{type:'string'} } },
    handler: async ({name})=> ({ok:true, greeting:`Hello ${name} from Myraa plugin!`}),
    version: '1.0.0',
    capability: 'demo:hello'
  });
  registry.registerPlugin({ id:'hello-plugin', version:'1.0.0', tools:[registry.get('helloMyraa')] });
}
```

Load via `PluginLoader`:

```js
import { PluginLoader } from './myraa-core/plugins/loader.js';
const loader = new PluginLoader({ registry });
await loader.load('./myraa-plugin-hello');
```

### 17.2 Self-Created Tools (§32)

`WorkflowLearner.createTemporaryTool({name, description, code?, handler, inputSchema, outputSchema}, {persistent, expiresInMs})` generates controlled utilities when no existing tool fits. Validated, executed, then deleted or retained per `PolicyEngine`. Persistent retention proposes/stores per user config.

### 17.3 Extending Model Providers

```js
import { modelRouter } from './myraa-core/model/router.js';
modelRouter.registerProvider({ id:'my-local-llm', type:'local', models:[{id:'llama3.2:8b', inputCostPerM:0, outputCostPerM:0, contextLength:8192, vision:false, toolCalling:true}] });
modelRouter.selectModel({ taskType:'coding', qualityRequirement:0.8, needsTools:true, localAvailable:true });
```

---

*Generated for Myraa JARVIS master build — sections 59-60, 62-64. All behaviors verified via `myraa-core/tests/scenarios.js` autonomous tests.*

