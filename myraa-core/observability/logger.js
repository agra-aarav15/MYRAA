// Myraa Observability — MASTER BUILD PROMPT §58 + §39-40, §50, §52
// Provides: structured logs, metrics, task traces, agent traces, tool traces,
// errors, performance measurements, resource usage, cost tracking.
// Developer diagnostics without polluting normal user experience (§58).
// Local-first, persistent at %APPDATA%\myraa\observability.json (§52),
// event-driven (§50), redacted (§23 never log secrets), bounded.
// Integrates: EventBus, SystemMonitor (§44), ModelRouter cost (§39),
// LongRunning (§13), PolicyEngine (§34).
// UI shows safe execution summary per §40, not raw chain-of-thought.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// ---------------------------------------------------------------------------
// Helpers: paths, ids, time, redaction §23
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultObservabilityPath() {
  return path.join(getMyraaDataDir(), 'observability.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'obs') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}

// Redaction — reuse audit/store pattern, must be consistent
const RAW_SECRET_REGEXES = [
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED]' },
  { regex: /sk-proj-[a-zA-Z0-9-_]{60,}/g, replacement: '[REDACTED]' },
  { regex: /sk-ant-api03-[a-zA-Z0-9-_]{30,}/g, replacement: '[REDACTED]' },
  { regex: /AIza[0-9A-Za-z-_]{30,}/g, replacement: '[REDACTED]' },
  { regex: /gsk_[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED]' },
  { regex: /ghp_[a-zA-Z0-9]{30,}/g, replacement: '[REDACTED]' },
  { regex: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
  { regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, replacement: '[REDACTED]' },
  { regex: /Bearer\s+[A-Za-z0-9\-_.]{20,}/g, replacement: 'Bearer [REDACTED]' },
];
const GENERIC_ASSIGNMENT_REGEX = /(api[_-]?key|apikey|secret[_-]?key|access[_-]?key|password|passwd|pwd|token|bearer|auth[_-]?token|credential|secret)\s*[:=]\s*(['"]?)([^'"\s,;]+)\2/gi;
function redactString(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const { regex, replacement } of RAW_SECRET_REGEXES) {
    out = out.replace(new RegExp(regex.source, regex.flags), replacement);
  }
  out = out.replace(GENERIC_ASSIGNMENT_REGEX, (_m, key) => {
    const hasQuotes = _m.includes('"') || _m.includes("'");
    const quote = hasQuotes ? '"' : '';
    return `${key}=${quote}[REDACTED]${quote}`;
  });
  return out;
}
function redactValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return redactString(val);
  if (Array.isArray(val)) return val.map(redactValue);
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (/api[_-]?key|apikey|secret|password|passwd|pwd|token|credential|auth/i.test(k)) out[k] = '[REDACTED]';
      else if (typeof v === 'string') out[k] = redactString(v);
      else if (typeof v === 'object' && v !== null) out[k] = redactValue(v);
      else out[k] = v;
    }
    return out;
  }
  return val;
}
function truncate(str, max = 2000) {
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + `...[truncated ${str.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// Levels & Categories §58
// ---------------------------------------------------------------------------
export const LogLevel = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});
export const LEVEL_ORDER = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3 });
export const LogCategory = Object.freeze({
  TASK: 'task',
  AGENT: 'agent',
  TOOL: 'tool',
  SYSTEM: 'system',
  MODEL: 'model',
  COST: 'cost',
  PERFORMANCE: 'performance',
  ERROR: 'error',
  AUDIT: 'audit',
  OBSERVABILITY: 'observability',
});
export const TraceType = Object.freeze({
  TASK: 'task',
  AGENT: 'agent',
  TOOL: 'tool',
  SPAN: 'span',
});
export const MetricType = Object.freeze({
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  TIMING: 'timing',
});

// ---------------------------------------------------------------------------
// Observability — §58 unified diagnostics
// ---------------------------------------------------------------------------
export class Observability extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (§52)
   * @param {object} opts.eventBus
   * @param {object} opts.monitor - SystemMonitor (§44) for resource usage
   * @param {number} opts.maxLogs - cap logs (default 5000)
   * @param {number} opts.maxTraces - cap traces (default 1000)
   * @param {number} opts.maxMetrics - cap metric series (default 1000)
   * @param {number} opts.maxCosts - cap cost records (default 2000)
   * @param {string} opts.level - minimum log level (default 'debug')
   * @param {object} opts.logger - fallback console
   * @param {boolean} opts.autoLoad
   */
  constructor({
    filePath,
    eventBus = null,
    monitor = null,
    maxLogs = 5000,
    maxTraces = 1000,
    maxMetrics = 1000,
    maxCosts = 2000,
    level = 'debug',
    logger = console,
    autoLoad = true,
  } = {}) {
    super();
    this.filePath = filePath || getDefaultObservabilityPath();
    this.eventBus = eventBus;
    this.monitor = monitor;
    this.logger = logger;
    this.maxLogs = maxLogs;
    this.maxTraces = maxTraces;
    this.maxMetrics = maxMetrics;
    this.maxCosts = maxCosts;
    this.level = String(level).toLowerCase();
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    /** @type {Array} structured logs §58 */
    this.logs = [];
    /** @type {Map<string, object>} metrics: name -> { type, value, count, sum, min, max, tags, updatedAt } */
    this.metrics = new Map();
    /** @type {Map<string, object>} traces: traceId -> trace */
    this.traces = new Map();
    /** @type {Map<string, object>} spans: spanId -> span */
    this.spans = new Map();
    /** @type {Array} cost records §39 */
    this.costs = [];
    /** @type {Map<string, number>} performance timings: name -> duration aggregates */
    this.performance = new Map(); // name -> { count, totalMs, minMs, maxMs, avgMs }

    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(()=>{}); } catch {}

    // Auto-bind to eventBus for automatic observability (§50)
    this._boundHandlers = new Map();

    if (autoLoad) this.load();
  }

  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.emit(event, data); } catch {}
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    try { import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(()=>{}); } catch {}
  }

  _shouldLog(level) {
    return (LEVEL_ORDER[String(level).toLowerCase()] ?? 0) >= (LEVEL_ORDER[this.level] ?? 0);
  }

  // ------------------------- persistence §52 -------------------------
  _getPersistPayload() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      level: this.level,
      logs: this.logs,
      metrics: [...this.metrics.values()],
      traces: [...this.traces.values()],
      spans: [...this.spans.values()],
      costs: this.costs,
      performance: [...this.performance.entries()].map(([name, stats]) => ({ name, ...stats })),
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
      return { ok: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[Observability] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[Observability] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    this.level = data.level || this.level;
    if (Array.isArray(data.logs)) {
      this.logs = data.logs
        .filter(l => l && typeof l === 'object')
        .map(l => ({
          id: l.id || genId('log'),
          ts: l.ts || nowIso(),
          level: l.level || LogLevel.INFO,
          category: l.category || LogCategory.OBSERVABILITY,
          message: l.message ? truncate(redactString(String(l.message)), 2000) : '',
          fields: l.fields ? redactValue(l.fields) : null,
          traceId: l.traceId || null,
          spanId: l.spanId || null,
          taskId: l.taskId || null,
          agentId: l.agentId || null,
          tool: l.tool || null,
          durationMs: l.durationMs ?? null,
          error: l.error ? truncate(redactString(String(l.error)), 2000) : null,
        }))
        .slice(-this.maxLogs);
    }
    if (Array.isArray(data.metrics)) {
      this.metrics = new Map();
      for (const m of data.metrics) {
        if (!m || !m.name) continue;
        this.metrics.set(m.name, {
          name: m.name,
          type: m.type || MetricType.GAUGE,
          value: m.value ?? 0,
          count: m.count ?? 1,
          sum: m.sum ?? m.value ?? 0,
          min: m.min ?? m.value ?? 0,
          max: m.max ?? m.value ?? 0,
          tags: m.tags || null,
          updatedAt: m.updatedAt || nowIso(),
        });
      }
    }
    if (Array.isArray(data.traces)) {
      this.traces = new Map();
      for (const t of data.traces) {
        if (!t || !t.traceId) continue;
        this.traces.set(t.traceId, {
          traceId: t.traceId,
          parentId: t.parentId || null,
          name: t.name || 'trace',
          type: t.type || TraceType.SPAN,
          taskId: t.taskId || null,
          agentId: t.agentId || null,
          tool: t.tool || null,
          startAt: t.startAt || nowIso(),
          endAt: t.endAt || null,
          durationMs: t.durationMs ?? null,
          status: t.status || 'running',
          error: t.error ? redactString(String(t.error).slice(0, 500)) : null,
          tags: t.tags ? redactValue(t.tags) : null,
          spanId: t.spanId || t.traceId,
        });
      }
    }
    if (Array.isArray(data.spans)) {
      this.spans = new Map();
      for (const s of data.spans) {
        if (!s || !s.spanId) continue;
        this.spans.set(s.spanId, { ...s, error: s.error ? redactString(String(s.error).slice(0, 500)) : null, tags: s.tags ? redactValue(s.tags) : null });
      }
      // If spans empty but traces contain spans, rebuild
      if (this.spans.size === 0 && this.traces.size > 0) {
        for (const t of this.traces.values()) {
          if (t.spanId && !this.spans.has(t.spanId)) this.spans.set(t.spanId, { ...t });
        }
      }
    }
    if (Array.isArray(data.costs)) {
      this.costs = data.costs
        .filter(c => c && typeof c === 'object')
        .map(c => ({
          id: c.id || genId('cost'),
          ts: c.ts || nowIso(),
          traceId: c.traceId || null,
          taskId: c.taskId || null,
          agentId: c.agentId || null,
          modelId: c.modelId || 'unknown',
          provider: c.provider || null,
          inputTokens: Number(c.inputTokens || 0),
          outputTokens: Number(c.outputTokens || 0),
          totalTokens: Number(c.totalTokens || (c.inputTokens + c.outputTokens) || 0),
          cost: Number(c.cost || 0),
          durationMs: c.durationMs ?? null,
          tags: c.tags ? redactValue(c.tags) : null,
        }))
        .slice(-this.maxCosts);
    }
    if (Array.isArray(data.performance)) {
      this.performance = new Map();
      for (const p of data.performance) {
        if (!p || !p.name) continue;
        this.performance.set(p.name, { count: p.count || 0, totalMs: p.totalMs || 0, minMs: p.minMs ?? p.totalMs ?? 0, maxMs: p.maxMs ?? p.totalMs ?? 0, avgMs: p.avgMs ?? 0 });
      }
    } else if (data.performance && typeof data.performance === 'object' && !Array.isArray(data.performance)) {
      this.performance = new Map(Object.entries(data.performance).map(([k, v]) => [k, typeof v === 'object' ? v : { count: 1, totalMs: Number(v), minMs: Number(v), maxMs: Number(v), avgMs: Number(v) }]));
    }
  }

  // ------------------------- structured logs §58 -------------------------
  /**
   * Structured log — never logs secrets (§23), emits for diagnostics, not UI pollution.
   * @param {string} level - debug|info|warn|error
   * @param {string} message - human readable, no chain-of-thought
   * @param {object} meta - { category, fields, traceId, spanId, taskId, agentId, tool, durationMs, error }
   */
  log(level, message, meta = {}) {
    const lvl = String(level || 'info').toLowerCase();
    if (!LogLevel[lvl?.toUpperCase?.()] && !Object.values(LogLevel).includes(lvl)) {
      // allow custom but normalize to info
    }
    const normalizedLevel = Object.values(LogLevel).includes(lvl) ? lvl : LogLevel.INFO;
    if (!this._shouldLog(normalizedLevel)) return { ok: true, skipped: true, level: normalizedLevel };

    const entry = {
      id: genId('log'),
      ts: nowIso(),
      level: normalizedLevel,
      category: meta.category || LogCategory.OBSERVABILITY,
      message: truncate(redactString(String(message || '').slice(0, 2000)), 2000),
      fields: meta.fields ? redactValue(meta.fields) : (meta.meta ? redactValue(meta.meta) : null),
      traceId: meta.traceId || meta.trace_id || null,
      spanId: meta.spanId || meta.span_id || null,
      taskId: meta.taskId || meta.task || null,
      agentId: meta.agentId || meta.agent || null,
      tool: meta.tool || meta.action || null,
      durationMs: meta.durationMs ?? meta.duration ?? null,
      error: meta.error ? truncate(redactString(String(meta.error).slice(0, 2000)), 2000) : null,
      resource: meta.resource ? redactValue(meta.resource) : null,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-this.maxLogs);

    // Emit for live diagnostics (devtools) — not user-facing chat
    this._emit('observability:log', { ...entry });
    this._emit(`log:${normalizedLevel}`, { ...entry });
    // Also emit generic log event for external consumers
    this._emit('log', { ...entry });

    // Persist periodically — throttle to every 50 logs or on error
    if (this.logs.length % 50 === 0 || normalizedLevel === LogLevel.ERROR) {
      this.save();
    }

    return { ok: true, entry: { ...entry } };
  }

  debug(message, meta) { return this.log(LogLevel.DEBUG, message, meta); }
  info(message, meta) { return this.log(LogLevel.INFO, message, meta); }
  warn(message, meta) { return this.log(LogLevel.WARN, message, meta); }
  error(message, meta) { return this.log(LogLevel.ERROR, message, meta); }

  // Category helpers §58
  taskLog(taskId, message, meta = {}) { return this.log(LogLevel.INFO, message, { category: LogCategory.TASK, taskId, ...meta }); }
  agentLog(agentId, message, meta = {}) { return this.log(LogLevel.INFO, message, { category: LogCategory.AGENT, agentId, ...meta }); }
  toolLog(tool, message, meta = {}) { return this.log(LogLevel.INFO, message, { category: LogCategory.TOOL, tool, ...meta }); }

  // ------------------------- metrics §58 -------------------------
  /**
   * Record metric — counter, gauge, histogram, timing.
   * @param {string} name - metric name e.g., "task.duration", "tool.calls"
   * @param {number} value
   * @param {string} type - counter|gauge|histogram|timing
   * @param {object} tags - dimensions e.g., { tool: "mouseClick" }
   */
  metric(name, value, type = MetricType.GAUGE, tags = null) {
    if (!name || typeof name !== 'string') return { ok: false, error: 'name required' };
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return { ok: false, error: 'value must be numeric' };
    const t = String(type).toLowerCase();
    const safeType = Object.values(MetricType).includes(t) ? t : MetricType.GAUGE;
    const safeTags = tags ? redactValue(tags) : null;
    const existing = this.metrics.get(name);
    if (safeType === MetricType.COUNTER) {
      const next = existing ? existing.value + numeric : numeric;
      const count = existing ? existing.count + 1 : 1;
      const sum = existing ? existing.sum + numeric : numeric;
      this.metrics.set(name, {
        name, type: safeType, value: next, count, sum,
        min: existing ? Math.min(existing.min, numeric) : numeric,
        max: existing ? Math.max(existing.max, numeric) : numeric,
        tags: safeTags, updatedAt: nowIso(),
      });
    } else if (safeType === MetricType.HISTOGRAM) {
      const count = existing ? existing.count + 1 : 1;
      const sum = existing ? existing.sum + numeric : numeric;
      this.metrics.set(name, {
        name, type: safeType, value: numeric, count, sum,
        min: existing ? Math.min(existing.min, numeric) : numeric,
        max: existing ? Math.max(existing.max, numeric) : numeric,
        avg: sum / count,
        tags: safeTags, updatedAt: nowIso(),
      });
    } else {
      // GAUGE or TIMING: last value wins, but track stats
      const count = existing ? existing.count + 1 : 1;
      const sum = existing ? existing.sum + numeric : numeric;
      this.metrics.set(name, {
        name, type: safeType, value: numeric, count, sum,
        min: existing ? Math.min(existing.min, numeric) : numeric,
        max: existing ? Math.max(existing.max, numeric) : numeric,
        avg: sum / count,
        tags: safeTags, updatedAt: nowIso(),
      });
    }
    if (this.metrics.size > this.maxMetrics) {
      // evict oldest (first inserted)
      const first = this.metrics.keys().next().value;
      this.metrics.delete(first);
    }
    this._emit('observability:metric', { name, value: numeric, type: safeType, tags: safeTags });
    return { ok: true, metric: { ...this.metrics.get(name) } };
  }

  counter(name, delta = 1, tags) { return this.metric(name, delta, MetricType.COUNTER, tags); }
  gauge(name, value, tags) { return this.metric(name, value, MetricType.GAUGE, tags); }
  histogram(name, value, tags) { return this.metric(name, value, MetricType.HISTOGRAM, tags); }
  timing(name, durationMs, tags) { return this.metric(name, durationMs, MetricType.TIMING, tags); }

  increment(name, delta = 1, tags) { return this.counter(name, delta, tags); }
  setGauge(name, value, tags) { return this.gauge(name, value, tags); }

  /**
   * Measure performance of a function — §58 Performance measurements
   * @param {string} name
   * @param {function} fn - async or sync function
   * @param {object} tags
   */
  async measure(name, fn, tags = null) {
    if (typeof fn !== 'function') return { ok: false, error: 'fn required' };
    const start = performance.now();
    const span = this.startSpan(null, name, { category: LogCategory.PERFORMANCE, tags });
    let result, error;
    try {
      result = await fn();
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      this.endSpan(span.spanId, { status: 'ok', durationMs });
      this.timing(name, durationMs, tags);
      // aggregate performance
      const existing = this.performance.get(name);
      if (existing) {
        existing.count += 1;
        existing.totalMs += durationMs;
        existing.minMs = Math.min(existing.minMs, durationMs);
        existing.maxMs = Math.max(existing.maxMs, durationMs);
        existing.avgMs = Math.round((existing.totalMs / existing.count) * 10) / 10;
      } else {
        this.performance.set(name, { count: 1, totalMs: durationMs, minMs: durationMs, maxMs: durationMs, avgMs: durationMs });
      }
      this.info(`Performance: ${name} ${durationMs}ms`, { category: LogCategory.PERFORMANCE, durationMs, traceId: span.traceId, spanId: span.spanId });
      return { ok: true, durationMs, result, spanId: span.spanId, traceId: span.traceId };
    } catch (e) {
      const durationMs = Math.round((performance.now() - start) * 10) / 10;
      error = e.message || String(e);
      this.endSpan(span.spanId, { status: 'error', error, durationMs });
      this.timing(name, durationMs, { ...tags, error: true });
      this.error(`Performance: ${name} failed after ${durationMs}ms: ${error}`, { category: LogCategory.PERFORMANCE, durationMs, error, traceId: span.traceId, spanId: span.spanId });
      // still track performance
      const existing = this.performance.get(name);
      if (existing) {
        existing.count += 1;
        existing.totalMs += durationMs;
        existing.minMs = Math.min(existing.minMs, durationMs);
        existing.maxMs = Math.max(existing.maxMs, durationMs);
        existing.avgMs = Math.round((existing.totalMs / existing.count) * 10) / 10;
      } else {
        this.performance.set(name, { count: 1, totalMs: durationMs, minMs: durationMs, maxMs: durationMs, avgMs: durationMs });
      }
      return { ok: false, durationMs, error, spanId: span.spanId, traceId: span.traceId };
    }
  }

  // Convenience for direct timing without function
  startTimer(name) {
    const start = performance.now();
    const span = this.startSpan(null, name, { category: LogCategory.PERFORMANCE });
    return {
      end: (meta = {}) => {
        const durationMs = Math.round((performance.now() - start) * 10) / 10;
        this.endSpan(span.spanId, { status: meta.status || 'ok', durationMs, ...meta });
        this.timing(name, durationMs, meta.tags || null);
        return { durationMs, spanId: span.spanId, traceId: span.traceId };
      },
      span,
      traceId: span.traceId,
      spanId: span.spanId,
    };
  }

  // ------------------------- traces §58 Task traces, Agent traces, Tool traces -------------------------
  /**
   * Start a trace (task, agent, or generic span).
   * @param {object} opts - { name, type, taskId, agentId, tool, parentId, tags, traceId }
   * @returns {{ traceId, spanId, span }}
   */
  startTrace(opts = {}) {
    const traceId = opts.traceId || genId('trace');
    const spanId = opts.spanId || genId('span');
    const span = {
      traceId,
      spanId,
      parentId: opts.parentId || null,
      name: String(opts.name || opts.taskId || opts.tool || 'trace').slice(0, 200),
      type: opts.type || TraceType.SPAN,
      taskId: opts.taskId || null,
      agentId: opts.agentId || null,
      tool: opts.tool || null,
      startAt: nowIso(),
      endAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      tags: opts.tags ? redactValue(opts.tags) : null,
      category: opts.category || null,
    };
    this.traces.set(traceId, { ...span });
    this.spans.set(spanId, { ...span });
    // Also map traceId=spanId for single-span traces
    if (traceId !== spanId) this.spans.set(traceId, { ...span });
    this._emit('observability:trace:started', { traceId, spanId, name: span.name, type: span.type });
    this.debug(`Trace started: ${span.name}`, { category: LogCategory.OBSERVABILITY, traceId, spanId, taskId: span.taskId, agentId: span.agentId, tool: span.tool });
    return { traceId, spanId, span: { ...span } };
  }

  startSpan(traceId, name, opts = {}) {
    // If traceId not provided, create new trace
    if (!traceId) return this.startTrace({ name, type: TraceType.SPAN, ...opts });
    const parent = this.traces.get(traceId) || this.spans.get(traceId);
    const spanId = genId('span');
    const span = {
      traceId,
      spanId,
      parentId: parent ? (parent.spanId || traceId) : null,
      name: String(name).slice(0, 200),
      type: opts.type || TraceType.SPAN,
      taskId: opts.taskId || parent?.taskId || null,
      agentId: opts.agentId || parent?.agentId || null,
      tool: opts.tool || null,
      startAt: nowIso(),
      endAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      tags: opts.tags ? redactValue(opts.tags) : null,
      category: opts.category || null,
    };
    this.spans.set(spanId, { ...span });
    // Keep trace updated? For now spans are separate
    this._emit('observability:span:started', { traceId, spanId, name });
    return { traceId, spanId, span: { ...span } };
  }

  endSpan(spanId, result = {}) {
    const span = this.spans.get(spanId) || this.traces.get(spanId);
    if (!span) return { ok: false, error: `Span not found: ${spanId}` };
    const now = nowIso();
    const startMs = new Date(span.startAt).getTime();
    const durationMs = result.durationMs ?? Math.round((Date.now() - startMs) * 10) / 10;
    span.endAt = now;
    span.durationMs = durationMs;
    span.status = result.status || (result.error ? 'error' : 'ok');
    if (result.error) span.error = truncate(redactString(String(result.error).slice(0, 500)), 500);
    if (result.tags) span.tags = { ...(span.tags || {}), ...redactValue(result.tags) };
    if (result.fields) span.tags = { ...(span.tags || {}), ...redactValue(result.fields) };
    this.spans.set(spanId, { ...span });
    // Update trace if this is the root traceId
    if (this.traces.has(span.traceId)) {
      const trace = this.traces.get(span.traceId);
      // If this span is the root, update it
      if (trace.spanId === spanId || trace.traceId === spanId) {
        this.traces.set(span.traceId, { ...trace, endAt: now, durationMs, status: span.status, error: span.error });
      }
    }
    // Cap traces/spans
    if (this.traces.size > this.maxTraces) {
      const oldest = [...this.traces.keys()][0];
      this.traces.delete(oldest);
    }
    if (this.spans.size > this.maxTraces * 2) {
      const oldest = [...this.spans.keys()][0];
      this.spans.delete(oldest);
    }
    this._emit('observability:span:ended', { traceId: span.traceId, spanId, durationMs, status: span.status });
    // Structured log for trace completion
    this.info(`Span ended: ${span.name} ${durationMs}ms ${span.status}`, { category: LogCategory.OBSERVABILITY, traceId: span.traceId, spanId, durationMs, status: span.status, taskId: span.taskId, agentId: span.agentId, tool: span.tool, error: span.error });
    return { ok: true, span: { ...span } };
  }

  endTrace(traceId, result = {}) {
    return this.endSpan(traceId, result);
  }

  // Typed trace helpers §58
  startTaskTrace(taskId, name, opts = {}) {
    return this.startTrace({ type: TraceType.TASK, taskId: String(taskId), name: name || `task:${taskId}`, ...opts });
  }
  endTaskTrace(traceId, result = {}) { return this.endTrace(traceId, result); }

  startAgentTrace(agentId, taskId, name, opts = {}) {
    return this.startTrace({ type: TraceType.AGENT, agentId: String(agentId), taskId: taskId ? String(taskId) : null, name: name || `agent:${agentId}`, ...opts });
  }
  endAgentTrace(traceId, result = {}) { return this.endTrace(traceId, result); }

  startToolTrace(tool, taskId, agentId, opts = {}) {
    return this.startTrace({ type: TraceType.TOOL, tool: String(tool), taskId: taskId ? String(taskId) : null, agentId: agentId ? String(agentId) : null, name: `tool:${tool}`, ...opts });
  }
  endToolTrace(traceId, result = {}) { return this.endTrace(traceId, result); }

  // ------------------------- errors §58 -------------------------
  recordError(error, meta = {}) {
    const msg = error?.message || String(error || 'unknown error');
    const stack = error?.stack ? String(error.stack).slice(0, 2000) : null;
    this.error(msg, {
      category: LogCategory.ERROR,
      error: redactString(msg),
      fields: { stack: stack ? redactString(stack).slice(0, 1000) : null, originalCategory: meta.category || null, ...redactValue(meta.fields || {}) },
      traceId: meta.traceId || null,
      spanId: meta.spanId || null,
      taskId: meta.taskId || null,
      agentId: meta.agentId || null,
      tool: meta.tool || null,
    });
    this.counter('errors.total', 1, { category: meta.category || 'unknown', tool: meta.tool || 'unknown' });
    if (meta.taskId) this.counter(`errors.task.${meta.taskId}`, 1);
    if (meta.tool) this.counter(`errors.tool.${meta.tool}`, 1);
    this._emit('observability:error', { message: redactString(msg).slice(0, 500), stack, taskId: meta.taskId || null, tool: meta.tool || null });
    return { ok: true };
  }

  // ------------------------- resource usage §58 -------------------------
  recordResourceUsage(snapshot = null, meta = {}) {
    let snap = snapshot;
    if (!snap && this.monitor) {
      try {
        if (typeof this.monitor.getSystemSnapshot === 'function') snap = this.monitor.getSystemSnapshot();
        else if (typeof this.monitor.getMemoryUsage === 'function') snap = { memory: this.monitor.getMemoryUsage(), cpu: this.monitor.getCpuUsage?.() || null, disk: this.monitor.getDiskUsage?.() || null };
      } catch {}
    }
    if (!snap) snap = { ts: nowIso(), note: 'no monitor available', ...meta };
    this.gauge('resource.memory.usedPercent', snap.memory?.usedPercent ?? 0, { host: os.hostname() });
    if (snap.cpu?.usagePercent !== null && snap.cpu?.usagePercent !== undefined) this.gauge('resource.cpu.usagePercent', snap.cpu.usagePercent);
    if (snap.disk?.freeGB !== null && snap.disk?.freeGB !== undefined) this.gauge('resource.disk.freeGB', snap.disk.freeGB);
    if (snap.battery?.level !== null && snap.battery?.level !== undefined) this.gauge('resource.battery.level', snap.battery.level);
    this.info('Resource snapshot', { category: LogCategory.SYSTEM, fields: { snapshot: redactValue(snap) }, traceId: meta.traceId || null });
    this._emit('observability:resource', { snapshot: redactValue(snap) });
    return { ok: true, snapshot: redactValue(snap) };
  }

  // ------------------------- cost tracking §58 + §39 -------------------------
  /**
   * Record cost — §58 Cost tracking, §39 budgets
   * @param {object} entry - { modelId, provider, taskId, agentId, traceId, inputTokens, outputTokens, cost, durationMs }
   */
  recordCost(entry = {}) {
    if (!entry.modelId && !entry.model) return { ok: false, error: 'modelId required' };
    const modelId = String(entry.modelId || entry.model);
    const provider = entry.provider || null;
    const inputTokens = Number(entry.inputTokens || 0);
    const outputTokens = Number(entry.outputTokens || 0);
    const totalTokens = Number(entry.totalTokens || (inputTokens + outputTokens) || 0);
    // Estimate cost if not provided via model router catalog heuristics (fallback)
    let cost = entry.cost;
    if (cost === undefined || cost === null) {
      // Try to estimate via simple heuristic if router available? For now use 0
      cost = 0;
      // If entry has per-token rates, compute
      if (entry.inputCostPerM && entry.outputCostPerM) {
        cost = (inputTokens / 1_000_000) * entry.inputCostPerM + (outputTokens / 1_000_000) * entry.outputCostPerM;
      }
    } else {
      cost = Number(cost);
    }
    const record = {
      id: entry.id || genId('cost'),
      ts: entry.ts || nowIso(),
      traceId: entry.traceId || null,
      taskId: entry.taskId || null,
      agentId: entry.agentId || null,
      modelId,
      provider,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      durationMs: entry.durationMs ?? null,
      tags: entry.tags ? redactValue(entry.tags) : null,
    };
    this.costs.push(record);
    if (this.costs.length > this.maxCosts) this.costs = this.costs.slice(-this.maxCosts);
    this.metrics.set('cost.total', {
      name: 'cost.total',
      type: MetricType.COUNTER,
      value: (this.metrics.get('cost.total')?.value || 0) + cost,
      count: (this.metrics.get('cost.total')?.count || 0) + 1,
      sum: (this.metrics.get('cost.total')?.sum || 0) + cost,
      min: Math.min(this.metrics.get('cost.total')?.min ?? cost, cost),
      max: Math.max(this.metrics.get('cost.total')?.max ?? cost, cost),
      tags: null,
      updatedAt: nowIso(),
    });
    this.metrics.set(`cost.model.${modelId}`, {
      name: `cost.model.${modelId}`,
      type: MetricType.COUNTER,
      value: (this.metrics.get(`cost.model.${modelId}`)?.value || 0) + cost,
      count: (this.metrics.get(`cost.model.${modelId}`)?.count || 0) + 1,
      sum: (this.metrics.get(`cost.model.${modelId}`)?.sum || 0) + cost,
      min: Math.min(this.metrics.get(`cost.model.${modelId}`)?.min ?? cost, cost),
      max: Math.max(this.metrics.get(`cost.model.${modelId}`)?.max ?? cost, cost),
      tags: { modelId, provider },
      updatedAt: nowIso(),
    });
    if (record.taskId) {
      this.metrics.set(`cost.task.${record.taskId}`, {
        name: `cost.task.${record.taskId}`,
        type: MetricType.COUNTER,
        value: (this.metrics.get(`cost.task.${record.taskId}`)?.value || 0) + cost,
        count: (this.metrics.get(`cost.task.${record.taskId}`)?.count || 0) + 1,
        sum: (this.metrics.get(`cost.task.${record.taskId}`)?.sum || 0) + cost,
        min: cost,
        max: cost,
        tags: { taskId: record.taskId },
        updatedAt: nowIso(),
      });
    }
    this.info(`Cost: ${modelId} ${totalTokens} tokens $${cost.toFixed(4)}`, { category: LogCategory.COST, fields: { modelId, provider, totalTokens, cost, inputTokens, outputTokens }, traceId: record.traceId, taskId: record.taskId, agentId: record.agentId });
    this._emit('observability:cost', { ...record });
    return { ok: true, cost: record, totalCost: this.metrics.get('cost.total')?.value || cost };
  }

  /**
   * Estimate cost for tokens if model catalog known — delegates to ModelRouter if available
   */
  estimateCost(modelId, inputTokens, outputTokens) {
    // Built-in catalog fallback for common models
    const fallbackCosts = {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
      'gemini-1.5-pro': { input: 1.25, output: 5 },
      'llama3.2': { input: 0, output: 0 },
    };
    const c = fallbackCosts[modelId];
    if (!c) return 0;
    return (inputTokens / 1_000_000) * c.input + (outputTokens / 1_000_000) * c.output;
  }

  // ------------------------- user-facing progress summary §40 -------------------------
  /**
   * Build safe execution summary — does not expose chain-of-thought per §40.
   * Consumes trace/progress events and returns UI-friendly representation.
   * @param {string} taskId
   * @returns {{ ok:boolean, summary }}
   */
  getProgressSummary(taskId = null) {
    // Collect traces for taskId
    const spansForTask = [...this.spans.values()].filter(s => !taskId || s.taskId === String(taskId));
    const logsForTask = this.logs.filter(l => !taskId || l.taskId === String(taskId));
    // Build safe summary: show stage names, statuses, times, not internal reasoning
    const stages = spansForTask
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .map(s => ({
        name: s.name,
        type: s.type,
        status: s.status,
        durationMs: s.durationMs,
        tool: s.tool || null,
        startAt: s.startAt,
        endAt: s.endAt,
      }));

    // Example safe representation per §40 prompt:
    // Understanding request ✓, Planning ✓, Creating project ✓, Building APK ●, etc.
    const summary = {
      taskId: taskId || 'all',
      stages: stages.slice(-20),
      logs: logsForTask.slice(-20).map(l => ({ ts: l.ts, level: l.level, category: l.category, message: l.message, durationMs: l.durationMs })),
      costs: this.costs.filter(c => !taskId || c.taskId === String(taskId)).slice(-10).map(c => ({ modelId: c.modelId, totalTokens: c.totalTokens, cost: c.cost, ts: c.ts })),
      generatedAt: nowIso(),
    };
    return { ok: true, summary };
  }

  getSafeExecutionSummary(taskId) { return this.getProgressSummary(taskId); }

  // ------------------------- query & inspection -------------------------
  getLogs(filter = {}) {
    let out = [...this.logs];
    if (filter.level) {
      const minOrder = LEVEL_ORDER[String(filter.level).toLowerCase()] ?? 0;
      out = out.filter(l => (LEVEL_ORDER[l.level] ?? 0) >= minOrder);
    }
    if (filter.category) out = out.filter(l => l.category === String(filter.category).toLowerCase());
    if (filter.taskId) out = out.filter(l => l.taskId === String(filter.taskId));
    if (filter.agentId) out = out.filter(l => l.agentId === String(filter.agentId));
    if (filter.tool) out = out.filter(l => l.tool === String(filter.tool));
    if (filter.traceId) out = out.filter(l => l.traceId === String(filter.traceId));
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter(l => new Date(l.ts).getTime() >= since);
    }
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      out = out.filter(l => String(l.message).toLowerCase().includes(q) || String(l.error || '').toLowerCase().includes(q) || String(l.tool || '').toLowerCase().includes(q));
    }
    out.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const total = out.length;
    if (filter.offset) out = out.slice(Number(filter.offset));
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, logs: out.map(l => ({ ...l })), total };
  }

  getMetrics(filter = {}) {
    let out = [...this.metrics.values()];
    if (filter.name) out = out.filter(m => m.name.includes(String(filter.name)));
    if (filter.type) out = out.filter(m => m.type === String(filter.type).toLowerCase());
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, metrics: out.map(m => ({ ...m })), total };
  }

  getTraces(filter = {}) {
    let outTraces = [...this.traces.values()];
    let outSpans = [...this.spans.values()];
    if (filter.traceId) {
      outTraces = outTraces.filter(t => t.traceId === String(filter.traceId));
      outSpans = outSpans.filter(s => s.traceId === String(filter.traceId));
    }
    if (filter.taskId) {
      outTraces = outTraces.filter(t => t.taskId === String(filter.taskId));
      outSpans = outSpans.filter(s => s.taskId === String(filter.taskId));
    }
    if (filter.agentId) {
      outTraces = outTraces.filter(t => t.agentId === String(filter.agentId));
      outSpans = outSpans.filter(s => s.agentId === String(filter.agentId));
    }
    if (filter.tool) {
      outTraces = outTraces.filter(t => t.tool === String(filter.tool));
      outSpans = outSpans.filter(s => s.tool === String(filter.tool));
    }
    if (filter.type) {
      outTraces = outTraces.filter(t => t.type === String(filter.type).toLowerCase());
      outSpans = outSpans.filter(s => s.type === String(filter.type).toLowerCase());
    }
    if (filter.status) {
      outTraces = outTraces.filter(t => t.status === String(filter.status).toLowerCase());
      outSpans = outSpans.filter(s => s.status === String(filter.status).toLowerCase());
    }
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      outTraces = outTraces.filter(t => new Date(t.startAt).getTime() >= since);
      outSpans = outSpans.filter(s => new Date(s.startAt).getTime() >= since);
    }
    outTraces.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    outSpans.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    const limit = filter.limit ? Number(filter.limit) : null;
    if (limit) {
      outTraces = outTraces.slice(0, limit);
      outSpans = outSpans.slice(0, limit);
    }
    return { ok: true, traces: outTraces.map(t => ({ ...t })), spans: outSpans.map(s => ({ ...s })), total: outTraces.length, spansTotal: outSpans.length };
  }

  getCosts(filter = {}) {
    let out = [...this.costs];
    if (filter.taskId) out = out.filter(c => c.taskId === String(filter.taskId));
    if (filter.agentId) out = out.filter(c => c.agentId === String(filter.agentId));
    if (filter.modelId) out = out.filter(c => c.modelId === String(filter.modelId));
    if (filter.traceId) out = out.filter(c => c.traceId === String(filter.traceId));
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter(c => new Date(c.ts).getTime() >= since);
    }
    out.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const total = out.length;
    const totalCost = out.reduce((a, c) => a + (c.cost || 0), 0);
    const totalTokens = out.reduce((a, c) => a + (c.totalTokens || 0), 0);
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, costs: out.map(c => ({ ...c })), total, totalCost, totalTokens };
  }

  getPerformance(filter = {}) {
    let out = [...this.performance.entries()].map(([name, stats]) => ({ name, ...stats }));
    if (filter.name) out = out.filter(p => p.name.includes(String(filter.name)));
    out.sort((a, b) => b.avgMs - a.avgMs);
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, performance: out, total: out.length };
  }

  getStats() {
    const byLevel = {};
    for (const l of this.logs) byLevel[l.level] = (byLevel[l.level] || 0) + 1;
    const byCategory = {};
    for (const l of this.logs) byCategory[l.category] = (byCategory[l.category] || 0) + 1;
    const totalCost = this.costs.reduce((a, c) => a + (c.cost || 0), 0);
    const totalTokens = this.costs.reduce((a, c) => a + (c.totalTokens || 0), 0);
    const avgDuration = this.performance.size ? [...this.performance.values()].reduce((a, p) => a + (p.avgMs || 0), 0) / this.performance.size : 0;
    return {
      ok: true,
      version: this.version,
      file: this.filePath,
      logs: this.logs.length,
      byLevel,
      byCategory,
      traces: this.traces.size,
      spans: this.spans.size,
      metrics: this.metrics.size,
      costs: this.costs.length,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalTokens,
      performance: this.performance.size,
      avgDurationMs: Math.round(avgDuration * 10) / 10,
      level: this.level,
      updatedAt: this.updatedAt,
    };
  }

  // ------------------------- trace tree & diagnostics -------------------------
  getTraceTree(traceId) {
    if (!traceId) return { ok: false, error: 'traceId required' };
    const root = this.traces.get(String(traceId)) || this.spans.get(String(traceId));
    if (!root) return { ok: false, error: `Trace not found: ${traceId}` };
    const spans = [...this.spans.values()].filter(s => s.traceId === String(traceId));
    // Build parent -> children map
    const byParent = new Map();
    for (const s of spans) {
      const p = s.parentId || 'root';
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(s);
    }
    function buildNode(node) {
      const children = byParent.get(node.spanId) || [];
      return { ...node, children: children.map(buildNode).sort((a, b) => new Date(a.startAt) - new Date(b.startAt)) };
    }
    const tree = buildNode({ ...root });
    // Also include logs for this trace
    const logs = this.logs.filter(l => l.traceId === String(traceId));
    return { ok: true, root: { ...root }, tree, spans: spans.map(s => ({ ...s })), logs: logs.map(l => ({ ...l })) };
  }

  exportDiagnostics(taskId = null) {
    const summary = this.getProgressSummary(taskId);
    const stats = this.getStats();
    const recentLogs = this.getLogs({ limit: 50, taskId });
    const recentTraces = this.getTraces({ limit: 20, taskId });
    const recentCosts = this.getCosts({ limit: 20, taskId });
    const perf = this.getPerformance({ limit: 20 });
    return {
      ok: true,
      exportedAt: nowIso(),
      taskId: taskId || 'all',
      stats,
      summary: summary.summary,
      logs: recentLogs.logs,
      traces: recentTraces.traces,
      spans: recentTraces.spans,
      costs: recentCosts.costs,
      performance: perf.performance,
      resource: this.monitor ? (() => { try { return this.monitor.getSystemSnapshot?.(); } catch { return null; } })() : null,
    };
  }

  // ------------------------- auto-binding to EventBus §50 -------------------------
  bindToEventBus(bus = null) {
    const target = bus || this.eventBus || this._globalBus;
    if (!target || typeof target.on !== 'function') return { ok: false, error: 'no bus with on()' };
    const handlers = {
      'task:started': (data) => {
        const trace = this.startTaskTrace(data.taskId || data.task?.id || genId('task'), `task:${data.mission || data.taskId || 'started'}`);
        this.info(`Task started: ${data.mission || data.taskId || ''}`.slice(0, 300), { category: LogCategory.TASK, taskId: data.taskId || data.task?.id, traceId: trace.traceId });
      },
      'task:progress': (data) => {
        this.info(`Progress: ${data.progress?.message || data.message || ''}`.slice(0, 300), { category: LogCategory.TASK, taskId: data.taskId, fields: { progress: data.progress || data } });
        if (data.progress?.percent !== undefined) this.gauge('task.progress.percent', Number(data.progress.percent), { taskId: data.taskId });
      },
      'tool:invoked': (data) => {
        const trace = this.startToolTrace(data.tool || data.name || 'unknown', data.taskId || null, data.agentId || null);
        this.toolLog(data.tool || data.name || 'unknown', `Tool invoked: ${data.tool || data.name}`, { tool: data.tool || data.name, taskId: data.taskId, agentId: data.agentId, traceId: trace.traceId });
        this.counter('tool.calls', 1, { tool: data.tool || data.name || 'unknown' });
        this._boundHandlers.set(`tool:trace:${data.tool}:${Date.now()}`, trace.traceId);
      },
      'tool:completed': (data) => {
        const dur = data.durationMs ?? data.duration ?? null;
        if (dur !== null) this.timing('tool.duration', Number(dur), { tool: data.tool || 'unknown' });
        this.toolLog(data.tool || 'unknown', `Tool completed: ${data.tool || 'unknown'} ${data.ok ? 'ok' : 'failed'}${dur ? ` ${dur}ms` : ''}`, { tool: data.tool, taskId: data.taskId, durationMs: dur, error: data.error || null });
        if (data.error) this.recordError(data.error, { tool: data.tool, taskId: data.taskId });
      },
      'agent:started': (data) => {
        this.agentLog(data.agent || data.agentId || 'unknown', `Agent started: ${data.agent || data.agentId}`, { agentId: data.agent || data.agentId, taskId: data.taskId });
        this.counter('agent.starts', 1, { agent: data.agent || data.agentId || 'unknown' });
      },
      'agent:completed': (data) => {
        if (data.durationMs) this.timing('agent.duration', Number(data.durationMs), { agent: data.agent || data.agentId || 'unknown' });
        this.agentLog(data.agent || data.agentId || 'unknown', `Agent completed: ${data.agent || data.agentId}`, { agentId: data.agent || data.agentId, taskId: data.taskId, durationMs: data.durationMs || null });
      },
      'error': (data) => {
        this.recordError(data.error || data.message || 'error', { category: LogCategory.ERROR, taskId: data.taskId || null, tool: data.tool || null, agentId: data.agentId || null });
      },
      'task:completed': (data) => {
        this.taskLog(data.taskId || data.task?.id || 'unknown', `Task completed: ${data.result || data.message || 'done'}`.slice(0, 300), { taskId: data.taskId || data.task?.id, fields: { result: String(data.result || '').slice(0, 200) } });
        this.counter('task.completed', 1);
      },
      'task:cancelled': (data) => {
        this.warn(`Task cancelled: ${data.taskId || ''} ${data.reason || ''}`.slice(0, 300), { category: LogCategory.TASK, taskId: data.taskId || null });
        this.counter('task.cancelled', 1);
      },
    };
    for (const [event, handler] of Object.entries(handlers)) {
      try { target.on(event, handler); this._boundHandlers.set(event, handler); } catch {}
    }
    return { ok: true, bound: Object.keys(handlers) };
  }

  unbindFromEventBus(bus = null) {
    const target = bus || this.eventBus || this._globalBus;
    if (!target) return { ok: false, error: 'no bus' };
    for (const [event, handler] of this._boundHandlers) {
      try { target.off?.(event, handler); } catch {}
      try { target.removeListener?.(event, handler); } catch {}
    }
    this._boundHandlers.clear();
    return { ok: true };
  }

  // ------------------------- maintenance -------------------------
  clear(filter = {}) {
    if (filter.logs) {
      const c = this.logs.length;
      this.logs = [];
      this.save();
      return { ok: true, cleared: 'logs', count: c };
    }
    if (filter.metrics) {
      const c = this.metrics.size;
      this.metrics.clear();
      this.save();
      return { ok: true, cleared: 'metrics', count: c };
    }
    if (filter.traces) {
      const c = this.traces.size + this.spans.size;
      this.traces.clear();
      this.spans.clear();
      this.save();
      return { ok: true, cleared: 'traces', count: c };
    }
    if (filter.costs) {
      const c = this.costs.length;
      this.costs = [];
      this.save();
      return { ok: true, cleared: 'costs', count: c };
    }
    if (filter.performance) {
      const c = this.performance.size;
      this.performance.clear();
      this.save();
      return { ok: true, cleared: 'performance', count: c };
    }
    const counts = { logs: this.logs.length, metrics: this.metrics.size, traces: this.traces.size, spans: this.spans.size, costs: this.costs.length, performance: this.performance.size };
    this.logs = [];
    this.metrics.clear();
    this.traces.clear();
    this.spans.clear();
    this.costs = [];
    this.performance.clear();
    this.save();
    return { ok: true, cleared: 'all', counts };
  }

  setLevel(level) {
    const lvl = String(level).toLowerCase();
    if (!Object.values(LogLevel).includes(lvl)) return { ok: false, error: `Invalid level: ${level}. Valid: ${Object.values(LogLevel).join(', ')}` };
    this.level = lvl;
    this.save();
    return { ok: true, level: this.level };
  }

  verifyNoSecrets() {
    const blob = JSON.stringify(this.logs) + JSON.stringify(this.costs);
    const patterns = [/sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{30,}/, /AIza[0-9A-Za-z-_]{30,}/, /gsk_[a-zA-Z0-9]{20,}/];
    const violations = [];
    for (const rx of patterns) if (rx.test(blob) && !blob.includes('[REDACTED]')) violations.push(rx.source);
    // Also check metrics values aren't leaking keys (they are numeric, so low risk)
    return { ok: violations.length === 0, violations, checked: this.logs.length };
  }

  destroy() {
    try { this.unbindFromEventBus(); } catch {}
    this.removeAllListeners();
  }
}

// Default singleton for app (§5 Master Orchestrator, §58 diagnostics)
export const observability = new Observability();
export const logger = observability; // alias for convenience
export const obsLogger = observability;

export function getDefaultObservabilityPathFn() { return getDefaultObservabilityPath(); }
export default Observability;
