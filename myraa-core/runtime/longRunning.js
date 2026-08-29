// Myraa Long-Running Tasks — MASTER BUILD PROMPT §13, §14-15, §40-45, §57
// Implements: persistent task records, background workers, checkpoints, heartbeats,
// progress events (§40-41, §50), cancellation, retry, budgets, timeout, recovery,
// notifications. Durable execution per §14: APP RESTART → LOAD → RECONSTRUCT → VERIFY → RESUME.
// Self-correction per §15 with configurable maxRetries/maxTime/maxTokens/maxRecursion.
// Power/budget aware via SystemMonitor §44-45 where available.
// Local-first, event-driven, provider-independent, persistent JSON at %APPDATA%\myraa\long_tasks.json (§52).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers: paths, ids, time
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultTasksPath() {
  return path.join(getMyraaDataDir(), 'long_tasks.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'task') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Task Status — extends myraa-core/task.js TaskStatus with long-running states
// ---------------------------------------------------------------------------
export const LongTaskStatus = Object.freeze({
  PENDING: 'pending',
  PLANNING: 'planning',
  RUNNING: 'running',
  PAUSED: 'paused',
  WAITING_CONFIRM: 'waiting_confirm',
  RETRYING: 'retrying',
  INTERRUPTED: 'interrupted',
  FAILED: 'failed',
  DONE: 'done',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
  BUDGET_EXCEEDED: 'budget_exceeded',
});

export const TaskStatus = LongTaskStatus; // alias

// ---------------------------------------------------------------------------
// Defaults per §13-15, §39, §45
// ---------------------------------------------------------------------------
export const DEFAULT_BUDGET = Object.freeze({
  maxRetries: 3,
  maxTimeSec: 10800, // 3 hours per §13 example
  maxTokens: 80000,
  maxCost: 10, // USD
  maxRecursionDepth: 10,
  maxConcurrency: 5,
});

export const DEFAULT_TIMEOUT = Object.freeze({
  timeoutSec: 10800,
  heartbeatTimeoutSec: 120, // stalled if no heartbeat 2min
  heartbeatIntervalMs: 15000,
  stepTimeoutMs: 300000, // 5 min per step default
});

export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxRetries: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
  exponential: true,
  retryableCategories: [
    'api_unavailable', 'model_unavailable', 'internet_unavailable',
    'tool_failure', 'browser_crash', 'agent_failure', 'database_failure',
    'github_failure', 'build_failure', 'resource_exhaustion', 'timeout', 'transient'
  ],
});

// ---------------------------------------------------------------------------
// Persistent Task Record helpers
// ---------------------------------------------------------------------------
function createTaskRecord({ id, mission, device = 'pc', budget = {}, timeout = {}, retryPolicy = {}, priority = 0, parentId = null, metadata = {} }) {
  const now = nowIso();
  const bid = id || genId('lr');
  return {
    id: bid,
    mission: String(mission || ''),
    device,
    priority,
    parentId,
    metadata: metadata || {},
    status: LongTaskStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    // budgets & usage §39
    budget: { ...DEFAULT_BUDGET, ...budget },
    usage: { retries: 0, tokens: 0, cost: 0, elapsedMs: 0, recursionDepth: 0, stepsCompleted: 0 },
    timeout: { ...DEFAULT_TIMEOUT, ...timeout },
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...retryPolicy },
    // durable execution §14
    checkpoints: [], // { ts, state, status, progress, usage }
    heartbeats: [], // last 20
    lastHeartbeat: null,
    heartbeatFailures: 0,
    progressEvents: [], // { ts, percent, message, step }
    progress: { percent: 0, message: 'pending', step: null, current: null },
    history: [], // status transitions
    error: null,
    result: null,
    workerId: null,
    deviceAffinity: device,
    notifications: [],
    // failure tracking §57
    failures: [], // { ts, error, category, attempt }
    // cancellation
    cancellationRequested: false,
    cancellationReason: null,
    // budget/timeout tracking
    budgetExceeded: null,
    timeoutExceeded: null,
  };
}

function pushHistory(task, from, to, reason) {
  task.history.push({ ts: nowIso(), from, to, reason: reason ? String(reason).slice(0, 300) : null });
  if (task.history.length > 100) task.history = task.history.slice(-100);
}

// ---------------------------------------------------------------------------
// LongRunningManager — §13
// ---------------------------------------------------------------------------
export class LongRunningManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (default %APPDATA%\myraa\long_tasks.json)
   * @param {object} opts.eventBus - optional external EventEmitter (myraa-core/eventBus)
   * @param {object} opts.policyEngine - optional policy engine for power actions
   * @param {object} opts.stopController - optional STOP controller §37
   * @param {object} opts.auditLogger - optional audit logger §38
   * @param {object} opts.monitor - optional SystemMonitor §44-45
   * @param {number} opts.concurrency - max concurrent workers (default 5, scales with CPU)
   * @param {number} opts.heartbeatIntervalMs
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad
   */
  constructor({ filePath, eventBus = null, policyEngine = null, stopController = null, auditLogger = null, monitor = null, concurrency = null, heartbeatIntervalMs = null, logger = console, autoLoad = true } = {}) {
    super();
    this.filePath = filePath || getDefaultTasksPath();
    this.eventBus = eventBus;
    this.policyEngine = policyEngine;
    this.stopController = stopController;
    this.auditLogger = auditLogger;
    this.monitor = monitor;
    this.logger = logger;
    this.heartbeatIntervalMs = heartbeatIntervalMs || DEFAULT_TIMEOUT.heartbeatIntervalMs;
    // concurrency: default 5, but scale to CPU if not specified (5-10 per §7)
    if (concurrency != null) this.concurrency = concurrency;
    else {
      const cpus = os.cpus()?.length || 4;
      this.concurrency = Math.max(5, Math.min(10, Math.round(cpus * 1.2)));
    }
    this.tasks = new Map(); // id -> record
    this.workers = new Map(); // id -> { controller, promise, executor }
    this.heartbeatTimers = new Map(); // id -> interval
    this.queued = []; // queue of { id, executor, opts }
    this.notificationHandlers = new Set();
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    // lazy import of global bus if not provided
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(() => {}); } catch {}

    if (autoLoad) this.load();
  }

  // ------------------------- event helpers §50 -------------------------
  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.emit(event, data); } catch {}
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    // also try dynamic import fallback (ensures UI frozen but events reach)
    try {
      import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(() => {});
    } catch {}
  }

  _audit(entry) {
    try { this.auditLogger?.log?.(entry); } catch {}
  }

  // ------------------------- persistence §52 -------------------------
  _getPersistPayload() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      tasks: [...this.tasks.values()],
      concurrency: this.concurrency,
    };
  }

  save() {
    try {
      ensureDirForFile(this.filePath);
      const payload = this._getPersistPayload();
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.updatedAt = payload.updatedAt;
      return { ok: true, path: this.filePath, count: this.tasks.size };
    } catch (e) {
      this.logger.warn?.(`[LongRunning] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this.tasks.size };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[LongRunning] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (data.concurrency) this.concurrency = data.concurrency;
    const list = Array.isArray(data.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
    this.tasks.clear();
    for (const t of list) {
      if (!t || !t.id) continue;
      // ensure defaults for older records
      const rec = {
        ...createTaskRecord({ id: t.id, mission: t.mission || '' }),
        ...t,
        budget: { ...DEFAULT_BUDGET, ...(t.budget || {}) },
        usage: { retries: 0, tokens: 0, cost: 0, elapsedMs: 0, recursionDepth: 0, stepsCompleted: 0, ...(t.usage || {}) },
        timeout: { ...DEFAULT_TIMEOUT, ...(t.timeout || {}) },
        retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(t.retryPolicy || {}) },
      };
      // Preserve checkpoints/heartbeats that may be missing in old data
      if (!Array.isArray(rec.checkpoints)) rec.checkpoints = [];
      if (!Array.isArray(rec.heartbeats)) rec.heartbeats = [];
      if (!Array.isArray(rec.progressEvents)) rec.progressEvents = [];
      if (!Array.isArray(rec.history)) rec.history = [];
      if (!Array.isArray(rec.failures)) rec.failures = [];
      this.tasks.set(rec.id, rec);
    }
  }

  // ------------------------- task records — persistent §13 -------------------------
  createTask({ mission, device, budget, timeout, retryPolicy, priority, parentId, metadata } = {}) {
    if (!mission || typeof mission !== 'string' || !mission.trim()) return { ok: false, error: 'mission is required' };
    const rec = createTaskRecord({ mission, device, budget, timeout, retryPolicy, priority, parentId, metadata });
    this.tasks.set(rec.id, rec);
    pushHistory(rec, null, rec.status, 'created');
    this.save();
    this._emit('task:started', { taskId: rec.id, mission: rec.mission, device: rec.device, budget: rec.budget });
    this._audit({ agent: 'LongRunning', task: rec.id, tool: 'createTask', action: 'createTask', result: `Created task ${rec.id}`, permission: 'NORMAL', device: rec.device });
    return { ok: true, task: { ...rec }, taskId: rec.id };
  }

  getTask(id) {
    if (!id) return { ok: false, error: 'id required' };
    const t = this.tasks.get(String(id));
    if (!t) return { ok: false, error: `Task not found: ${id}` };
    return { ok: true, task: { ...t, checkpoints: [...t.checkpoints], heartbeats: [...t.heartbeats], progressEvents: [...t.progressEvents], history: [...t.history], failures: [...t.failures] } };
  }

  // internal mutable ref (for manager internal use)
  _getMutable(id) { return this.tasks.get(String(id)) || null; }

  listTasks(filter = {}) {
    let out = [...this.tasks.values()];
    if (filter.status) {
      const s = String(filter.status).toLowerCase();
      out = out.filter(t => String(t.status).toLowerCase() === s);
    }
    if (filter.device) {
      const d = String(filter.device).toLowerCase();
      out = out.filter(t => String(t.device).toLowerCase() === d);
    }
    if (filter.parentId) out = out.filter(t => t.parentId === filter.parentId);
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter(t => new Date(t.createdAt).getTime() >= since);
    }
    // sort newest first
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, results: out.map(t => ({ ...t })), total };
  }

  updateTask(id, patch = {}) {
    const t = this._getMutable(id);
    if (!t) return { ok: false, error: `Task not found: ${id}` };
    const prevStatus = t.status;
    // allow updating budget, timeout, retryPolicy, priority, metadata, progress, usage
    if (patch.budget) t.budget = { ...t.budget, ...patch.budget };
    if (patch.timeout) t.timeout = { ...t.timeout, ...patch.timeout };
    if (patch.retryPolicy) t.retryPolicy = { ...t.retryPolicy, ...patch.retryPolicy };
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.metadata) t.metadata = { ...t.metadata, ...patch.metadata };
    if (patch.usage) t.usage = { ...t.usage, ...patch.usage };
    if (patch.progress) t.progress = { ...t.progress, ...patch.progress };
    if (patch.status && patch.status !== t.status) {
      const next = String(patch.status).toLowerCase();
      if (Object.values(LongTaskStatus).includes(next)) {
        t.status = next;
        pushHistory(t, prevStatus, next, patch.reason || 'updateTask');
        if (next === LongTaskStatus.RUNNING && !t.startedAt) t.startedAt = nowIso();
        if ([LongTaskStatus.DONE, LongTaskStatus.FAILED, LongTaskStatus.CANCELLED, LongTaskStatus.TIMEOUT, LongTaskStatus.BUDGET_EXCEEDED].includes(next) && !t.completedAt) t.completedAt = nowIso();
      }
    }
    if (patch.result !== undefined) t.result = patch.result;
    if (patch.error !== undefined) t.error = patch.error;
    t.updatedAt = nowIso();
    this.save();
    return { ok: true, task: { ...t } };
  }

  // ------------------------- checkpoints §13-14 -------------------------
  checkpoint(taskId, state, opts = {}) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const entry = {
      ts: nowIso(),
      state: state !== undefined ? JSON.parse(JSON.stringify(state ?? null)) : null,
      status: t.status,
      progress: { ...t.progress },
      usage: { ...t.usage },
      step: opts.step || t.progress.step || null,
      percent: opts.percent ?? t.progress.percent ?? 0,
      message: opts.message || t.progress.message || null,
    };
    t.checkpoints.push(entry);
    if (t.checkpoints.length > 100) t.checkpoints = t.checkpoints.slice(-100);
    t.updatedAt = nowIso();
    this.save();
    this._emit('task:checkpoint', { taskId: t.id, checkpoint: entry, count: t.checkpoints.length });
    this._audit({ agent: 'LongRunning', task: t.id, tool: 'checkpoint', action: 'checkpoint', result: `Checkpoint #${t.checkpoints.length} for ${t.id}`, device: t.device });
    return { ok: true, checkpoint: entry, count: t.checkpoints.length };
  }

  getCheckpoints(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    return { ok: true, checkpoints: [...t.checkpoints], count: t.checkpoints.length };
  }

  getLastCheckpoint(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (!t.checkpoints.length) return { ok: false, error: 'No checkpoints' };
    return { ok: true, checkpoint: { ...t.checkpoints[t.checkpoints.length - 1] } };
  }

  verifyLastCheckpoint(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (!t.checkpoints.length) return { ok: false, valid: false, reason: 'no checkpoints' };
    const last = t.checkpoints[t.checkpoints.length - 1];
    // Validate: state should be object or null, timestamp recent, status consistent
    const ageMs = Date.now() - new Date(last.ts).getTime();
    const valid = last && typeof last === 'object' && ageMs < 7 * 24 * 3600 * 1000; // within 7 days
    return { ok: true, valid, checkpoint: { ...last }, ageMs };
  }

  // ------------------------- heartbeats §13 -------------------------
  heartbeat(taskId, extra = {}) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const now = nowIso();
    t.lastHeartbeat = now;
    const entry = { ts: now, ...extra, progress: { ...t.progress }, usage: { ...t.usage } };
    t.heartbeats.push(entry);
    if (t.heartbeats.length > 20) t.heartbeats = t.heartbeats.slice(-20);
    t.heartbeatFailures = 0;
    t.updatedAt = now;
    // persist heartbeat periodically to avoid excessive IO: save every heartbeat but throttle via debounce? For now save
    this.save();
    this._emit('task:heartbeat', { taskId: t.id, heartbeat: entry });
    return { ok: true, heartbeat: entry };
  }

  startHeartbeat(taskId) {
    this.stopHeartbeat(taskId);
    const timer = setInterval(() => {
      const t = this._getMutable(taskId);
      if (!t) { this.stopHeartbeat(taskId); return; }
      if ([LongTaskStatus.DONE, LongTaskStatus.FAILED, LongTaskStatus.CANCELLED, LongTaskStatus.TIMEOUT, LongTaskStatus.BUDGET_EXCEEDED].includes(t.status)) {
        this.stopHeartbeat(taskId);
        return;
      }
      // Check heartbeat timeout: if lastHeartbeat too old, mark as stalled?
      // Emit heartbeat even if no progress: it signals worker alive
      this.heartbeat(taskId, { auto: true });
      // Check stalled: if worker not heartbeating but timer is still running, it's ok; stall detection is for recovery
    }, this.heartbeatIntervalMs);
    // Avoid blocking process exit
    if (timer.unref) timer.unref();
    this.heartbeatTimers.set(String(taskId), timer);
    return { ok: true, taskId };
  }

  stopHeartbeat(taskId) {
    const key = String(taskId);
    const timer = this.heartbeatTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(key);
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  isHeartbeatStalled(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (!t.lastHeartbeat) return { ok: true, stalled: false, reason: 'no heartbeat yet' };
    const ageMs = Date.now() - new Date(t.lastHeartbeat).getTime();
    const timeoutMs = (t.timeout.heartbeatTimeoutSec || DEFAULT_TIMEOUT.heartbeatTimeoutSec) * 1000;
    return { ok: true, stalled: ageMs > timeoutMs, ageMs, timeoutMs };
  }

  // ------------------------- progress events §13, §40 -------------------------
  /**
   * Report progress — safe execution summary per §40 (no chain-of-thought).
   * @param {string} taskId
   * @param {object} prog - { percent:0-100, message, step, current, agents, done, total }
   */
  progress(taskId, prog = {}) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const now = nowIso();
    const percent = prog.percent !== undefined ? Math.max(0, Math.min(100, Number(prog.percent))) : t.progress.percent;
    const message = prog.message ? String(prog.message).slice(0, 500) : t.progress.message;
    const step = prog.step || prog.current || t.progress.step;
    t.progress = { percent, message, step, current: prog.current || step, agents: prog.agents || null, updatedAt: now };
    const ev = { ts: now, percent, message, step, current: prog.current || null, taskId: t.id };
    t.progressEvents.push(ev);
    if (t.progressEvents.length > 200) t.progressEvents = t.progressEvents.slice(-200);
    t.updatedAt = now;
    this.save();
    this._emit('task:progress', { taskId: t.id, progress: t.progress, event: ev });
    return { ok: true, progress: { ...t.progress }, event: ev };
  }

  // ------------------------- budgets & timeout §13, §39 -------------------------
  checkBudget(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const b = t.budget;
    const u = t.usage;
    const elapsedSec = t.startedAt ? (Date.now() - new Date(t.startedAt).getTime()) / 1000 : 0;
    let exceeded = null;
    let detail = null;
    if (u.retries > b.maxRetries) { exceeded = 'maxRetries'; detail = `${u.retries} > ${b.maxRetries}`; }
    else if (elapsedSec > b.maxTimeSec) { exceeded = 'maxTimeSec'; detail = `${Math.floor(elapsedSec)}s > ${b.maxTimeSec}s`; }
    else if (u.tokens > b.maxTokens) { exceeded = 'maxTokens'; detail = `${u.tokens} > ${b.maxTokens}`; }
    else if (u.cost > b.maxCost) { exceeded = 'maxCost'; detail = `${u.cost} > ${b.maxCost}`; }
    else if (u.recursionDepth > b.maxRecursionDepth) { exceeded = 'maxRecursionDepth'; detail = `${u.recursionDepth} > ${b.maxRecursionDepth}`; }

    if (exceeded) {
      t.budgetExceeded = { field: exceeded, detail, ts: nowIso() };
      return { ok: true, exceeded: true, field: exceeded, detail, elapsedSec };
    }
    // also compute remaining
    return { ok: true, exceeded: false, remaining: {
      retries: Math.max(0, b.maxRetries - u.retries),
      timeSec: Math.max(0, b.maxTimeSec - elapsedSec),
      tokens: Math.max(0, b.maxTokens - u.tokens),
      cost: Math.max(0, b.maxCost - u.cost),
      recursion: Math.max(0, b.maxRecursionDepth - u.recursionDepth),
    }, elapsedSec };
  }

  checkTimeout(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (!t.startedAt) return { ok: true, timedOut: false, reason: 'not started' };
    const elapsedSec = (Date.now() - new Date(t.startedAt).getTime()) / 1000;
    const timeoutSec = t.timeout.timeoutSec || t.budget.maxTimeSec;
    if (elapsedSec > timeoutSec) {
      t.timeoutExceeded = { elapsedSec, timeoutSec, ts: nowIso() };
      return { ok: true, timedOut: true, elapsedSec, timeoutSec };
    }
    // heartbeat timeout
    const hb = this.isHeartbeatStalled(taskId);
    if (hb.stalled) return { ok: true, timedOut: true, reason: 'heartbeat stalled', ageMs: hb.ageMs, timeoutMs: hb.timeoutMs };
    return { ok: true, timedOut: false, elapsedSec, timeoutSec };
  }

  addUsage(taskId, delta = {}) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (delta.tokens) t.usage.tokens += Number(delta.tokens);
    if (delta.cost) t.usage.cost += Number(delta.cost);
    if (delta.recursionDepth) t.usage.recursionDepth = Math.max(t.usage.recursionDepth, Number(delta.recursionDepth));
    if (delta.stepsCompleted) t.usage.stepsCompleted += Number(delta.stepsCompleted);
    // elapsedMs computed on check, not here
    t.updatedAt = nowIso();
    this.save();
    return { ok: true, usage: { ...t.usage } };
  }

  // ------------------------- retry §15 -------------------------
  shouldRetry(taskId, error, category = 'unknown') {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const policy = t.retryPolicy;
    const budgetCheck = this.checkBudget(taskId);
    if (budgetCheck.exceeded) return { ok: true, shouldRetry: false, reason: `budget exceeded: ${budgetCheck.field}` };
    if (t.usage.retries >= policy.maxRetries) return { ok: true, shouldRetry: false, reason: `maxRetries ${policy.maxRetries} reached` };
    if (t.usage.retries >= t.budget.maxRetries) return { ok: true, shouldRetry: false, reason: `budget maxRetries ${t.budget.maxRetries} reached` };
    const retryable = policy.retryableCategories.includes(category) || policy.retryableCategories.includes('transient');
    // non-retryable categories explicitly
    const nonRetryable = ['permission_denied', 'authentication_failure', 'budget_exceeded', 'cancelled'];
    if (nonRetryable.includes(category)) return { ok: true, shouldRetry: false, reason: `non-retryable category: ${category}` };
    if (!retryable && category !== 'unknown') return { ok: true, shouldRetry: false, reason: `category ${category} not retryable` };
    // For unknown, allow retry if retries left (be lenient for transient)
    return { ok: true, shouldRetry: true, category, retries: t.usage.retries, max: policy.maxRetries };
  }

  getRetryBackoffMs(taskId, attempt = null) {
    const t = this._getMutable(taskId);
    if (!t) return 1000;
    const policy = t.retryPolicy;
    const att = attempt !== null ? attempt : t.usage.retries;
    if (!policy.exponential) return Math.min(policy.baseBackoffMs, policy.maxBackoffMs);
    const backoff = policy.baseBackoffMs * Math.pow(2, att);
    return Math.min(backoff, policy.maxBackoffMs);
  }

  // ------------------------- cancellation §37, §41 -------------------------
  async cancel(taskId, reason = 'user cancelled') {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if ([LongTaskStatus.DONE, LongTaskStatus.FAILED, LongTaskStatus.CANCELLED, LongTaskStatus.TIMEOUT, LongTaskStatus.BUDGET_EXCEEDED].includes(t.status)) {
      return { ok: false, error: `Task already terminated: ${t.status}` };
    }
    const prev = t.status;
    t.cancellationRequested = true;
    t.cancellationReason = String(reason).slice(0, 500);
    t.status = LongTaskStatus.CANCELLED;
    t.completedAt = nowIso();
    t.updatedAt = nowIso();
    pushHistory(t, prev, t.status, reason);
    // abort worker if running
    const worker = this.workers.get(String(taskId));
    if (worker && worker.controller) {
      try { worker.controller.abort(reason); } catch {}
    }
    // stop heartbeat
    this.stopHeartbeat(taskId);
    // checkpoint final state for recovery inspection
    this.checkpoint(taskId, { cancelled: true, reason }, { message: `cancelled: ${reason}` });
    this.save();
    this._emit('task:cancelled', { taskId: t.id, reason, prevStatus: prev });
    this._emit('emergency:stop', { taskId: t.id, reason: `task ${taskId} cancelled: ${reason}` });
    this._audit({ agent: 'LongRunning', task: t.id, tool: 'cancel', action: 'cancel', result: `Cancelled ${t.id}: ${reason}`, permission: 'NORMAL', device: t.device });
    this._notify(t.id, 'cancelled', `Task ${t.id} cancelled: ${reason}`);
    // dequeue if queued
    this.queued = this.queued.filter(q => q.id !== String(taskId));
    return { ok: true, taskId: t.id, status: t.status, reason };
  }

  async pause(taskId, reason = 'paused') {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (t.status !== LongTaskStatus.RUNNING && t.status !== LongTaskStatus.RETRYING) return { ok: false, error: `Can only pause RUNNING/RETRYING, current ${t.status}` };
    const prev = t.status;
    // checkpoint before pause §14, §43 interruption handling
    this.checkpoint(t.id, { pausedAt: nowIso(), reason }, { message: `pause checkpoint: ${reason}` });
    t.status = LongTaskStatus.PAUSED;
    t.updatedAt = nowIso();
    pushHistory(t, prev, t.status, reason);
    this.stopHeartbeat(taskId);
    // abort current worker but keep queued for resume
    const worker = this.workers.get(String(taskId));
    if (worker && worker.controller) {
      try { worker.controller.abort(`paused: ${reason}`); } catch {}
    }
    this.save();
    this._emit('task:paused', { taskId: t.id, reason });
    return { ok: true, taskId: t.id, status: t.status };
  }

  async resume(taskId, executor = null) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (![LongTaskStatus.PAUSED, LongTaskStatus.INTERRUPTED, LongTaskStatus.RETRYING].includes(t.status)) {
      // Also allow resuming pending that was interrupted on crash
      if (t.status !== LongTaskStatus.PENDING && t.status !== LongTaskStatus.RUNNING) {
        return { ok: false, error: `Can only resume PAUSED/INTERRUPTED/RETRYING/PENDING, current ${t.status}` };
      }
    }
    // Verify last checkpoint per §14
    const verify = this.verifyLastCheckpoint(t.id);
    if (!verify.ok || !verify.valid) {
      this.logger.warn?.(`[LongRunning] resume ${t.id} — no valid checkpoint, will restart from start (verify: ${verify.reason || 'invalid'})`);
    }
    const prev = t.status;
    t.status = LongTaskStatus.RUNNING;
    t.cancellationRequested = false;
    t.cancellationReason = null;
    if (!t.startedAt) t.startedAt = nowIso();
    t.updatedAt = nowIso();
    pushHistory(t, prev, t.status, 'resume');
    this.save();
    this._emit('task:resumed', { taskId: t.id, fromCheckpoint: verify.valid, checkpoint: verify.checkpoint || null });
    // if executor provided, re-run
    if (executor && typeof executor === 'function') {
      return this.runTask(t.id, executor);
    }
    return { ok: true, taskId: t.id, status: t.status, fromCheckpoint: verify.valid };
  }

  // ------------------------- background workers §13 -------------------------
  /**
   * Run a task with background worker. Handles heartbeats, checkpoints, budgets, timeout, retry, cancellation.
   * @param {string} taskId
   * @param {function} executor - async (ctx) => result ; ctx = { task, checkpoint, progress, heartbeat, signal, addUsage, attempt }
   * @param {object} opts - { stepTimeoutMs }
   */
  async runTask(taskId, executor, opts = {}) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    if (this.workers.has(String(taskId))) return { ok: false, error: `Task ${taskId} already running` };
    if (this.stopController?.isStopped?.()) {
      return { ok: false, error: `Emergency STOP active — cannot start ${taskId}`, blockedByStop: true };
    }
    // Check concurrency
    if (this.workers.size >= this.concurrency) {
      // queue (§39 concurrent agents)
      this.queued.push({ id: String(taskId), executor, opts, enqueuedAt: nowIso(), priority: t.priority });
      this.queued.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      this._emit('task:queued', { taskId: t.id, queued: this.queued.length, concurrency: this.concurrency });
      return { ok: true, queued: true, position: this.queued.findIndex(q => q.id === String(taskId)) + 1 };
    }
    // Power-aware adaptation §45: if battery low + not charging, defer heavy tasks
    if (this.monitor) {
      try {
        const power = await this.monitor.getPowerState?.() || await this.monitor.getBatteryInfo?.();
        // monitor may return { level, charging } or { battery: {...} }
        let level = null, charging = null;
        if (power) {
          if (power.battery) { level = power.battery.level ?? power.battery.charge; charging = power.battery.charging ?? power.battery.isCharging; }
          else { level = power.level ?? power.charge; charging = power.charging ?? power.isCharging; }
        }
        if (level !== null && level < 15 && charging === false) {
          // Battery 15% and not charging: throttle (§45 example)
          if (t.priority < 10) {
            this.logger.warn?.(`[LongRunning] Battery ${level}% not charging — deferring task ${taskId} (low priority)`);
            this.queued.push({ id: String(taskId), executor, opts, enqueuedAt: nowIso(), priority: t.priority, deferredForPower: true });
            this._emit('task:deferred', { taskId: t.id, reason: `battery ${level}% not charging`, level, charging });
            return { ok: true, queued: true, deferredForPower: true };
          }
          // high priority still runs but with throttled checkpoint interval?
        }
        // Also check CPU/memory throttling via monitor
        if (this.monitor.shouldThrottle?.()) {
          // reduce concurrency temporarily
          this.logger.warn?.(`[LongRunning] System throttling — CPU/memory high, running ${taskId} with caution`);
        }
      } catch {}
    }

    const controller = new AbortController();
    const signal = controller.signal;
    const workerId = genId('worker');
    t.workerId = workerId;
    t.status = LongTaskStatus.RUNNING;
    if (!t.startedAt) t.startedAt = nowIso();
    t.updatedAt = nowIso();
    t.cancellationRequested = false;
    pushHistory(t, LongTaskStatus.PENDING, LongTaskStatus.RUNNING, 'runTask');
    this.save();
    this.startHeartbeat(taskId);
    this._emit('task:started', { taskId: t.id, workerId, mission: t.mission });

    // Register with STOP controller for emergency stop §37
    try { this.stopController?.registerAgent?.({ id: workerId, taskId: t.id, mission: t.mission, cancel: (r) => controller.abort(r), controller }); } catch {}
    try { this.stopController?.registerToolExecution?.({ id: workerId, controller, tool: 'longRunningWorker', task: t.id }); } catch {}

    const ctx = {
      task: t,
      signal,
      checkpoint: (state, cOpts) => this.checkpoint(taskId, state, cOpts),
      progress: (prog) => this.progress(taskId, prog),
      heartbeat: (extra) => this.heartbeat(taskId, extra),
      addUsage: (delta) => this.addUsage(taskId, delta),
      getTask: () => this.getTask(taskId),
      isCancelled: () => signal.aborted || t.cancellationRequested,
    };

    let promise;
    const executeWithBudgetAndRetry = async () => {
      let attempt = 0;
      const maxAttempts = (t.retryPolicy.maxRetries || 0) + 1; // initial + retries
      let lastError = null;
      while (attempt < maxAttempts) {
        // Check budgets/timeout before attempt
        const budgetCheck = this.checkBudget(taskId);
        if (budgetCheck.exceeded) {
          const prev = t.status;
          t.status = LongTaskStatus.BUDGET_EXCEEDED;
          t.error = `Budget exceeded: ${budgetCheck.field} ${budgetCheck.detail}`;
          t.completedAt = nowIso();
          pushHistory(t, prev, t.status, t.error);
          this.save();
          this._emit('task:failed', { taskId: t.id, error: t.error, reason: 'budget_exceeded', budget: budgetCheck });
          this._notify(t.id, 'failed', t.error);
          this._audit({ agent: 'LongRunning', task: t.id, tool: 'runTask', action: 'budget_exceeded', error: t.error, device: t.device });
          return { ok: false, error: t.error, budgetExceeded: true, field: budgetCheck.field };
        }
        const timeoutCheck = this.checkTimeout(taskId);
        if (timeoutCheck.timedOut) {
          const prev = t.status;
          t.status = LongTaskStatus.TIMEOUT;
          t.error = `Timeout: ${timeoutCheck.reason || ''} elapsed ${Math.floor(timeoutCheck.elapsedSec || 0)}s > ${timeoutCheck.timeoutSec}s`;
          t.completedAt = nowIso();
          pushHistory(t, prev, t.status, t.error);
          this.save();
          this._emit('task:failed', { taskId: t.id, error: t.error, reason: 'timeout', timeout: timeoutCheck });
          this._notify(t.id, 'failed', t.error);
          return { ok: false, error: t.error, timedOut: true };
        }
        if (signal.aborted || t.cancellationRequested) {
          return { ok: false, error: `Cancelled: ${t.cancellationReason || signal.reason || 'aborted'}`, cancelled: true };
        }
        // Check STOP
        if (this.stopController?.isStopped?.()) {
          return { ok: false, error: `Emergency STOP active`, blockedByStop: true };
        }

        try {
          // Per-attempt timeout via Promise.race
          const stepTimeoutMs = opts.stepTimeoutMs || t.timeout.stepTimeoutMs || DEFAULT_TIMEOUT.stepTimeoutMs;
          let result;
          if (stepTimeoutMs && stepTimeoutMs > 0) {
            const timeoutPromise = new Promise((_, reject) => {
              const tid = setTimeout(() => reject(new Error(`Step timeout after ${stepTimeoutMs}ms`)), stepTimeoutMs);
              signal.addEventListener('abort', () => { clearTimeout(tid); reject(new Error(`Aborted: ${signal.reason || t.cancellationReason || 'cancelled'}`)); }, { once: true });
            });
            result = await Promise.race([executor(ctx, attempt), timeoutPromise]);
          } else {
            // still respect abort
            if (signal.aborted) throw new Error(`Aborted: ${signal.reason || 'cancelled'}`);
            result = await executor(ctx, attempt);
          }

          // Success — check if result indicates retry needed (e.g., { retry:true })
          if (result && result.retry === true && attempt + 1 < maxAttempts) {
            // explicit retry request from executor
            lastError = new Error(result.error || 'retry requested');
            t.usage.retries += 1;
            t.failures.push({ ts: nowIso(), error: lastError.message, category: result.category || 'transient', attempt });
            pushHistory(t, t.status, LongTaskStatus.RETRYING, lastError.message);
            t.status = LongTaskStatus.RETRYING;
            this.save();
            this._emit('task:retrying', { taskId: t.id, attempt, error: lastError.message, category: result.category });
            const backoff = this.getRetryBackoffMs(taskId, attempt);
            await sleep(backoff);
            attempt += 1;
            // reset status to running for next attempt
            t.status = LongTaskStatus.RUNNING;
            continue;
          }

          // Treat ok:false as failure for retry logic
          if (result && result.ok === false && attempt + 1 < maxAttempts) {
            lastError = new Error(result.error || 'executor returned ok:false');
            // classify
            const cat = result.category || this._classifyError(lastError.message);
            const should = this.shouldRetry(taskId, lastError, cat);
            if (should.shouldRetry) {
              t.usage.retries += 1;
              t.failures.push({ ts: nowIso(), error: lastError.message, category: cat, attempt });
              t.status = LongTaskStatus.RETRYING;
              this.save();
              this._emit('recovery', { taskId: t.id, attempt, error: lastError.message, category: cat, backoff: this.getRetryBackoffMs(taskId, attempt) });
              this._emit('task:retrying', { taskId: t.id, attempt, error: lastError.message, category: cat });
              // checkpoint failure state
              this.checkpoint(taskId, { failure: lastError.message, attempt, category: cat }, { message: `retry ${attempt+1}/${maxAttempts}: ${cat}` });
              const backoff = this.getRetryBackoffMs(taskId, attempt);
              await sleep(backoff);
              attempt += 1;
              t.status = LongTaskStatus.RUNNING;
              continue;
            }
          }

          // If we reach here, it's either success or final failure
          if (result && result.ok === false) {
            // final failure after retries exhausted or non-retryable
            const finalErr = result.error || lastError?.message || 'task failed';
            t.status = LongTaskStatus.FAILED;
            t.error = finalErr;
            t.completedAt = nowIso();
            pushHistory(t, LongTaskStatus.RUNNING, t.status, finalErr);
            this.save();
            this._emit('task:failed', { taskId: t.id, error: finalErr, result });
            this._notify(t.id, 'failed', finalErr);
            this._audit({ agent: 'LongRunning', task: t.id, tool: 'runTask', action: 'failed', error: finalErr, device: t.device });
            return { ok: false, error: finalErr, result };
          }

          // Success
          const prev = t.status;
          t.status = LongTaskStatus.DONE;
          t.result = result?.result ?? result?.output ?? result ?? 'done';
          t.completedAt = nowIso();
          // final checkpoint
          this.checkpoint(taskId, { done: true, result: t.result }, { percent: 100, message: 'completed' });
          t.progress.percent = 100;
          t.progress.message = 'completed';
          pushHistory(t, prev, t.status, 'completed');
          this.save();
          this._emit('task:completed', { taskId: t.id, result: t.result });
          this._emit('task:progress', { taskId: t.id, progress: { percent: 100, message: 'completed' } });
          this._notify(t.id, 'completed', `Task ${t.id} completed`);
          this._audit({ agent: 'LongRunning', task: t.id, tool: 'runTask', action: 'completed', result: String(t.result).slice(0, 200), device: t.device });
          return { ok: true, result: t.result, taskId: t.id };

        } catch (e) {
          lastError = e;
          const errMsg = e.message || String(e);
          const isCancelled = errMsg.toLowerCase().includes('cancelled') || errMsg.toLowerCase().includes('aborted') || signal.aborted;
          if (isCancelled) {
            // cancellation already handled via cancel()
            if (t.status !== LongTaskStatus.CANCELLED) {
              const prev = t.status;
              t.status = LongTaskStatus.CANCELLED;
              t.error = errMsg;
              t.completedAt = nowIso();
              pushHistory(t, prev, t.status, errMsg);
              this.save();
              this._emit('task:cancelled', { taskId: t.id, error: errMsg });
            }
            return { ok: false, error: errMsg, cancelled: true };
          }
          // classify and decide retry
          const cat = this._classifyError(errMsg);
          const should = this.shouldRetry(taskId, e, cat);
          if (should.shouldRetry && attempt + 1 < maxAttempts) {
            t.usage.retries += 1;
            t.failures.push({ ts: nowIso(), error: errMsg, category: cat, attempt });
            pushHistory(t, t.status, LongTaskStatus.RETRYING, `${cat}: ${errMsg.slice(0,200)}`);
            t.status = LongTaskStatus.RETRYING;
            this.save();
            this._emit('recovery', { taskId: t.id, attempt, error: errMsg, category: cat });
            this._emit('task:retrying', { taskId: t.id, attempt, error: errMsg, category: cat });
            this.checkpoint(taskId, { error: errMsg, attempt, category: cat }, { message: `retrying (${cat}): ${errMsg.slice(0,100)}` });
            const backoff = this.getRetryBackoffMs(taskId, attempt);
            await sleep(backoff);
            attempt += 1;
            t.status = LongTaskStatus.RUNNING;
            continue;
          } else {
            // final failure
            const reason = should.reason || `category ${cat} not retryable or max retries reached`;
            t.status = LongTaskStatus.FAILED;
            t.error = errMsg;
            t.completedAt = nowIso();
            pushHistory(t, LongTaskStatus.RUNNING, t.status, `${reason}: ${errMsg.slice(0,200)}`);
            this.save();
            this._emit('error', { taskId: t.id, error: errMsg, category: cat, reason });
            this._emit('task:failed', { taskId: t.id, error: errMsg, category: cat, reason });
            this._notify(t.id, 'failed', errMsg);
            this._audit({ agent: 'LongRunning', task: t.id, tool: 'runTask', action: 'failed', error: errMsg, device: t.device });
            return { ok: false, error: errMsg, category: cat, reason };
          }
        }
      }
      // Exhausted retries
      if (lastError) {
        t.status = LongTaskStatus.FAILED;
        t.error = lastError.message || String(lastError);
        t.completedAt = nowIso();
        pushHistory(t, LongTaskStatus.RUNNING, t.status, 'retries exhausted');
        this.save();
        this._emit('task:failed', { taskId: t.id, error: t.error, reason: 'retries exhausted' });
        this._notify(t.id, 'failed', t.error);
        return { ok: false, error: t.error, retriesExhausted: true };
      }
      return { ok: false, error: 'unknown failure' };
    };

    promise = executeWithBudgetAndRetry().finally(() => {
      this.stopHeartbeat(taskId);
      this.workers.delete(String(taskId));
      try { this.stopController?.unregisterAgent?.(workerId); } catch {}
      try { this.stopController?.deregisterToolExecution?.(workerId); } catch {}
      // process queue
      setImmediate(() => this._processQueue());
    });

    this.workers.set(String(taskId), { controller, promise, executor, workerId, startedAt: nowIso() });
    return promise;
  }

  _processQueue() {
    if (this.queued.length === 0) return;
    if (this.workers.size >= this.concurrency) return;
    // respect power throttling: if battery low, only run high priority
    let idx = 0;
    if (this.monitor) {
      try {
        // synchronous check if available
        const shouldThrottle = this.monitor.shouldThrottle?.();
        if (shouldThrottle) {
          // find high priority queued task
          idx = this.queued.findIndex(q => (q.priority || 0) >= 5);
          if (idx === -1) return; // defer all low priority while throttled
        }
      } catch {}
    }
    const next = this.queued.splice(idx, 1)[0];
    if (!next) return;
    this.logger.info?.(`[LongRunning] dequeuing ${next.id} (queue left ${this.queued.length})`);
    this.runTask(next.id, next.executor, next.opts).catch(() => {});
  }

  // simple error classification per §57 (mirrors recovery.js)
  _classifyError(msg) {
    const lower = String(msg).toLowerCase();
    if (/api.*unavailable|api.*timeout|fetch.*failed|econnrefused.*api/i.test(lower)) return 'api_unavailable';
    if (/model.*unavailable|model.*failed|overloaded|rate limit/i.test(lower)) return 'model_unavailable';
    if (/internet|network|offline|enotfound|econnreset|dns/i.test(lower)) return 'internet_unavailable';
    if (/resource.*exhaust|memory.*exhaust|cpu.*high|disk.*full|oom|out of memory|no space left/i.test(lower)) return 'resource_exhaustion';
    if (/browser.*crash|browser.*closed|playwright|puppeteer/i.test(lower)) return 'browser_crash';
    if (/application.*crash|app.*crash|electron.*crash/i.test(lower)) return 'application_crash';
    if (/pc.*restart|system.*restart|reboot/i.test(lower)) return 'pc_restart';
    if (/agent.*failed|agent.*error/i.test(lower)) return 'agent_failure';
    if (/database|sqlite|leveldb|storage.*failed|disk.*error|db.*fail|level.*down/i.test(lower)) return 'database_failure';
    if (/auth.*fail|unauthorized|401|403|token.*invalid|credential/i.test(lower)) return 'authentication_failure';
    if (/github.*fail|gh.*fail|git.*push.*fail/i.test(lower)) return 'github_failure';
    if (/build.*fail|compile.*fail|aapt2|gradle.*fail/i.test(lower)) return 'build_failure';
    if (/permission.*denied|blocked.*policy|needs.*confirm/i.test(lower)) return 'permission_denied';
    if (/timeout|timed out/i.test(lower)) return 'timeout';
    if (/tool.*fail|execution.*fail/i.test(lower)) return 'tool_failure';
    return 'unknown';
  }

  // ------------------------- recovery §14 -------------------------
  /**
   * Recovery on app restart: load persisted tasks, find INTERRUPTED/RUNNING/RETRYING, verify checkpoint, resume.
   * @param {function} executorFactory - (task) => executor function for that task (optional)
   */
  async recover(executorFactory = null) {
    this.load();
    const interrupted = [...this.tasks.values()].filter(t =>
      [LongTaskStatus.RUNNING, LongTaskStatus.RETRYING, LongTaskStatus.INTERRUPTED, LongTaskStatus.PAUSED].includes(t.status)
    );
    if (interrupted.length === 0) return { ok: true, recovered: 0, interrupted: 0 };
    this.logger.info?.(`[LongRunning] recover: found ${interrupted.length} interrupted tasks`);

    let recovered = 0;
    let failed = 0;
    for (const t of interrupted) {
      // Mark previously RUNNING as INTERRUPTED for tracking
      if (t.status === LongTaskStatus.RUNNING || t.status === LongTaskStatus.RETRYING) {
        const prev = t.status;
        t.status = LongTaskStatus.INTERRUPTED;
        pushHistory(t, prev, t.status, 'app restart — marked interrupted');
      }
      t.updatedAt = nowIso();
      // verify last checkpoint
      const verify = this.verifyLastCheckpoint(t.id);
      if (!verify.ok || !verify.valid) {
        this.logger.warn?.(`[LongRunning] task ${t.id} has no valid checkpoint — will require restart from zero if resumed`);
      }
      // If executorFactory provided and task not paused, attempt auto-resume for tasks that had checkpoints
      if (executorFactory && typeof executorFactory === 'function' && t.status === LongTaskStatus.INTERRUPTED) {
        // Only auto-resume if checkpoint valid or task is retryable; otherwise leave as interrupted for manual resume
        if (verify.valid) {
          try {
            const executor = executorFactory(t);
            if (executor) {
              t.status = LongTaskStatus.PENDING; // will be set to RUNNING by resume
              this.save();
              const res = await this.resume(t.id, executor);
              if (res && res.ok) recovered++;
              else failed++;
              continue;
            }
          } catch (e) {
            this.logger.warn?.(`[LongRunning] auto-resume failed for ${t.id}: ${e.message}`);
            failed++;
          }
        } else {
          // No checkpoint — not safe to auto-resume, leave interrupted
          t.error = 'No valid checkpoint — manual restart required';
          this.save();
          this._emit('task:interrupted', { taskId: t.id, reason: 'no checkpoint', verify });
        }
      }
    }
    this.save();
    this._emit('recovery', { recovered, interrupted: interrupted.length, failed });
    return { ok: true, recovered, failed, interrupted: interrupted.length, tasks: interrupted.map(t => t.id) };
  }

  // ------------------------- notifications §13 -------------------------
  onNotification(handler) {
    if (typeof handler === 'function') this.notificationHandlers.add(handler);
    return { ok: true, count: this.notificationHandlers.size };
  }

  offNotification(handler) {
    this.notificationHandlers.delete(handler);
    return { ok: true };
  }

  _notify(taskId, type, message) {
    const t = this._getMutable(taskId);
    if (!t) return;
    const note = { ts: nowIso(), taskId, type, message: String(message).slice(0, 500), mission: t.mission };
    t.notifications.push(note);
    if (t.notifications.length > 50) t.notifications = t.notifications.slice(-50);
    this._emit('notification', note);
    this._emit(`notification:${type}`, note);
    // spoken notifications hook: if eventBus has notification channel
    this._emit('task:notification', note);
    for (const h of this.notificationHandlers) {
      try { h(note); } catch {}
    }
    // also log
    this.logger.info?.(`[LongRunning][${type}] ${taskId}: ${message}`);
  }

  notify(taskId, type, message) { return this._notify(taskId, type, message); }

  // ------------------------- task control §41 -------------------------
  async pauseTask(taskId, reason) { return this.pause(taskId, reason); }
  async resumeTask(taskId, executor) { return this.resume(taskId, executor); }
  async cancelTask(taskId, reason) { return this.cancel(taskId, reason); }
  async restartTask(taskId, executor) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    // reset state but keep history and checkpoints for inspection
    t.status = LongTaskStatus.PENDING;
    t.error = null;
    t.result = null;
    t.startedAt = null;
    t.completedAt = null;
    t.cancellationRequested = false;
    t.cancellationReason = null;
    t.usage.retries = 0;
    t.progress = { percent: 0, message: 'restarting', step: null };
    pushHistory(t, LongTaskStatus.FAILED, LongTaskStatus.PENDING, 'restart');
    this.save();
    if (executor) return this.runTask(t.id, executor);
    return { ok: true, taskId: t.id, status: t.status };
  }

  // prioritize: change priority and re-sort queue
  prioritize(taskId, priority) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    t.priority = Number(priority) || 0;
    t.updatedAt = nowIso();
    // update queued entry
    const q = this.queued.find(q => q.id === String(taskId));
    if (q) q.priority = t.priority;
    this.queued.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.save();
    this._emit('task:prioritized', { taskId: t.id, priority: t.priority });
    return { ok: true, taskId: t.id, priority: t.priority };
  }

  // move task to different device (§41)
  moveTask(taskId, device) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    const prev = t.device;
    t.device = String(device);
    t.deviceAffinity = String(device);
    t.updatedAt = nowIso();
    this.save();
    this._emit('device:changed', { taskId: t.id, from: prev, to: t.device });
    this._emit('task:moved', { taskId: t.id, from: prev, to: t.device });
    return { ok: true, taskId: t.id, device: t.device, prev };
  }

  // inspect progress §40
  inspectProgress(taskId) {
    const t = this._getMutable(taskId);
    if (!t) return { ok: false, error: `Task not found: ${taskId}` };
    return {
      ok: true,
      taskId: t.id,
      mission: t.mission,
      status: t.status,
      progress: { ...t.progress },
      checkpoints: t.checkpoints.length,
      lastCheckpoint: t.checkpoints.length ? { ...t.checkpoints[t.checkpoints.length - 1] } : null,
      heartbeats: t.heartbeats.length,
      lastHeartbeat: t.lastHeartbeat,
      usage: { ...t.usage },
      budget: { ...t.budget },
      history: [...t.history].slice(-20),
      failures: [...t.failures].slice(-10),
      queued: !!this.queued.find(q => q.id === String(taskId)),
      worker: this.workers.has(String(taskId)) ? { workerId: t.workerId, running: true } : null,
    };
  }

  // ------------------------- stats & inspection -------------------------
  getStats() {
    const byStatus = {};
    for (const t of this.tasks.values()) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }
    return {
      ok: true,
      total: this.tasks.size,
      byStatus,
      running: this.workers.size,
      queued: this.queued.length,
      concurrency: this.concurrency,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      file: this.filePath,
      version: this.version,
    };
  }

  getAllTasks() { return [...this.tasks.values()].map(t => ({ ...t })); }

  clearCompleted() {
    let cleared = 0;
    for (const [id, t] of [...this.tasks.entries()]) {
      if ([LongTaskStatus.DONE, LongTaskStatus.FAILED, LongTaskStatus.CANCELLED, LongTaskStatus.TIMEOUT, LongTaskStatus.BUDGET_EXCEEDED].includes(t.status)) {
        this.tasks.delete(id);
        cleared++;
      }
    }
    if (cleared) this.save();
    return { ok: true, cleared };
  }

  clearAll() {
    const count = this.tasks.size;
    this.tasks.clear();
    this.queued = [];
    for (const tid of [...this.heartbeatTimers.keys()]) this.stopHeartbeat(tid);
    this.workers.clear();
    this.save();
    return { ok: true, cleared: count };
  }

  // cleanup: stop all timers
  destroy() {
    for (const tid of [...this.heartbeatTimers.keys()]) this.stopHeartbeat(tid);
    for (const [, w] of this.workers) try { w.controller.abort('destroy'); } catch {}
    this.workers.clear();
    this.queued = [];
  }
}

// Default singleton for app / orchestrator
export const longRunningManager = new LongRunningManager();

export function getDefaultTasksPathFn() { return getDefaultTasksPath(); }

export default LongRunningManager;
