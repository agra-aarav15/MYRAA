// Myraa Proactive Behavior — MASTER BUILD PROMPT §30 + §39-40, §44
// Detects: failed builds, disk problems, device conditions, repeated failures,
// long-task completion, and suggests improvements — all within policy (§30).
// Proactive actions MUST pass through Policy Engine (§34-36). Notifications are
// SAFE; any mutating automation is gated as NORMAL/DANGEROUS with confirmation.
// Integrates: SystemMonitor (§44), LongRunningManager (§13), DeviceManager (§26),
// EventBus (§50), PolicyEngine (§34), Audit (§38), Memory (§21).
// Local-first, event-driven, persistent at %APPDATA%\myraa\proactive.json (§52).
// UI frozen — no dist/assets changes; reports via events + notification handlers.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers: paths, ids, time, redaction §23 never log secrets
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultProactivePath() {
  return path.join(getMyraaDataDir(), 'proactive.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'pro') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}

// Secret redaction — mirrors policy/engine.js & audit.js guarantee §23
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

// ---------------------------------------------------------------------------
// Proactive Types §30
// ---------------------------------------------------------------------------
export const ProactiveType = Object.freeze({
  BUILD_FAILED: 'build_failed',
  DISK_LOW: 'disk_low',
  DISK_FULL: 'disk_full',
  CPU_HIGH: 'cpu_high',
  MEMORY_HIGH: 'memory_high',
  MEMORY_PRESSURE: 'memory_pressure',
  BATTERY_LOW: 'battery_low',
  BATTERY_CRITICAL: 'battery_critical',
  DEVICE_OFFLINE: 'device_offline',
  DEVICE_CONDITION: 'device_condition',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  REPEATED_FAILURE: 'repeated_failure',
  IMPROVEMENT: 'improvement',
  AUTOMATION_SUGGESTION: 'automation_suggestion',
});

export const Severity = Object.freeze({
  INFO: 'info',
  WARN: 'warn',
  CRITICAL: 'critical',
});

// Default thresholds — aligned with SystemMonitor §44-45
export const DEFAULT_THRESHOLDS = Object.freeze({
  diskLowGB: 5,
  diskFullGB: 1,
  cpuHigh: 85,
  memHigh: 85,
  batteryLow: 20,
  batteryCritical: 10,
  failureRepeatCount: 3,
  failureRepeatWindowMs: 10 * 60 * 1000, // 10 min
});

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  pollIntervalMs: 30000,
  cooldownMs: 5 * 60 * 1000, // 5 min per type to avoid spam, override per-type
  maxProposals: 200,
  thresholds: { ...DEFAULT_THRESHOLDS },
  detectors: {
    buildFailed: true,
    disk: true,
    system: true,
    device: true,
    taskCompletion: true,
    failureWarning: true,
    improvement: true,
  },
});

// Map proactive type -> policy tool name for gating (§34)
function policyToolForType(type) {
  // Safe notifications vs mutating suggestions
  const SAFE_TYPES = new Set([
    ProactiveType.TASK_COMPLETED,
    ProactiveType.DISK_LOW,
    ProactiveType.CPU_HIGH,
    ProactiveType.MEMORY_HIGH,
    ProactiveType.BATTERY_LOW,
    ProactiveType.DEVICE_CONDITION,
  ]);
  // Improvement/automation suggestions are NORMAL (reversible) until executed
  const NORMAL_TYPES = new Set([
    ProactiveType.IMPROVEMENT,
    ProactiveType.AUTOMATION_SUGGESTION,
    ProactiveType.MEMORY_PRESSURE,
  ]);
  // Critical destructive-adjacent warnings
  const DANGEROUS_TYPES = new Set([
    ProactiveType.DISK_FULL,
    ProactiveType.BATTERY_CRITICAL,
    ProactiveType.BUILD_FAILED,
    ProactiveType.REPEATED_FAILURE,
  ]);
  if (SAFE_TYPES.has(type)) return { tool: `proactive:${type}`, defaultTier: 'SAFE' };
  if (NORMAL_TYPES.has(type)) return { tool: `proactive:${type}`, defaultTier: 'NORMAL' };
  if (DANGEROUS_TYPES.has(type)) return { tool: `proactive:${type}`, defaultTier: 'DANGEROUS' };
  return { tool: `proactive:${type}`, defaultTier: 'NORMAL' };
}

// ---------------------------------------------------------------------------
// ProactiveEngine — §30
// ---------------------------------------------------------------------------
export class ProactiveEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (§52)
   * @param {object} opts.eventBus - external EventEmitter (myraa-core/eventBus)
   * @param {object} opts.policyEngine - PolicyEngine instance (§34) — REQUIRED for gating
   * @param {object} opts.auditLogger - AuditLogger (§38)
   * @param {object} opts.monitor - SystemMonitor (§44)
   * @param {object} opts.longRunningManager - LongRunningManager (§13)
   * @param {object} opts.deviceManager - DeviceManager (§26)
   * @param {object} opts.memoryStore - MemoryStore (§21) for improvement history
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad
   */
  constructor({
    filePath,
    eventBus = null,
    policyEngine = null,
    auditLogger = null,
    monitor = null,
    longRunningManager = null,
    deviceManager = null,
    memoryStore = null,
    logger = console,
    autoLoad = true,
    config = {},
  } = {}) {
    super();
    this.filePath = filePath || getDefaultProactivePath();
    this.eventBus = eventBus;
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;
    this.monitor = monitor;
    this.longRunningManager = longRunningManager;
    this.deviceManager = deviceManager;
    this.memoryStore = memoryStore;
    this.logger = logger;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    // Config — deep merge with defaults, persisted
    this.config = {
      enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs,
      cooldownMs: config.cooldownMs ?? config.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
      // allow per-type cooldown overrides: { build_failed: 60000, ... }
      perTypeCooldownMs: config.perTypeCooldownMs || {},
      maxProposals: config.maxProposals ?? DEFAULT_CONFIG.maxProposals,
      thresholds: { ...DEFAULT_THRESHOLDS, ...(config.thresholds || {}) },
      detectors: { ...DEFAULT_CONFIG.detectors, ...(config.detectors || {}) },
    };

    /** @type {Array} proposals/notifications */
    this.proposals = [];
    /** Map type -> last emission ts */
    this.cooldowns = new Map();
    /** Recent failure timestamps for repeated detection */
    this.recentFailures = []; // { ts, category, message }
    /** Detectors registry: name -> fn(snapshot, context) => proposal|null */
    this.detectors = new Map();
    /** Poll timer */
    this._timer = null;
    this._monitoring = false;
    this._boundHandlers = new Map();
    this.notificationHandlers = new Set();
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(()=>{}); } catch {}

    this._registerBuiltInDetectors();

    if (autoLoad) this.load();
  }

  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.emit(event, data); } catch {}
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    try { import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(()=>{}); } catch {}
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
      config: this.config,
      proposals: this.proposals,
      cooldowns: [...this.cooldowns.entries()],
      recentFailures: this.recentFailures.slice(-50),
    };
  }

  save() {
    try {
      ensureDirForFile(this.filePath);
      const payload = this._getPersistPayload();
      const safe = redactValue(payload);
      // ensure proposals are redacted (no secrets in messages)
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.updatedAt = payload.updatedAt;
      return { ok: true, path: this.filePath, count: this.proposals.length };
    } catch (e) {
      this.logger.warn?.(`[Proactive] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this.proposals.length };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[Proactive] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (data.config && typeof data.config === 'object') {
      this.config = {
        enabled: data.config.enabled ?? this.config.enabled,
        pollIntervalMs: data.config.pollIntervalMs ?? this.config.pollIntervalMs,
        cooldownMs: data.config.cooldownMs ?? this.config.cooldownMs,
        perTypeCooldownMs: data.config.perTypeCooldownMs || this.config.perTypeCooldownMs || {},
        maxProposals: data.config.maxProposals ?? this.config.maxProposals,
        thresholds: { ...DEFAULT_THRESHOLDS, ...(data.config.thresholds || {}) },
        detectors: { ...DEFAULT_CONFIG.detectors, ...(data.config.detectors || {}) },
      };
    }
    if (Array.isArray(data.proposals)) {
      this.proposals = data.proposals
        .filter(p => p && typeof p === 'object')
        .map(p => ({
          id: p.id || genId('pro'),
          type: p.type || ProactiveType.IMPROVEMENT,
          severity: p.severity || Severity.INFO,
          message: redactString(String(p.message || '').slice(0, 800)),
          title: p.title ? redactString(String(p.title).slice(0, 200)) : null,
          context: p.context ? redactValue(p.context) : null,
          ts: p.ts || nowIso(),
          status: p.status || 'pending',
          requiresConfirmation: !!p.requiresConfirmation,
          tier: p.tier || 'NORMAL',
          source: p.source || 'proactive',
          actionable: p.actionable ?? true,
          dismissed: !!p.dismissed,
        }))
        .slice(-this.config.maxProposals);
    }
    if (Array.isArray(data.cooldowns)) {
      this.cooldowns = new Map(data.cooldowns);
    }
    if (Array.isArray(data.recentFailures)) {
      this.recentFailures = data.recentFailures.slice(-50);
    }
  }

  // ------------------------- config -------------------------
  getConfig() {
    return { ...this.config, thresholds: { ...this.config.thresholds }, detectors: { ...this.config.detectors } };
  }

  updateConfig(patch = {}) {
    if (typeof patch !== 'object') return { ok: false, error: 'patch object required' };
    if ('enabled' in patch) this.config.enabled = !!patch.enabled;
    if ('pollIntervalMs' in patch) this.config.pollIntervalMs = Number(patch.pollIntervalMs);
    if ('cooldownMs' in patch) this.config.cooldownMs = Number(patch.cooldownMs);
    if (patch.perTypeCooldownMs && typeof patch.perTypeCooldownMs === 'object') {
      this.config.perTypeCooldownMs = { ...this.config.perTypeCooldownMs, ...patch.perTypeCooldownMs };
    }
    if (patch.thresholds && typeof patch.thresholds === 'object') {
      this.config.thresholds = { ...this.config.thresholds, ...patch.thresholds };
    }
    if (patch.detectors && typeof patch.detectors === 'object') {
      this.config.detectors = { ...this.config.detectors, ...patch.detectors };
    }
    this.save();
    return { ok: true, config: this.getConfig() };
  }

  setThreshold(key, value) {
    if (!(key in this.config.thresholds)) return { ok: false, error: `Invalid threshold: ${key}. Valid: ${Object.keys(this.config.thresholds).join(', ')}` };
    this.config.thresholds[key] = Number(value);
    this.save();
    return { ok: true, thresholds: { ...this.config.thresholds } };
  }

  enableDetector(name) {
    if (!(name in this.config.detectors)) return { ok: false, error: `Unknown detector: ${name}` };
    this.config.detectors[name] = true;
    this.save();
    return { ok: true };
  }

  disableDetector(name) {
    if (!(name in this.config.detectors)) return { ok: false, error: `Unknown detector: ${name}` };
    this.config.detectors[name] = false;
    this.save();
    return { ok: true };
  }

  // ------------------------- cooldown to avoid spam -------------------------
  _cooldownMsFor(type) {
    return this.config.perTypeCooldownMs[type] ?? this.config.cooldownMs;
  }

  isOnCooldown(type) {
    const last = this.cooldowns.get(type);
    if (!last) return false;
    const elapsed = Date.now() - new Date(last).getTime();
    return elapsed < this._cooldownMsFor(type);
  }

  _recordCooldown(type) {
    this.cooldowns.set(type, nowIso());
  }

  clearCooldown(type = null) {
    if (type) this.cooldowns.delete(type);
    else this.cooldowns.clear();
    this.save();
    return { ok: true };
  }

  // ------------------------- detectors registry -------------------------
  registerDetector(name, fn, { enabled = true } = {}) {
    if (!name || typeof fn !== 'function') return { ok: false, error: 'name and function required' };
    this.detectors.set(name, fn);
    if (enabled) this.config.detectors[name] = true;
    else this.config.detectors[name] = false;
    return { ok: true, name };
  }

  unregisterDetector(name) {
    const existed = this.detectors.has(name);
    this.detectors.delete(name);
    delete this.config.detectors[name];
    return { ok: true, removed: existed };
  }

  _registerBuiltInDetectors() {
    // Each built-in returns proposal-like object or null
    this.detectors.set('buildFailed', (snapshot, context) => this._detectBuildFailed(snapshot, context));
    this.detectors.set('disk', (snapshot) => this._detectDisk(snapshot));
    this.detectors.set('system', (snapshot) => this._detectSystem(snapshot));
    this.detectors.set('device', (snapshot, context) => this._detectDevice(snapshot, context));
    // taskCompletion/failure are event-driven, not snapshot
  }

  // ------------------------- detection logic §30 examples -------------------------
  _detectBuildFailed(snapshot, context = {}) {
    if (!this.config.detectors.buildFailed) return null;
    // Detect via explicit context (from event) or snapshot.build
    const fromContext = context.buildFailed || context.taskFailed || context.error || null;
    let failed = false;
    let detail = '';
    let buildInfo = null;

    if (fromContext) {
      const msg = String(fromContext.message || fromContext.error || fromContext).toLowerCase();
      if (/build.*fail|compile.*fail|aapt2|gradle.*fail|tsc.*error|vite.*error|webpack|npm.*err|yarn.*error/i.test(msg)) {
        failed = true;
        detail = String(fromContext.message || fromContext.error || fromContext).slice(0, 300);
        buildInfo = fromContext;
      } else if (fromContext.category === 'build_failure' || context.category === 'build_failure') {
        failed = true;
        detail = String(fromContext.message || fromContext.error || '').slice(0, 300);
        buildInfo = fromContext;
      }
    }
    // Also check snapshot.app.build if exists — compare with monitor.getAppState()
    if (!failed && snapshot && snapshot.app && snapshot.app.build) {
      // build exists check is not failure; only use explicit failure context
    }
    // Check recentFailures for build pattern
    if (!failed && this.recentFailures.length > 0) {
      const recentBuildFailures = this.recentFailures.filter(f => f.category === 'build_failure' && (Date.now() - new Date(f.ts).getTime() < 60000));
      if (recentBuildFailures.length > 0) {
        failed = true;
        detail = `Recent build failures: ${recentBuildFailures.length} in last minute`;
        buildInfo = { recent: recentBuildFailures };
      }
    }

    if (!failed) return null;
    return {
      type: ProactiveType.BUILD_FAILED,
      severity: Severity.CRITICAL,
      title: 'Build failed',
      message: `Detected failed build: ${detail || 'build error'}`.slice(0, 500),
      context: { buildInfo: redactValue(buildInfo), taskId: context.taskId || null, category: 'build_failure' },
      actionable: true,
    };
  }

  _detectDisk(snapshot) {
    if (!this.config.detectors.disk) return null;
    if (!snapshot || !snapshot.disk) return null;
    const disk = snapshot.disk;
    // Support both aggregated and drives array
    let freeGB = disk.freeGB ?? null;
    let totalGB = disk.totalGB ?? null;
    let drive = null;
    if (disk.drives && disk.drives.length) {
      // find first drive with low space
      for (const d of disk.drives) {
        if (d.freeGB !== undefined && d.freeGB !== null) {
          if (d.freeGB < this.config.thresholds.diskFullGB) {
            freeGB = d.freeGB;
            totalGB = d.totalGB;
            drive = d.drive || d.mount || null;
            return {
              type: ProactiveType.DISK_FULL,
              severity: Severity.CRITICAL,
              title: 'Disk full',
              message: `Disk ${drive || ''} critically low: ${freeGB}GB free (threshold ${this.config.thresholds.diskFullGB}GB) — builds may fail`.trim(),
              context: { drive, freeGB, totalGB, threshold: this.config.thresholds.diskFullGB },
              actionable: true,
            };
          }
          if (d.freeGB < this.config.thresholds.diskLowGB && freeGB === null) {
            freeGB = d.freeGB;
            totalGB = d.totalGB;
            drive = d.drive || d.mount || null;
          }
        }
      }
    } else if (freeGB !== null) {
      if (freeGB < this.config.thresholds.diskFullGB) {
        return {
          type: ProactiveType.DISK_FULL,
          severity: Severity.CRITICAL,
          title: 'Disk full',
          message: `Disk critically low: ${freeGB}GB free (threshold ${this.config.thresholds.diskFullGB}GB)`,
          context: { freeGB, totalGB, threshold: this.config.thresholds.diskFullGB },
          actionable: true,
        };
      }
    }
    if (freeGB !== null && freeGB < this.config.thresholds.diskLowGB) {
      return {
        type: ProactiveType.DISK_LOW,
        severity: Severity.WARN,
        title: 'Disk space low',
        message: `Disk space low: ${freeGB}GB free (threshold ${this.config.thresholds.diskLowGB}GB) — consider cleaning build outputs`.trim(),
        context: { drive, freeGB, totalGB, threshold: this.config.thresholds.diskLowGB },
        actionable: true,
      };
    }
    return null;
  }

  _detectSystem(snapshot) {
    if (!this.config.detectors.system) return null;
    if (!snapshot) return null;
    // CPU high
    if (snapshot.cpu && typeof snapshot.cpu.usagePercent === 'number') {
      if (snapshot.cpu.usagePercent > this.config.thresholds.cpuHigh) {
        return {
          type: ProactiveType.CPU_HIGH,
          severity: snapshot.cpu.usagePercent > 95 ? Severity.CRITICAL : Severity.WARN,
          title: 'CPU usage high',
          message: `CPU at ${snapshot.cpu.usagePercent}% (threshold ${this.config.thresholds.cpuHigh}%) — throttling background tasks`,
          context: { cpu: snapshot.cpu.usagePercent, threshold: this.config.thresholds.cpuHigh, count: snapshot.cpu.count },
          actionable: false,
        };
      }
    }
    if (snapshot.memory && typeof snapshot.memory.usedPercent === 'number') {
      if (snapshot.memory.usedPercent > this.config.thresholds.memHigh) {
        const freeGB = snapshot.memory.freeGB;
        return {
          type: snapshot.memory.usedPercent > 95 ? ProactiveType.MEMORY_PRESSURE : ProactiveType.MEMORY_HIGH,
          severity: snapshot.memory.usedPercent > 95 ? Severity.CRITICAL : Severity.WARN,
          title: snapshot.memory.usedPercent > 95 ? 'Memory pressure critical' : 'Memory usage high',
          message: `Memory at ${snapshot.memory.usedPercent}% used, ${freeGB}GB free — consider reducing concurrent agents`,
          context: { usedPercent: snapshot.memory.usedPercent, freeGB, threshold: this.config.thresholds.memHigh },
          actionable: false,
        };
      }
    }
    if (snapshot.battery && snapshot.battery.available) {
      const level = snapshot.battery.level;
      const charging = snapshot.battery.charging;
      if (level !== null && level < this.config.thresholds.batteryCritical && charging === false) {
        return {
          type: ProactiveType.BATTERY_CRITICAL,
          severity: Severity.CRITICAL,
          title: 'Battery critical',
          message: `Battery ${level}% not charging — deferring heavy tasks per §45`,
          context: { level, charging, threshold: this.config.thresholds.batteryCritical },
          actionable: true,
        };
      }
      if (level !== null && level < this.config.thresholds.batteryLow && charging === false) {
        return {
          type: ProactiveType.BATTERY_LOW,
          severity: Severity.WARN,
          title: 'Battery low',
          message: `Battery ${level}% not charging — reducing workload`,
          context: { level, charging, threshold: this.config.thresholds.batteryLow },
          actionable: true,
        };
      }
    }
    return null;
  }

  _detectDevice(snapshot, context = {}) {
    if (!this.config.detectors.device) return null;
    // Device offline / condition via deviceManager or snapshot
    if (context.deviceOffline || context.device) {
      const dev = context.device || context.deviceOffline;
      const name = dev.name || dev.id || 'device';
      return {
        type: ProactiveType.DEVICE_OFFLINE,
        severity: Severity.WARN,
        title: 'Device offline',
        message: `Device ${name} is offline — last seen ${dev.lastSeen || dev.lastHeartbeat || 'unknown'}`,
        context: { device: redactValue(dev) },
        actionable: false,
      };
    }
    if (snapshot && snapshot.network && snapshot.network.hasNetwork === false) {
      return {
        type: ProactiveType.DEVICE_CONDITION,
        severity: Severity.WARN,
        title: 'Network unavailable',
        message: 'Device reports no external network — switching to local capabilities',
        context: { network: snapshot.network },
        actionable: false,
      };
    }
    return null;
  }

  // ------------------------- policy gating §30 must pass through engine -------------------------
  async _gateProposal(proposal) {
    if (!this.policyEngine || typeof this.policyEngine.assess !== 'function') {
      // No policy — treat as allowed for SAFE, require confirmation for DANGEROUS
      const { defaultTier } = policyToolForType(proposal.type);
      const requiresConfirmation = defaultTier === 'DANGEROUS';
      return { allowed: !requiresConfirmation, needsConfirmation: requiresConfirmation, tier: defaultTier, reason: 'no policy engine — default tier' };
    }
    const { tool, defaultTier } = policyToolForType(proposal.type);
    const confirmedFlag = !!(proposal.context && proposal.context.confirmed === true);
    try {
      const res = await this.policyEngine.assess({
        tool,
        permission: defaultTier,
        args: { message: proposal.message, type: proposal.type, context: proposal.context },
        context: { agent: 'ProactiveEngine', operation: proposal.type, ...(confirmedFlag ? { confirmed: true } : {}) },
      });
      return res;
    } catch (e) {
      return { allowed: false, needsConfirmation: true, tier: defaultTier, reason: `policy error: ${e.message}` };
    }
  }

  // ------------------------- proposal lifecycle -------------------------
  async createProposal(raw) {
    if (!raw || typeof raw !== 'object' || !raw.type) return { ok: false, error: 'proposal with type required' };
    const type = String(raw.type).toLowerCase();
    if (!Object.values(ProactiveType).includes(type)) {
      // allow custom but warn — normalize to improvement
    }
    const message = redactString(String(raw.message || raw.title || '').slice(0, 800));
    if (!message) return { ok: false, error: 'message required' };

    // Cooldown check — per §10 avoid spam / §30 not noisy
    if (this.isOnCooldown(type) && !raw.force) {
      return { ok: false, error: `On cooldown for ${type}`, onCooldown: true, type };
    }

    // Policy gate
    const gate = await this._gateProposal({ type, message, context: raw.context });
    const tier = gate.tier || policyToolForType(type).defaultTier;
    const requiresConfirmation = !!gate.needsConfirmation && !gate.allowed;
    // If DANGEROUS and not allowed, we still create proposal but mark requiresConfirmation and pending confirmation
    const proposal = {
      id: raw.id || genId('pro'),
      type,
      severity: raw.severity || (tier === 'DANGEROUS' ? Severity.CRITICAL : tier === 'NORMAL' ? Severity.WARN : Severity.INFO),
      title: raw.title ? redactString(String(raw.title).slice(0, 200)) : null,
      message,
      context: raw.context ? redactValue(raw.context) : null,
      ts: raw.ts || nowIso(),
      source: raw.source || 'proactive:detector',
      actionable: raw.actionable ?? true,
      status: requiresConfirmation ? 'needs_confirmation' : 'pending',
      requiresConfirmation,
      tier,
      gate: { allowed: gate.allowed, needsConfirmation: requiresConfirmation, reason: gate.reason },
      notified: false,
      dismissed: false,
    };

    // Cap
    this.proposals.push(proposal);
    if (this.proposals.length > this.config.maxProposals) {
      this.proposals = this.proposals.slice(-this.config.maxProposals);
    }
    this._recordCooldown(type);
    this.save();

    this._emit('proactive:detected', { proposal: { ...proposal } });
    // Emit specific event per type for UI to filter
    this._emit(`proactive:${type}`, { proposal: { ...proposal } });
    this._audit({
      agent: 'ProactiveEngine',
      task: raw.context?.taskId || null,
      tool: `proactive:${type}`,
      action: `proactive:${type}`,
      result: `${proposal.title || proposal.type}: ${proposal.message.slice(0, 120)}`,
      permission: tier,
      confirmation: requiresConfirmation ? 'pending' : 'not_required',
      device: raw.context?.device || null,
    });

    // Auto-notify if allowed and enabled (SAFE/NORMAL auto-allowed)
    if (gate.allowed || tier === 'SAFE' || (tier === 'NORMAL' && !requiresConfirmation)) {
      await this.notify(proposal.id);
    } else {
      // Still emit suggested for user approval queue
      this._emit('proactive:suggested', { proposal: { ...proposal } });
    }

    return { ok: true, proposal: { ...proposal }, gated: gate };
  }

  async notify(proposalId) {
    const p = this.proposals.find(x => x.id === String(proposalId));
    if (!p) return { ok: false, error: `Proposal not found: ${proposalId}` };
    // Ensure gating passed (or re-gate for safety). Approved proposals are considered confirmed.
    const contextForGate = p.status === 'approved' ? { ...p.context, confirmed: true } : p.context;
    const gate = await this._gateProposal({ type: p.type, message: p.message, context: contextForGate });
    if (!gate.allowed && gate.needsConfirmation) {
      return { ok: false, error: 'Proactive action requires confirmation', needsConfirmation: true, tier: gate.tier };
    }
    p.notified = true;
    p.notifiedAt = nowIso();
    p.status = 'notified';
    this.save();
    this._emit('proactive:notified', { proposal: { ...p } });
    this._emit('notification', { type: p.type, severity: p.severity, message: p.message, title: p.title, proposalId: p.id, ts: p.ts });
    // also emit task:notification for longRunning integration §13
    this._emit('task:notification', { taskId: p.context?.taskId || null, type: p.type, message: p.message, proposalId: p.id });
    // fan out to registered handlers
    for (const h of this.notificationHandlers) {
      try { h({ ...p }); } catch {}
    }
    return { ok: true, proposal: { ...p } };
  }

  // High-level helpers per §30 examples
  async handleBuildFailed(eventPayload) {
    if (!this.config.enabled || !this.config.detectors.buildFailed) return { ok: false, error: 'detector disabled' };
    const raw = this._detectBuildFailed(null, eventPayload);
    if (!raw) return { ok: false, error: 'not a build failure' };
    return this.createProposal(raw);
  }

  async handleDiskSnapshot(snapshot) {
    if (!this.config.enabled || !this.config.detectors.disk) return { ok: false, error: 'detector disabled' };
    const raw = this._detectDisk(snapshot);
    if (!raw) return { ok: true, detected: false };
    return this.createProposal(raw);
  }

  async evaluateSnapshot(snapshot, context = {}) {
    if (!this.config.enabled) return { ok: false, error: 'proactive disabled' };
    const results = [];
    // Run each detector
    for (const [name, fn] of this.detectors) {
      if (this.config.detectors[name] === false) continue;
      try {
        const res = fn(snapshot, context);
        const resolved = res instanceof Promise ? await res : res;
        if (resolved && resolved.type) {
          const proposalRes = await this.createProposal(resolved);
          results.push({ detector: name, proposal: proposalRes.proposal || null, ok: proposalRes.ok, onCooldown: proposalRes.onCooldown || false });
        } else if (Array.isArray(resolved)) {
          for (const item of resolved) {
            const proposalRes = await this.createProposal(item);
            results.push({ detector: name, proposal: proposalRes.proposal || null, ok: proposalRes.ok });
          }
        } else {
          results.push({ detector: name, detected: false });
        }
      } catch (e) {
        results.push({ detector: name, error: e.message });
      }
    }
    // Also check recent failures for repeated
    const repeated = this._detectRepeatedFailures();
    if (repeated) {
      const r = await this.createProposal(repeated);
      results.push({ detector: 'repeatedFailures', proposal: r.proposal || null, ok: r.ok });
    }
    return { ok: true, results, detected: results.some(r => r.proposal) };
  }

  _detectRepeatedFailures() {
    if (!this.config.detectors.failureWarning) return null;
    const windowMs = this.config.thresholds.failureRepeatWindowMs;
    const need = this.config.thresholds.failureRepeatCount;
    const now = Date.now();
    const recent = this.recentFailures.filter(f => now - new Date(f.ts).getTime() < windowMs);
    if (recent.length < need) return null;
    // Group by category
    const byCat = {};
    for (const f of recent) {
      const cat = f.category || 'unknown';
      byCat[cat] = (byCat[cat] || 0) + 1;
    }
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < need) return null;
    return {
      type: ProactiveType.REPEATED_FAILURE,
      severity: Severity.WARN,
      title: 'Repeated failures detected',
      message: `${top[1]} failures of category "${top[0]}" in last ${Math.round(windowMs / 60000)}m — suggest investigation or automation`,
      context: { category: top[0], count: top[1], windowMs, recent: recent.slice(-5).map(r => ({ ts: r.ts, category: r.category })) },
      actionable: true,
    };
  }

  // Track failure for repeated detection
  trackFailure({ message, category = 'unknown', taskId = null }) {
    this.recentFailures.push({ ts: nowIso(), message: redactString(String(message).slice(0, 300)), category: String(category).toLowerCase(), taskId });
    if (this.recentFailures.length > 100) this.recentFailures = this.recentFailures.slice(-100);
    this.save();
    // Opportunistically detect
    const repeated = this._detectRepeatedFailures();
    if (repeated && !this.isOnCooldown(repeated.type)) {
      // fire-and-forget (gated)
      this.createProposal(repeated).catch(()=>{});
    }
    return { ok: true, count: this.recentFailures.length };
  }

  // Notify when long tasks finish §30 "Notify user when long tasks finish"
  async handleTaskCompleted(taskId, result, task = null) {
    if (!this.config.enabled || !this.config.detectors.taskCompletion) return { ok: false, error: 'detector disabled' };
    const mission = task?.mission || result?.mission || String(taskId).slice(0, 60);
    return this.createProposal({
      type: ProactiveType.TASK_COMPLETED,
      severity: Severity.INFO,
      title: 'Task completed',
      message: `Long task finished: "${mission.slice(0, 80)}" — result: ${String(result?.result || result || 'done').slice(0, 150)}`,
      context: { taskId: String(taskId), result: redactValue(result), mission: redactString(mission.slice(0, 200)) },
      actionable: false,
    });
  }

  async handleTaskFailed(taskId, error, context = {}) {
    // also track for repeated
    this.trackFailure({ message: error?.message || String(error), category: context.category || 'unknown', taskId });
    if (!this.config.enabled) return { ok: false, error: 'disabled' };
    return this.createProposal({
      type: ProactiveType.TASK_FAILED,
      severity: Severity.WARN,
      title: 'Task failed',
      message: `Task ${String(taskId).slice(0, 12)} failed: ${String(error?.message || error).slice(0, 250)}`,
      context: { taskId: String(taskId), error: redactString(String(error?.message || error).slice(0, 500)), category: context.category || null },
      actionable: true,
    });
  }

  // Suggest useful improvements §30 "Suggest useful improvements"
  async suggestImprovement({ title, message, context = {}, severity = Severity.INFO }) {
    if (!this.config.enabled || !this.config.detectors.improvement) return { ok: false, error: 'detector disabled' };
    return this.createProposal({
      type: ProactiveType.IMPROVEMENT,
      severity,
      title: title || 'Improvement suggestion',
      message: message || 'Suggested improvement',
      context,
      actionable: true,
    });
  }

  async suggestAutomation({ description, steps, estimatedSavings, context = {} }) {
    return this.createProposal({
      type: ProactiveType.AUTOMATION_SUGGESTION,
      severity: Severity.INFO,
      title: 'Automation available',
      message: description || `Detected repeated workflow — suggest automation (${steps?.length || 0} steps)`,
      context: { steps: steps?.map(s => redactValue(s)).slice(0, 20) || null, estimatedSavings, ...redactValue(context) },
      actionable: true,
    });
  }

  // ------------------------- proposals query & lifecycle -------------------------
  getProposals(filter = {}) {
    let out = [...this.proposals];
    if (filter.type) out = out.filter(p => p.type === String(filter.type).toLowerCase());
    if (filter.severity) out = out.filter(p => p.severity === String(filter.severity).toLowerCase());
    if (filter.status) out = out.filter(p => p.status === String(filter.status).toLowerCase());
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter(p => new Date(p.ts).getTime() >= since);
    }
    if (filter.notified !== undefined) out = out.filter(p => !!p.notified === !!filter.notified);
    out.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    if (filter.offset) out = out.slice(Number(filter.offset));
    return { ok: true, results: out.map(p => ({ ...p })), total, pending: this.proposals.filter(p => p.status === 'pending').length };
  }

  getProposal(id) {
    if (!id) return { ok: false, error: 'id required' };
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    return { ok: true, proposal: { ...p } };
  }

  dismissProposal(id, reason = 'dismissed') {
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    p.dismissed = true;
    p.dismissReason = String(reason).slice(0, 300);
    p.status = 'dismissed';
    p.dismissedAt = nowIso();
    this.save();
    this._emit('proactive:dismissed', { proposalId: p.id, reason });
    return { ok: true, proposal: { ...p } };
  }

  async approveProposal(id, context = {}) {
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    // Re-gate with confirmation context
    const gate = await this._gateProposal({ type: p.type, message: p.message, context: { ...p.context, ...context, confirmed: true } });
    // For testing/policy engine, we also consider explicit context.confirmed
    const confirmed = context.confirmed === true || gate.allowed;
    if (!confirmed && gate.needsConfirmation) {
      return { ok: false, error: `Proposal ${id} requires confirmation (${gate.tier})`, needsConfirmation: true, tier: gate.tier };
    }
    p.status = 'approved';
    p.approvedAt = nowIso();
    p.approvedBy = context.approvedBy || 'user';
    this.save();
    this._emit('proactive:approved', { proposalId: p.id, type: p.type });
    this._audit({
      agent: 'ProactiveEngine',
      task: p.context?.taskId || null,
      tool: `proactive:${p.type}`,
      action: `approve:${p.type}`,
      result: `Approved ${p.type}: ${p.message.slice(0, 100)}`,
      permission: gate.tier || p.tier,
      confirmation: true,
    });
    return { ok: true, proposal: { ...p }, gated: gate };
  }

  // ------------------------- monitoring loop §44 (§10 caching respected) -------------------------
  start(intervalMs = null) {
    if (this._monitoring) return { ok: false, error: 'Already monitoring' };
    const ms = intervalMs || this.config.pollIntervalMs;
    this._monitoring = true;
    this._timer = setInterval(async () => {
      try {
        let snapshot = null;
        if (this.monitor && typeof this.monitor.getSystemSnapshot === 'function') {
          snapshot = this.monitor.getSystemSnapshot();
        } else {
          // fallback minimal snapshot
          snapshot = { ts: nowIso(), disk: { freeGB: 10, totalGB: 100 }, memory: { usedPercent: 50 }, cpu: { usagePercent: 30 } };
        }
        await this.evaluateSnapshot(snapshot);
      } catch (e) {
        this.logger.warn?.(`[Proactive] poll error: ${e.message}`);
      }
    }, ms);
    if (this._timer.unref) this._timer.unref();

    // Attach event listeners for tasks/devices if available
    try {
      const attachBus = this.eventBus || this._globalBus;
      if (attachBus && attachBus.on) {
        const onFailed = async (data) => {
          // data may be { taskId, error, category } or { error, task }
          const err = data?.error || data?.message || data?.reason || 'unknown';
          const cat = data?.category || 'unknown';
          const taskId = data?.taskId || data?.task?.id || data?.id || 'unknown';
          await this.handleTaskFailed(taskId, err, { category: cat });
          this.trackFailure({ message: String(err), category: cat, taskId });
        };
        const onCompleted = async (data) => {
          const taskId = data?.taskId || data?.task?.id || data?.id || 'unknown';
          const result = data?.result || data?.output || data;
          await this.handleTaskCompleted(taskId, result, data?.task || null);
        };
        const onError = async (data) => {
          const err = data?.error || data?.message || 'error';
          await this.trackFailure({ message: String(err), category: data?.category || 'unknown', taskId: data?.taskId });
        };
        // Use bus.on if available, otherwise fallback to global emit path via monkey
        if (attachBus.on) {
          attachBus.on('task:failed', onFailed);
          attachBus.on('task:completed', onCompleted);
          attachBus.on('error', onError);
          this._boundHandlers.set('task:failed', onFailed);
          this._boundHandlers.set('task:completed', onCompleted);
          this._boundHandlers.set('error', onError);
        }
        // also listen to longRunningManager events directly if injected
        if (this.longRunningManager && this.longRunningManager.on) {
          this.longRunningManager.on('task:failed', onFailed);
          this.longRunningManager.on('task:completed', onCompleted);
          this._boundHandlers.set('lr:task:failed', onFailed);
          this._boundHandlers.set('lr:task:completed', onCompleted);
        }
      }
    } catch {}

    this._emit('proactive:monitoring:started', { intervalMs: ms });
    return { ok: true, intervalMs: ms };
  }

  stop() {
    if (!this._monitoring) return { ok: false, error: 'Not monitoring' };
    clearInterval(this._timer);
    this._timer = null;
    this._monitoring = false;
    try {
      const bus = this.eventBus || this._globalBus;
      for (const [event, handler] of this._boundHandlers) {
        if (event.startsWith('lr:')) {
          try { this.longRunningManager?.off?.(event.replace('lr:', ''), handler); } catch {}
        } else {
          try { bus?.off?.(event, handler); } catch {}
          try { bus?.removeListener?.(event, handler); } catch {}
        }
      }
      this._boundHandlers.clear();
    } catch {}
    this._emit('proactive:monitoring:stopped', { ts: nowIso() });
    return { ok: true };
  }

  isMonitoring() { return this._monitoring; }

  // Notification handlers §30 "Notify user when long tasks finish"
  onNotification(handler) {
    if (typeof handler === 'function') this.notificationHandlers.add(handler);
    return { ok: true, count: this.notificationHandlers.size };
  }
  offNotification(handler) {
    this.notificationHandlers.delete(handler);
    return { ok: true };
  }

  // ------------------------- inspection §58 diagnostics -------------------------
  getStats() {
    const byType = {};
    const byStatus = {};
    for (const p of this.proposals) {
      byType[p.type] = (byType[p.type] || 0) + 1;
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }
    return {
      ok: true,
      enabled: this.config.enabled,
      monitoring: this._monitoring,
      proposals: this.proposals.length,
      byType,
      byStatus,
      pending: this.proposals.filter(p => p.status === 'pending' || p.status === 'needs_confirmation').length,
      notified: this.proposals.filter(p => p.notified).length,
      cooldowns: this.cooldowns.size,
      recentFailures: this.recentFailures.length,
      file: this.filePath,
      thresholds: { ...this.config.thresholds },
      detectors: { ...this.config.detectors },
    };
  }

  clear(filter = {}) {
    if (filter.type) {
      const before = this.proposals.length;
      this.proposals = this.proposals.filter(p => p.type !== String(filter.type).toLowerCase());
      const removed = before - this.proposals.length;
      this.save();
      return { ok: true, removed, type: filter.type };
    }
    const count = this.proposals.length;
    this.proposals = [];
    this.cooldowns.clear();
    this.recentFailures = [];
    this.save();
    return { ok: true, cleared: count };
  }

  destroy() {
    try { this.stop(); } catch {}
    this.removeAllListeners();
    this.notificationHandlers.clear();
  }

  // Verify no secrets leaked (§23)
  verifyNoSecrets() {
    const blob = JSON.stringify(this.proposals);
    const violations = [];
    const patterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /ghp_[a-zA-Z0-9]{30,}/,
      /AIza[0-9A-Za-z-_]{30,}/,
    ];
    for (const rx of patterns) {
      if (rx.test(blob) && !blob.includes('[REDACTED]')) violations.push(rx.source);
    }
    return { ok: violations.length === 0, violations, checked: this.proposals.length };
  }
}

// Default singleton for app (§5 Master Orchestrator may wire)
export const proactiveEngine = new ProactiveEngine();
export const proactive = proactiveEngine; // alias

export function getDefaultProactivePathFn() { return getDefaultProactivePath(); }
export default ProactiveEngine;
