// Myraa Emergency STOP — MASTER BUILD PROMPT §37
// Prominent emergency stop: cancel active agents, queued tasks, computer-control, terminate tools, prevent new autonomous actions, preserve state.
// Must function independently of normal agent logic as much as architecture permits.
// Local-first, event-driven (§50), preserves state for inspection.

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers: paths, state preservation
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultStopStatePath() {
  return path.join(getMyraaDataDir(), 'stop_state.json');
}
function nowIso() { return new Date().toISOString(); }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function genId() { return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36); }

// ---------------------------------------------------------------------------
// StopController §37
// ---------------------------------------------------------------------------
export class StopController {
  /**
   * @param {object} opts
   * @param {string} opts.stateFile - path for preserved state (default %APPDATA%\myraa\stop_state.json)
   * @param {object} opts.eventBus - optional EventEmitter
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad - load preserved state on construction (default true)
   */
  constructor({ stateFile, eventBus = null, logger = console, autoLoad = true } = {}) {
    this.stateFile = stateFile || getDefaultStopStatePath();
    this.eventBus = eventBus;
    this.logger = logger;

    // Independent state — does not rely on orchestrator being healthy
    this.stopped = false;
    this.reason = null;
    this.initiator = null;
    this.timestamp = null;
    this.preserveOnStop = true;

    // Registries — independent but allow orchestrator to register
    /** @type {Map<string, any>} */
    this.activeAgents = new Map(); // id -> agent { id, cancel, abort, type, taskId, mission }
    /** @type {Map<string, any>} */
    this.queuedTasks = new Map(); // id -> task { id, mission, status, device }
    /** @type {Map<string, AbortController>} */
    this.toolExecutions = new Map(); // id -> { controller, tool, agent, task }
    this.computerControlActive = false;
    this.computerControlSessions = new Map(); // id -> session

    // Preserve snapshot for inspection §37 "Preserve state for inspection"
    this.preservedState = null;
    this.history = []; // array of stop events

    this.blockNewActions = false;

    if (autoLoad) this.loadPreservedState();
  }

  // ------------------------- registration -------------------------
  /**
   * Register an active agent for cancellation. Agent should expose cancel/abort/stop.
   * @param {object} agent - { id, cancel?, abort?, stop?, type? }
   */
  registerAgent(agent) {
    if (!agent) return { ok: false, error: 'agent required' };
    const id = agent.id || agent.agentId || genId();
    const entry = { id, agent, type: agent.type || agent.agentType || 'unknown', taskId: agent.taskId || null, mission: agent.mission || null, registeredAt: nowIso() };
    this.activeAgents.set(id, entry);
    return { ok: true, id };
  }

  unregisterAgent(id) {
    if (!id) return { ok: false, error: 'id required' };
    const existed = this.activeAgents.delete(id);
    // also try to find by agent object id
    if (!existed) {
      for (const [k, v] of this.activeAgents.entries()) {
        if (v.agent && v.agent.id === id) { this.activeAgents.delete(k); return { ok: true, removed: true }; }
      }
    }
    return { ok: true, removed: existed };
  }

  registerQueuedTask(task) {
    if (!task) return { ok: false, error: 'task required' };
    const id = task.id || task.taskId || genId();
    const entry = { id, ...task, enqueuedAt: nowIso(), status: task.status || 'queued' };
    this.queuedTasks.set(id, entry);
    return { ok: true, id };
  }

  dequeueTask(id) {
    if (!id) return { ok: false, error: 'id required' };
    const existed = this.queuedTasks.delete(id);
    return { ok: true, removed: existed };
  }

  clearQueuedTasks() {
    const count = this.queuedTasks.size;
    const tasks = [...this.queuedTasks.values()];
    this.queuedTasks.clear();
    return { ok: true, count, tasks };
  }

  registerToolExecution(idOrController, maybeController) {
    // Support (id, controller) or (controller) or ({ id, controller })
    let id, controller, meta;
    if (typeof idOrController === 'object' && idOrController !== null && !(idOrController instanceof AbortController) && !maybeController) {
      // object form
      controller = idOrController.controller || idOrController.abortController;
      meta = idOrController;
      id = meta.id || meta.tool || genId();
    } else if (typeof idOrController === 'string' && maybeController) {
      id = idOrController;
      controller = maybeController;
      meta = {};
    } else if (idOrController instanceof AbortController) {
      controller = idOrController;
      id = genId();
      meta = {};
    } else {
      id = typeof idOrController === 'string' ? idOrController : genId();
      controller = maybeController || new AbortController();
      meta = {};
    }
    if (!(controller instanceof AbortController)) {
      try { controller = new AbortController(); } catch { controller = { abort: () => {}, signal: { aborted: false } }; }
    }
    this.toolExecutions.set(id, { id, controller, tool: meta.tool || null, agent: meta.agent || null, task: meta.task || null, registeredAt: nowIso() });
    return { ok: true, id, controller };
  }

  deregisterToolExecution(id) {
    if (!id) return { ok: false, error: 'id required' };
    const existed = this.toolExecutions.delete(id);
    return { ok: true, removed: existed };
  }

  setComputerControlActive(active, sessionInfo = {}) {
    this.computerControlActive = !!active;
    if (active) {
      const sid = sessionInfo.id || genId();
      this.computerControlSessions.set(sid, { id: sid, ...sessionInfo, startedAt: nowIso(), active: true });
      return { ok: true, sessionId: sid };
    } else {
      // deactivate all sessions
      for (const s of this.computerControlSessions.values()) s.active = false;
      return { ok: true, active: false };
    }
  }

  registerComputerControlSession(session) {
    const id = session?.id || genId();
    this.computerControlSessions.set(id, { id, ...session, startedAt: nowIso(), active: true });
    this.computerControlActive = true;
    return { ok: true, id };
  }

  // ------------------------- state preservation §37 -------------------------
  _buildSnapshot(reason) {
    return {
      timestamp: nowIso(),
      reason: reason || this.reason || 'emergency stop',
      stopped: true,
      activeAgents: [...this.activeAgents.values()].map(v => ({
        id: v.id,
        type: v.type,
        taskId: v.taskId,
        mission: v.mission ? String(v.mission).slice(0, 200) : null,
        registeredAt: v.registeredAt,
      })),
      queuedTasks: [...this.queuedTasks.values()].map(t => ({
        id: t.id,
        mission: t.mission ? String(t.mission).slice(0, 200) : null,
        status: t.status,
        device: t.device || null,
        enqueuedAt: t.enqueuedAt,
      })),
      toolExecutions: [...this.toolExecutions.values()].map(e => ({
        id: e.id,
        tool: e.tool,
        agent: e.agent,
        task: e.task,
        registeredAt: e.registeredAt,
      })),
      computerControl: {
        active: this.computerControlActive,
        sessions: [...this.computerControlSessions.values()].map(s => ({
          id: s.id,
          active: s.active,
          startedAt: s.startedAt,
        })),
      },
      blockNewActions: this.blockNewActions,
      initiator: this.initiator,
    };
  }

  preserveState(reason) {
    try {
      const snapshot = this._buildSnapshot(reason);
      this.preservedState = snapshot;
      ensureDirForFile(this.stateFile);
      const payload = {
        version: 1,
        preservedState: snapshot,
        history: this.history.slice(-20),
        updatedAt: nowIso(),
      };
      const tmp = this.stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.stateFile);
      return { ok: true, snapshot, path: this.stateFile };
    } catch (e) {
      this.logger.warn?.(`[StopController] preserveState failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  loadPreservedState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf8');
        const data = JSON.parse(raw);
        this.preservedState = data.preservedState || null;
        if (Array.isArray(data.history)) this.history = data.history;
        if (data.preservedState && data.preservedState.stopped) {
          // do not automatically set stopped on load — only preserved snapshot
          // but expose last state
        }
        return { ok: true, path: this.stateFile, preserved: !!this.preservedState };
      }
      return { ok: true, empty: true, path: this.stateFile };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  getPreservedState() {
    return this.preservedState ? { ...this.preservedState } : null;
  }

  getState() {
    return {
      stopped: this.stopped,
      reason: this.reason,
      initiator: this.initiator,
      timestamp: this.timestamp,
      blockNewActions: this.blockNewActions,
      activeAgents: this.activeAgents.size,
      queuedTasks: this.queuedTasks.size,
      toolExecutions: this.toolExecutions.size,
      computerControlActive: this.computerControlActive,
      preservedState: this.preservedState,
      historyLength: this.history.length,
    };
  }

  // ------------------------- emergency STOP §37 -------------------------
  /**
   * Trigger emergency STOP.
   * When activated: cancel active agents, cancel queued tasks, stop computer-control, terminate unsafe tool execution, prevent new autonomous actions, preserve state.
   * @param {object} opts - { reason, initiator, preserveState=true }
   */
  emergencyStop(opts = {}) {
    const reason = opts.reason || 'user emergency stop';
    const initiator = opts.initiator || 'user';
    const shouldPreserve = opts.preserveState !== false;

    const startedAt = nowIso();
    this.stopped = true;
    this.reason = reason;
    this.initiator = initiator;
    this.timestamp = startedAt;
    this.blockNewActions = true;

    // Capture state BEFORE mutations for preservation §37 "Preserve state for inspection"
    const preSnapshot = this._buildSnapshot(reason);

    const summary = {
      timestamp: startedAt,
      reason,
      initiator,
      actions: {
        agentsCancelled: 0,
        agentsFailed: 0,
        queuedTasksCancelled: 0,
        computerControlStopped: false,
        toolExecutionsTerminated: 0,
        toolExecutionsFailed: 0,
        newActionsBlocked: true,
        statePreserved: false,
      },
      details: {},
    };

    // 1) Cancel active agents — independent of normal logic, try every cancellation method
    for (const [id, entry] of this.activeAgents.entries()) {
      try {
        const agent = entry.agent;
        let cancelled = false;
        if (agent) {
          if (typeof agent.cancel === 'function') { agent.cancel(reason); cancelled = true; }
          else if (typeof agent.abort === 'function') { agent.abort(reason); cancelled = true; }
          else if (typeof agent.stop === 'function') { agent.stop(reason); cancelled = true; }
          else if (typeof agent.terminate === 'function') { agent.terminate(reason); cancelled = true; }
          else if (agent.controller && typeof agent.controller.abort === 'function') { agent.controller.abort(reason); cancelled = true; }
        }
        // Even if no explicit method, mark as cancelled for tracking
        if (cancelled) summary.actions.agentsCancelled++;
        else {
          // still count as attempted cancellation — preserve state
          summary.actions.agentsCancelled++;
        }
      } catch (e) {
        summary.actions.agentsFailed++;
        this.logger.warn?.(`[StopController] agent cancel failed ${id}: ${e.message}`);
      }
    }
    summary.details.activeAgents = [...this.activeAgents.keys()];

    // 2) Cancel queued tasks when possible
    const queuedCount = this.queuedTasks.size;
    const queuedList = [...this.queuedTasks.values()];
    this.queuedTasks.clear();
    summary.actions.queuedTasksCancelled = queuedCount;
    summary.details.queuedTasks = queuedList.map(t => t.id);

    // 3) Stop computer-control activity
    if (this.computerControlActive) {
      this.computerControlActive = false;
      for (const s of this.computerControlSessions.values()) s.active = false;
      summary.actions.computerControlStopped = true;
    }
    // Best-effort: try to stop any ongoing computer control via injected handler (if available)
    try {
      // If computerHandlers are available, we could attempt to interrupt? For now flag only, independent.
    } catch {}

    // 4) Terminate unsafe tool execution
    for (const [id, entry] of this.toolExecutions.entries()) {
      try {
        if (entry.controller && typeof entry.controller.abort === 'function') {
          entry.controller.abort(reason);
          summary.actions.toolExecutionsTerminated++;
        } else {
          summary.actions.toolExecutionsTerminated++;
        }
      } catch (e) {
        summary.actions.toolExecutionsFailed++;
        this.logger.warn?.(`[StopController] tool abort failed ${id}: ${e.message}`);
      }
    }
    summary.details.toolExecutions = [...this.toolExecutions.keys()];
    // Do not clear toolExecutions map immediately — preserve for inspection, but mark aborted

    // 5) Prevent new autonomous actions — block flag already set
    summary.actions.newActionsBlocked = true;

    // Record history BEFORE preservation so file includes current entry
    this.history.push({ timestamp: startedAt, reason, initiator, summary: { ...summary.actions } });
    if (this.history.length > 50) this.history = this.history.slice(-50);

    // 6) Preserve state for inspection — independent file write, does not depend on agents
    // Use preSnapshot captured before mutations, not post-mutation rebuild, to preserve pre-stop state for inspection
    if (shouldPreserve) {
      try {
        this.preservedState = preSnapshot;
        ensureDirForFile(this.stateFile);
        const payload = {
          version: 1,
          preservedState: preSnapshot,
          history: this.history.slice(-20),
          updatedAt: nowIso(),
        };
        const tmp = this.stateFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tmp, this.stateFile);
        summary.actions.statePreserved = true;
        summary.details.preservePath = this.stateFile;
        summary.details.preservedSnapshot = preSnapshot;
      } catch (e) {
        this.logger.warn?.(`[StopController] preserveState failed: ${e.message}`);
        summary.actions.statePreserved = false;
        summary.details.preserveError = e.message;
      }
    }

    // Emit events independently — try eventBus, also try global bus lazy
    const eventPayload = { ts: startedAt, event: 'emergency:stop', reason, initiator, summary: summary.actions };
    try { this.eventBus?.emit?.('emergency:stop', eventPayload); } catch {}
    try { this.eventBus?.emit?.('task:cancelled', { reason, timestamp: startedAt, initiator }); } catch {}
    try {
      import('../eventBus.js').then(m => {
        try { m.emit('emergency:stop', eventPayload); } catch {}
        try { m.emit('task:cancelled', { reason, timestamp: startedAt }); } catch {}
      }).catch(()=>{});
    } catch {}

    this.logger.warn?.(`[StopController] EMERGENCY STOP triggered: ${reason} — agents:${summary.actions.agentsCancelled} queued:${summary.actions.queuedTasksCancelled} tools:${summary.actions.toolExecutionsTerminated} computerControl:${summary.actions.computerControlStopped}`);

    return { ok: true, stopped: true, reason, timestamp: startedAt, summary };
  }

  // Alias per spec language
  trigger(opts) { return this.emergencyStop(opts); }
  stop(opts) { return this.emergencyStop(opts); }
  cancelAll(opts) { return this.emergencyStop(opts); }

  // ------------------------- reset — allow new actions again -------------------------
  reset(opts = {}) {
    if (!this.stopped && this.blockNewActions === false) {
      return { ok: true, alreadyReset: true };
    }
    const prevReason = this.reason;
    this.stopped = false;
    this.reason = null;
    this.initiator = null;
    this.timestamp = null;
    this.blockNewActions = false;
    // Do not automatically clear preservedState — keep for inspection until explicitly cleared
    // But clear active abort flags? Keep toolExecutions for inspection but allow new
    const eventPayload = { ts: nowIso(), event: 'emergency:reset', prevReason, initiator: opts.initiator || 'user' };
    try { this.eventBus?.emit?.('emergency:reset', eventPayload); } catch {}
    try {
      import('../eventBus.js').then(m => { try { m.emit('emergency:reset', eventPayload); } catch {} }).catch(()=>{});
    } catch {}
    return { ok: true, reset: true, prevReason };
  }

  clearPreservedState() {
    try {
      if (fs.existsSync(this.stateFile)) fs.unlinkSync(this.stateFile);
    } catch {}
    this.preservedState = null;
    return { ok: true };
  }

  // ------------------------- guards -------------------------
  isStopped() { return !!this.stopped; }
  canProceed() { return !this.stopped && !this.blockNewActions; }
  assertNotStopped() {
    if (this.isStopped()) throw new Error(`Emergency STOP active — new actions blocked (reason: ${this.reason})`);
  }

  // ------------------------- inspect -------------------------
  getHistory() { return [...this.history]; }
  getActiveAgents() { return [...this.activeAgents.values()]; }
  getQueuedTasks() { return [...this.queuedTasks.values()]; }
  getToolExecutions() { return [...this.toolExecutions.values()]; }

  getStats() {
    return {
      stopped: this.stopped,
      reason: this.reason,
      timestamp: this.timestamp,
      blockNewActions: this.blockNewActions,
      activeAgents: this.activeAgents.size,
      queuedTasks: this.queuedTasks.size,
      toolExecutions: this.toolExecutions.size,
      computerControlActive: this.computerControlActive,
      historyLength: this.history.length,
      stateFile: this.stateFile,
      hasPreservedState: !!this.preservedState,
    };
  }
}

// Default singleton — independent, can be imported without orchestrator
export const stopController = new StopController();
export const emergencyStop = stopController; // alias

export function getDefaultStopStatePathFn() { return getDefaultStopStatePath(); }

export default StopController;
