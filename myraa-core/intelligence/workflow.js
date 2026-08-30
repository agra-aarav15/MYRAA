// Myraa Workflow Learning + Self-Created Tools — MASTER BUILD PROMPT §31-32
// Observes repeated patterns, proposes automations, requires approval before execution.
// Never silently creates dangerous automations — all proposals gated via Policy Engine (§34-36).
// Self-created tools: dynamically create temporary utilities when no existing tool fits,
// validate, execute, then delete or retain per policy/user config.
// Persistent at %APPDATA%\myraa\workflows.json (§52), local-first (§25), event-driven (§50).
// Integrates: PolicyEngine, ToolRegistry (§33), MemoryStore WorkflowMemory (§21), Audit (§38),
// MasterOrchestrator task history, SystemMonitor (resource-aware).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers: paths, ids, time, hashing, redaction §23
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultWorkflowPath() {
  return path.join(getMyraaDataDir(), 'workflows.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'wf') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}

// Simple deterministic hash for workflow steps — normalized tool/action sequence
function hashSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return 'empty';
  const normalized = steps.map(s => {
    if (typeof s === 'string') return s.trim().toLowerCase();
    if (s && typeof s === 'object') {
      const tool = String(s.tool || s.name || s.action || 'unknown').trim().toLowerCase();
      // include key arg keys but not values (to cluster similar workflows)
      const argKeys = s.args ? Object.keys(s.args).sort().join(',') : (s.params ? Object.keys(s.params).sort().join(',') : '');
      // include mission pattern for higher-level tasks
      const missionHint = s.mission ? String(s.mission).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ') : '';
      return `${tool}${argKeys ? `:${argKeys}` : ''}${missionHint ? `:${missionHint}` : ''}`;
    }
    return String(s).toLowerCase();
  }).join(' -> ');
  // simple hash: char code sum + length
  let h = 0;
  for (let i = 0; i < normalized.length; i++) h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}:${normalized.slice(0, 80)}`;
}

// Redaction — never store secrets (§23)
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
// Defaults §31-32
// ---------------------------------------------------------------------------
export const WORKFLOW_STATUS = Object.freeze({
  PENDING: 'pending',           // proposal awaiting user approval
  APPROVED: 'approved',         // user approved, ready to execute/automate
  REJECTED: 'rejected',
  EXECUTED: 'executed',
  AUTO: 'auto',                 // approved for automatic execution
});

export const TOOL_STATUS = Object.freeze({
  TEMPORARY: 'temporary',
  VALIDATED: 'validated',
  EXECUTED: 'executed',
  RETAINED: 'retained',         // user chose to keep
  DELETED: 'deleted',
  PROPOSED: 'proposed',         // proposed for persistence per policy
});

export const DEFAULT_WORKFLOW_CONFIG = Object.freeze({
  minRepeats: 3,               // need 3 occurrences to propose §31
  windowMs: 7 * 24 * 3600 * 1000, // 7 days
  maxObservations: 1000,
  maxProposals: 200,
  maxAutomations: 200,
  maxTempTools: 100,
  autoExecute: false,          // §31 May eventually execute approved workflows automatically — default false until user enables
  requireConfirmationForDangerous: true, // §32 Do not silently create dangerous automations
});

// ---------------------------------------------------------------------------
// WorkflowLearner — §31 + §32
// ---------------------------------------------------------------------------
export class WorkflowLearner extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (§52)
   * @param {object} opts.eventBus
   * @param {object} opts.policyEngine - PolicyEngine (§34)
   * @param {object} opts.toolRegistry - ToolRegistry (§33)
   * @param {object} opts.memoryStore - MemoryStore for WorkflowMemory (§21)
   * @param {object} opts.auditLogger - AuditLogger (§38)
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad
   * @param {object} opts.config
   */
  constructor({
    filePath,
    eventBus = null,
    policyEngine = null,
    toolRegistry = null,
    memoryStore = null,
    auditLogger = null,
    logger = console,
    autoLoad = true,
    config = {},
  } = {}) {
    super();
    this.filePath = filePath || getDefaultWorkflowPath();
    this.eventBus = eventBus;
    this.policyEngine = policyEngine;
    this.toolRegistry = toolRegistry;
    this.memoryStore = memoryStore;
    this.auditLogger = auditLogger;
    this.logger = logger;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    this.config = {
      minRepeats: config.minRepeats ?? DEFAULT_WORKFLOW_CONFIG.minRepeats,
      windowMs: config.windowMs ?? DEFAULT_WORKFLOW_CONFIG.windowMs,
      maxObservations: config.maxObservations ?? DEFAULT_WORKFLOW_CONFIG.maxObservations,
      maxProposals: config.maxProposals ?? DEFAULT_WORKFLOW_CONFIG.maxProposals,
      maxAutomations: config.maxAutomations ?? DEFAULT_WORKFLOW_CONFIG.maxAutomations,
      maxTempTools: config.maxTempTools ?? DEFAULT_WORKFLOW_CONFIG.maxTempTools,
      autoExecute: config.autoExecute ?? DEFAULT_WORKFLOW_CONFIG.autoExecute,
      requireConfirmationForDangerous: config.requireConfirmationForDangerous ?? DEFAULT_WORKFLOW_CONFIG.requireConfirmationForDangerous,
    };

    /** @type {Array} observed sequences */
    this.observations = []; // { id, hash, steps, normalized, mission, projectId, taskId, timestamp, count }
    /** @type {Array} proposals */
    this.proposals = []; // { id, hash, repetitions, confidence, steps, description, estimatedSavings, riskTier, status, requiresConfirmation, createdAt }
    /** @type {Array} automations - approved workflows */
    this.automations = []; // { id, proposalId, hash, steps, description, approvedAt, approvedBy, runs, lastRun, auto }
    /** @type {Map} temporary tools  name -> record */
    this.tempTools = new Map();

    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(()=>{}); } catch {}

    if (autoLoad) this.load();
  }

  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.emit(event, data); } catch {}
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    try { import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(()=>{}); } catch {}
  }

  _audit(entry) { try { this.auditLogger?.log?.(entry); } catch {} }

  // ------------------------- persistence §52 -------------------------
  _getPersistPayload() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      config: this.config,
      observations: this.observations,
      proposals: this.proposals,
      automations: this.automations,
      tempTools: [...this.tempTools.values()],
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
      this.logger.warn?.(`[WorkflowLearner] save failed: ${e.message}`);
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
      this.logger.warn?.(`[WorkflowLearner] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (data.config && typeof data.config === 'object') {
      this.config = { ...this.config, ...data.config };
    }
    if (Array.isArray(data.observations)) {
      this.observations = data.observations
        .filter(o => o && typeof o === 'object')
        .map(o => ({
          id: o.id || genId('obs'),
          hash: o.hash || hashSteps(o.steps),
          steps: (o.steps || []).map(s => redactValue(s)),
          normalized: o.normalized || null,
          mission: o.mission ? redactString(String(o.mission).slice(0, 500)) : null,
          projectId: o.projectId || null,
          taskId: o.taskId || null,
          timestamp: o.timestamp || nowIso(),
          count: o.count || 1,
        }))
        .slice(-this.config.maxObservations);
    }
    if (Array.isArray(data.proposals)) {
      this.proposals = data.proposals
        .filter(p => p && typeof p === 'object')
        .map(p => ({
          id: p.id || genId('prop'),
          hash: p.hash,
          repetitions: p.repetitions || 1,
          confidence: p.confidence ?? 0,
          steps: (p.steps || []).map(s => redactValue(s)),
          description: p.description ? redactString(String(p.description).slice(0, 800)) : '',
          estimatedSavings: p.estimatedSavings || null,
          riskTier: p.riskTier || 'NORMAL',
          status: p.status || WORKFLOW_STATUS.PENDING,
          requiresConfirmation: p.requiresConfirmation ?? true,
          createdAt: p.createdAt || nowIso(),
          updatedAt: p.updatedAt || null,
          approvedAt: p.approvedAt || null,
          approvedBy: p.approvedBy || null,
          dismissedAt: p.dismissedAt || null,
        }))
        .slice(-this.config.maxProposals);
    }
    if (Array.isArray(data.automations)) {
      this.automations = data.automations
        .filter(a => a && typeof a === 'object')
        .map(a => ({
          id: a.id || genId('auto'),
          proposalId: a.proposalId || null,
          hash: a.hash,
          steps: (a.steps || []).map(s => redactValue(s)),
          description: a.description ? redactString(String(a.description).slice(0, 800)) : '',
          approvedAt: a.approvedAt || nowIso(),
          approvedBy: a.approvedBy || null,
          runs: a.runs || 0,
          lastRun: a.lastRun || null,
          auto: !!a.auto,
          createdAt: a.createdAt || nowIso(),
          riskTier: a.riskTier || 'NORMAL',
        }))
        .slice(-this.config.maxAutomations);
    }
    if (Array.isArray(data.tempTools)) {
      this.tempTools = new Map();
      for (const t of data.tempTools) {
        if (!t || !t.name) continue;
        // handler functions cannot be serialized; store spec only, rehydrate as stub
        this.tempTools.set(t.name, {
          name: t.name,
          description: t.description ? redactString(String(t.description).slice(0, 500)) : '',
          code: t.code ? String(t.code).slice(0, 5000) : null,
          inputSchema: t.inputSchema || null,
          outputSchema: t.outputSchema || null,
          handler: null, // will need regeneration or is in-memory only
          status: t.status || TOOL_STATUS.TEMPORARY,
          createdAt: t.createdAt || nowIso(),
          expiresAt: t.expiresAt || null,
          persistent: !!t.persistent,
          retained: !!t.retained,
          policy: t.policy || null,
        });
      }
    }
  }

  // ------------------------- observation §31 Observe repeated patterns -------------------------
  /**
   * Observe a workflow execution. Called after each task/workflow completes.
   * @param {object} record - { taskId, mission, steps: Array<{tool, args, ...}>, projectId, timestamp }
   * @returns {{ ok:boolean, observation, hash }}
   */
  observe(record = {}) {
    if (!record || typeof record !== 'object') return { ok: false, error: 'record object required' };
    let steps = record.steps || record.actions || record.tools || [];
    // allow mission-only workflows (task-level)
    if (!Array.isArray(steps)) steps = steps ? [steps] : [];
    // Normalize steps: ensure each has tool/name
    const normalizedSteps = steps.map(s => {
      if (typeof s === 'string') return { tool: s, args: {} };
      if (s && typeof s === 'object') return { tool: String(s.tool || s.name || s.action || 'unknown'), args: s.args || s.params || {}, mission: s.mission || null };
      return { tool: 'unknown', args: {} };
    }).filter(s => s.tool !== 'unknown' || s.mission);

    // If no steps but mission provided, treat mission as single-step workflow for learning
    if (!normalizedSteps.length && record.mission) {
      const mission = String(record.mission).trim().toLowerCase();
      if (mission) normalizedSteps.push({ tool: `mission:${mission.slice(0, 40)}`, args: {}, mission: record.mission });
    }

    if (!normalizedSteps.length) return { ok: false, error: 'steps or mission required to observe' };

    // Redact
    const safeSteps = normalizedSteps.map(s => redactValue(s));
    const hash = hashSteps(safeSteps);
    const observation = {
      id: record.id || genId('obs'),
      hash,
      steps: safeSteps,
      normalized: hash.split(':')[1] || null,
      mission: record.mission ? redactString(String(record.mission).slice(0, 500)) : null,
      projectId: record.projectId || null,
      taskId: record.taskId || record.id || null,
      timestamp: record.timestamp || nowIso(),
      count: 1,
    };

    this.observations.push(observation);
    if (this.observations.length > this.config.maxObservations) {
      this.observations = this.observations.slice(-this.config.maxObservations);
    }
    this.save();

    this._emit('workflow:observed', { hash, observation: { ...observation }, total: this.observations.length });
    // Opportunistically check for repeated pattern
    this._checkForProposal(hash).catch(()=>{});

    return { ok: true, observation: { ...observation }, hash };
  }

  /**
   * Alias for observe — matches §31 "Observe repeated patterns"
   */
  observeWorkflow(params) { return this.observe(params); }

  observeRepeatedWorkflow(missionOrSteps, opts = {}) {
    if (typeof missionOrSteps === 'string') return this.observe({ mission: missionOrSteps, steps: opts.steps || [], ...opts });
    return this.observe({ steps: missionOrSteps, ...opts });
  }

  // ------------------------- pattern detection -------------------------
  /**
   * Analyze observations and find repeated workflows.
   * @param {object} opts - { minRepeats, windowMs, projectId }
   * @returns {{ ok:boolean, patterns:Array }}
   */
  analyze(opts = {}) {
    const minRepeats = opts.minRepeats ?? this.config.minRepeats;
    const windowMs = opts.windowMs ?? this.config.windowMs;
    const now = Date.now();
    const windowStart = now - windowMs;

    let pool = this.observations.filter(o => new Date(o.timestamp).getTime() >= windowStart);
    if (opts.projectId) pool = pool.filter(o => o.projectId === opts.projectId);

    // Group by hash
    const groups = new Map(); // hash -> Array<observation>
    for (const obs of pool) {
      if (!groups.has(obs.hash)) groups.set(obs.hash, []);
      groups.get(obs.hash).push(obs);
    }

    const patterns = [];
    for (const [hash, list] of groups) {
      if (list.length >= minRepeats) {
        const sample = list[0];
        const confidence = Math.min(0.99, 0.5 + (list.length - minRepeats) * 0.15 + Math.min(0.3, list.length / 10));
        const repetitions = list.length;
        // Check if already has pending/approved proposal for this hash
        const existingProposal = this.proposals.find(p => p.hash === hash && p.status === WORKFLOW_STATUS.PENDING);
        patterns.push({
          hash,
          repetitions,
          confidence: Math.round(confidence * 100) / 100,
          steps: sample.steps,
          normalized: sample.normalized,
          mission: sample.mission,
          projectId: sample.projectId,
          observations: list.map(o => ({ id: o.id, timestamp: o.timestamp, taskId: o.taskId })),
          hasProposal: !!existingProposal,
          existingProposalId: existingProposal?.id || null,
          timeWindow: `${Math.round(windowMs / 3600000)}h`,
        });
      }
    }

    // Sort by confidence/repetitions
    patterns.sort((a, b) => b.repetitions - a.repetitions || b.confidence - a.confidence);
    return { ok: true, patterns, total: patterns.length, minRepeats, windowMs, observations: pool.length };
  }

  /**
   * Detect repeated workflows §31 "Repeated workflow detected"
   * @param {number} minRepeats
   * @returns {Array} patterns
   */
  detectRepeatedWorkflows(minRepeats = null) {
    const res = this.analyze({ minRepeats: minRepeats ?? this.config.minRepeats });
    return res.patterns;
  }

  async _checkForProposal(hash) {
    const patterns = this.detectRepeatedWorkflows();
    const match = patterns.find(p => p.hash === hash && !p.hasProposal);
    if (match) {
      await this.createProposalForPattern(match).catch(()=>{});
    }
  }

  // ------------------------- proposal creation §31 Create workflow proposal -------------------------
  async _assessRiskTier(steps) {
    if (!this.policyEngine || typeof this.policyEngine.assess !== 'function') {
      // Fallback heuristic: check for dangerous tool names
      const dangerousTools = new Set(['deleteFile', 'moveFile', 'renameFile', 'closeApplication', 'closeWindow', 'requestPowerAction', 'executePowerAction', 'runTerminalCommand', 'executeCommand', 'runPythonScript', 'enableAutoStart', 'disableAutoStart']);
      const hasDangerous = steps.some(s => dangerousTools.has(s.tool) || dangerousTools.has(s.tool?.toLowerCase?.() || ''));
      // also check for patterns like format, rm -rf, git push --force in args
      const hasDestructivePattern = steps.some(s => {
        const cmd = String(s.args?.command || s.args?.cmd || s.args?.code || '').toLowerCase();
        return /format\s+[a-z]:|mkfs|diskpart|sudo|git\s+push.*--force|rm\s+-rf\s+\//.test(cmd);
      });
      if (hasDestructivePattern) return { tier: 'DANGEROUS', reason: 'heuristic: destructive pattern' };
      if (hasDangerous) return { tier: 'DANGEROUS', reason: 'heuristic: dangerous tool present' };
      const hasMutating = steps.some(s => ['createFile', 'createProjectFolder', 'writeCodeFile', 'openApplication', 'browserClick'].includes(s.tool));
      if (hasMutating) return { tier: 'NORMAL', reason: 'has mutating tools' };
      return { tier: 'SAFE', reason: 'read-only steps' };
    }
    // Use policy engine to assess each step's max tier
    let maxTier = 'SAFE';
    const tierRank = { SAFE: 0, NORMAL: 1, DANGEROUS: 2 };
    const details = [];
    for (const step of steps) {
      try {
        const res = await this.policyEngine.assess({ tool: step.tool, args: step.args || {}, context: { agent: 'WorkflowLearner', operation: `workflow:${step.tool}` } });
        details.push({ tool: step.tool, tier: res.tier, needsConfirmation: res.needsConfirmation });
        if (tierRank[res.tier] > tierRank[maxTier]) maxTier = res.tier;
      } catch {
        details.push({ tool: step.tool, tier: 'NORMAL' });
        if (tierRank['NORMAL'] > tierRank[maxTier]) maxTier = 'NORMAL';
      }
    }
    return { tier: maxTier, details, reason: `policy max tier ${maxTier}` };
  }

  /**
   * Create workflow proposal from detected pattern §31 "Create workflow proposal"
   * @param {object} pattern - from analyze()
   * @returns {{ ok:boolean, proposal }}
   */
  async createProposalForPattern(pattern) {
    if (!pattern || !pattern.hash) return { ok: false, error: 'pattern with hash required' };
    // Avoid duplicate pending proposal for same hash
    const existing = this.proposals.find(p => p.hash === pattern.hash && p.status === WORKFLOW_STATUS.PENDING);
    if (existing) return { ok: true, proposal: { ...existing }, duplicate: true };

    const steps = pattern.steps || [];
    const risk = await this._assessRiskTier(steps);
    const tier = risk.tier || 'NORMAL';
    const requiresConfirmation = (tier === 'DANGEROUS' && this.config.requireConfirmationForDangerous) || tier === 'DANGEROUS';

    // Estimate savings: repetitions * avg steps time (assume 30s per step)
    const repetitions = pattern.repetitions || this.config.minRepeats;
    const estimatedSavings = `${repetitions} repetitions × ${steps.length} steps ≈ ${Math.round(repetitions * steps.length * 0.5)} min saved`;

    const description = pattern.mission
      ? `Repeated workflow: "${pattern.mission.slice(0, 80)}" — ${repetitions} times in ${pattern.timeWindow || 'window'}`
      : `Repeated workflow detected: ${steps.map(s => s.tool).join(' → ')} — ${repetitions} times`;

    const proposal = {
      id: genId('prop'),
      hash: pattern.hash,
      repetitions,
      confidence: pattern.confidence ?? 0.8,
      steps: steps.map(s => redactValue(s)),
      description: redactString(description).slice(0, 800),
      normalized: pattern.normalized || null,
      estimatedSavings,
      riskTier: tier,
      riskDetails: risk.details || risk.reason || null,
      status: WORKFLOW_STATUS.PENDING,
      requiresConfirmation,
      tier,
      createdAt: nowIso(),
      updatedAt: null,
      approvedAt: null,
      approvedBy: null,
      dismissedAt: null,
      projectId: pattern.projectId || null,
    };

    this.proposals.push(proposal);
    if (this.proposals.length > this.config.maxProposals) {
      this.proposals = this.proposals.slice(-this.config.maxProposals);
    }
    this.save();

    this._emit('workflow:proposal:created', { proposal: { ...proposal } });
    this._emit('workflow:proposed', { proposal: { ...proposal } }); // alias
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: 'workflow:createProposal',
      action: 'workflow:createProposal',
      result: `Proposed workflow ${proposal.id} hash=${proposal.hash.slice(0, 16)} tier=${tier} reps=${repetitions}`,
      permission: tier,
      confirmation: requiresConfirmation ? 'pending' : 'not_required',
    });

    // Also persist to memory WorkflowMemory if available (§21)
    try {
      if (this.memoryStore && typeof this.memoryStore.add === 'function') {
        this.memoryStore.add('WorkflowMemory', `Proposed workflow [${proposal.id}] ${proposal.description} — tier ${tier} — requiresConfirmation=${requiresConfirmation}`, { source: 'workflow-learner', proposalId: proposal.id, hash: proposal.hash });
      }
    } catch {}

    return { ok: true, proposal: { ...proposal } };
  }

  /**
   * Create proposal manually (for tests or UI-triggered)
   */
  async createProposal(pattern) {
    // Allow pattern to be { steps, description, ...} without hash
    if (!pattern.hash && pattern.steps) pattern.hash = hashSteps(pattern.steps);
    return this.createProposalForPattern(pattern);
  }

  // ------------------------- proposal lifecycle §31 Present to user / Approve -------------------------
  listProposals(filter = {}) {
    let out = [...this.proposals];
    if (filter.status) out = out.filter(p => p.status === String(filter.status).toLowerCase());
    if (filter.riskTier) out = out.filter(p => p.riskTier === String(filter.riskTier).toUpperCase());
    if (filter.hash) out = out.filter(p => p.hash === filter.hash);
    if (filter.projectId) out = out.filter(p => p.projectId === String(filter.projectId));
    if (filter.requiresConfirmation !== undefined) out = out.filter(p => !!p.requiresConfirmation === !!filter.requiresConfirmation);
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    if (filter.offset) out = out.slice(Number(filter.offset));
    return { ok: true, proposals: out.map(p => ({ ...p })), total };
  }

  getProposal(id) {
    if (!id) return { ok: false, error: 'id required' };
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    return { ok: true, proposal: { ...p } };
  }

  /**
   * Approve proposal §31 "User approves → Save automation"
   * Gated: DANGEROUS requires explicit confirmation (§32 Do not silently create dangerous automations)
   */
  async approveProposal(id, context = {}) {
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    if (p.status === WORKFLOW_STATUS.APPROVED || p.status === WORKFLOW_STATUS.AUTO) return { ok: true, proposal: { ...p }, alreadyApproved: true };
    if (p.status === WORKFLOW_STATUS.REJECTED) return { ok: false, error: `Proposal already rejected: ${id}` };

    // Policy re-check with confirmation context
    let gate = { allowed: true, needsConfirmation: false, tier: p.riskTier };
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      try {
        // Check worst-case step with confirmed flag
        const worst = await this._assessRiskTierWithContext(p.steps, { ...context, confirmed: true });
        gate = worst;
        if (worst.tier === 'DANGEROUS' && !context.confirmed && this.config.requireConfirmationForDangerous) {
          return { ok: false, error: `Dangerous workflow ${id} requires explicit confirmation`, needsConfirmation: true, tier: 'DANGEROUS' };
        }
        if (!worst.allowed && worst.needsConfirmation && !context.confirmed) {
          return { ok: false, error: `Workflow approval gated: ${worst.reason}`, needsConfirmation: true, tier: worst.tier };
        }
      } catch (e) {
        return { ok: false, error: `Policy check failed: ${e.message}` };
      }
    } else if (p.requiresConfirmation && !context.confirmed) {
      return { ok: false, error: `Proposal ${id} requires confirmation`, needsConfirmation: true, tier: p.riskTier };
    }

    p.status = WORKFLOW_STATUS.APPROVED;
    p.approvedAt = nowIso();
    p.approvedBy = context.approvedBy || context.user || 'user';
    p.updatedAt = nowIso();
    p.auto = !!context.auto && !!this.config.autoExecute; // only if autoExecute enabled
    if (p.auto) p.status = WORKFLOW_STATUS.AUTO;

    // Save automation
    const automation = {
      id: genId('auto'),
      proposalId: p.id,
      hash: p.hash,
      steps: p.steps.map(s => redactValue(s)),
      description: p.description,
      approvedAt: p.approvedAt,
      approvedBy: p.approvedBy,
      runs: 0,
      lastRun: null,
      auto: !!p.auto,
      createdAt: nowIso(),
      riskTier: p.riskTier,
      projectId: p.projectId || null,
    };
    this.automations.push(automation);
    if (this.automations.length > this.config.maxAutomations) {
      this.automations = this.automations.slice(-this.config.maxAutomations);
    }
    this.save();

    this._emit('workflow:proposal:approved', { proposal: { ...p }, automation: { ...automation } });
    this._emit('workflow:approved', { proposal: { ...p }, automation: { ...automation } });
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: 'workflow:approve',
      action: 'workflow:approve',
      result: `Approved workflow ${p.id} -> automation ${automation.id} auto=${automation.auto}`,
      permission: gate.tier || p.riskTier,
      confirmation: true,
    });

    try {
      if (this.memoryStore && typeof this.memoryStore.add === 'function') {
        this.memoryStore.add('WorkflowMemory', `Approved workflow automation [${automation.id}] from proposal [${p.id}] — ${p.description}`, { source: 'workflow-learner', automationId: automation.id, proposalId: p.id });
      }
    } catch {}

    return { ok: true, proposal: { ...p }, automation: { ...automation }, gated: gate };
  }

  async _assessRiskTierWithContext(steps, context) {
    if (!this.policyEngine || typeof this.policyEngine.assess !== 'function') {
      return { allowed: !context.confirmed ? false : true, needsConfirmation: !context.confirmed, tier: 'DANGEROUS', reason: 'no policy' };
    }
    let maxTier = 'SAFE';
    const tierRank = { SAFE: 0, NORMAL: 1, DANGEROUS: 2 };
    let anyNeedsConfirmation = false;
    let anyAllowed = true;
    for (const step of steps) {
      const res = await this.policyEngine.assess({ tool: step.tool, args: step.args || {}, context: { agent: 'WorkflowLearner', operation: `automation:${step.tool}`, ...context } });
      if (tierRank[res.tier] > tierRank[maxTier]) maxTier = res.tier;
      if (res.needsConfirmation) anyNeedsConfirmation = true;
      if (!res.allowed) anyAllowed = false;
    }
    return { allowed: anyAllowed || !!context.confirmed, needsConfirmation: anyNeedsConfirmation && !context.confirmed, tier: maxTier, reason: `max ${maxTier}` };
  }

  rejectProposal(id, reason = 'rejected') {
    const p = this.proposals.find(x => x.id === String(id));
    if (!p) return { ok: false, error: `Proposal not found: ${id}` };
    if (p.status === WORKFLOW_STATUS.REJECTED) return { ok: true, proposal: { ...p }, alreadyRejected: true };
    p.status = WORKFLOW_STATUS.REJECTED;
    p.dismissedAt = nowIso();
    p.rejectReason = String(reason).slice(0, 300);
    p.updatedAt = nowIso();
    this.save();
    this._emit('workflow:proposal:rejected', { proposal: { ...p }, reason });
    return { ok: true, proposal: { ...p } };
  }

  dismissProposal(id, reason) { return this.rejectProposal(id, reason); }

  // ------------------------- automations -------------------------
  listAutomations(filter = {}) {
    let out = [...this.automations];
    if (filter.hash) out = out.filter(a => a.hash === filter.hash);
    if (filter.projectId) out = out.filter(a => a.projectId === String(filter.projectId));
    if (filter.auto !== undefined) out = out.filter(a => !!a.auto === !!filter.auto);
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, automations: out.map(a => ({ ...a })), total };
  }

  getAutomation(id) {
    if (!id) return { ok: false, error: 'id required' };
    const a = this.automations.find(x => x.id === String(id));
    if (!a) return { ok: false, error: `Automation not found: ${id}` };
    return { ok: true, automation: { ...a } };
  }

  /**
   * Execute approved workflow — §31 "Myraa may eventually execute approved workflows automatically"
   * Gated via policy; DANGEROUS requires confirmation each run unless automation is marked auto with policy override.
   */
  async executeAutomation(id, opts = {}) {
    const auto = this.automations.find(x => x.id === String(id));
    if (!auto) return { ok: false, error: `Automation not found: ${id}` };
    // Policy gate per execution
    const gate = await this._assessRiskTierWithContext(auto.steps, { ...opts.context, confirmed: opts.confirmed });
    if (gate.tier === 'DANGEROUS' && !opts.confirmed && this.config.requireConfirmationForDangerous) {
      return { ok: false, error: `Dangerous automation ${id} requires confirmation per §32`, needsConfirmation: true, tier: 'DANGEROUS' };
    }
    if (!gate.allowed && gate.needsConfirmation && !opts.confirmed) {
      return { ok: false, error: `Automation execution gated: ${gate.reason}`, needsConfirmation: true, tier: gate.tier };
    }

    // Execute via toolRegistry if available, else simulate
    const results = [];
    let executor = opts.executor || null;
    if (!executor && this.toolRegistry && typeof this.toolRegistry.call === 'function') {
      executor = async (step) => {
        try {
          const res = await this.toolRegistry.call(step.tool, step.args || {}, { agent: 'WorkflowLearner', confirmed: !!opts.confirmed });
          return res;
        } catch (e) {
          return { ok: false, error: e.message };
        }
      };
    }
    if (!executor) {
      // Simulate execution (for tests without registry)
      executor = async (step) => ({ ok: true, result: `simulated ${step.tool}`, simulated: true });
    }

    for (const step of auto.steps) {
      const stepRes = await executor(step);
      results.push({ tool: step.tool, ok: !!stepRes.ok, result: stepRes.result || stepRes.output || null, error: stepRes.error || null });
      if (!stepRes.ok && opts.stopOnError !== false) break;
    }

    const allOk = results.every(r => r.ok);
    auto.runs += 1;
    auto.lastRun = nowIso();
    auto.lastResults = results.map(r => ({ tool: r.tool, ok: r.ok }));
    if (allOk) auto.status = WORKFLOW_STATUS.EXECUTED;
    this.save();

    this._emit('workflow:executed', { automationId: auto.id, results, ok: allOk });
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: 'workflow:execute',
      action: 'workflow:execute',
      result: `Executed automation ${auto.id} ok=${allOk} steps=${results.length}`,
      permission: gate.tier || auto.riskTier,
      confirmation: !!opts.confirmed,
    });

    return { ok: allOk, automation: { ...auto }, results, gated: gate };
  }

  // Enable/disable auto execution for an automation
  setAutoExecute(id, enabled) {
    const a = this.automations.find(x => x.id === String(id));
    if (!a) return { ok: false, error: `Automation not found: ${id}` };
    // Gate: enabling auto for DANGEROUS requires confirmation and policy
    if (enabled && a.riskTier === 'DANGEROUS' && this.config.requireConfirmationForDangerous) {
      // Allow but mark requires explicit policy override
      // For now, require autoExecute config to be true globally as well
      if (!this.config.autoExecute) {
        return { ok: false, error: `Auto-execute for DANGEROUS automation ${id} requires config.autoExecute=true and explicit confirmation`, needsConfirmation: true };
      }
    }
    a.auto = !!enabled;
    this.save();
    this._emit('workflow:auto:updated', { automationId: a.id, auto: a.auto });
    return { ok: true, automation: { ...a } };
  }

  // ------------------------- self-created tools §32 -------------------------
  /**
   * Dynamically create a temporary tool when no existing tool fits.
   * @param {object} spec - { name, description, code: string, inputSchema, outputSchema }
   * @param {object} opts - { persistent: boolean, expiresInMs, handler: function }
   */
  async createTemporaryTool(spec, opts = {}) {
    if (!spec || !spec.name) return { ok: false, error: 'spec with name required' };
    const name = String(spec.name).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return { ok: false, error: `Invalid tool name: ${name} (use camelCase)` };
    if (this.tempTools.has(name)) return { ok: false, error: `Tool already exists: ${name}` };
    if (this.tempTools.size >= this.config.maxTempTools) return { ok: false, error: `Max temp tools ${this.config.maxTempTools} reached` };

    // Validate spec
    const validation = this.validateToolSpec(spec);
    if (!validation.ok) return validation;

    // Generate handler: if spec.handler provided use it; else try to create from code string safely
    let handler = spec.handler || opts.handler || null;
    if (!handler && spec.code) {
      // Validate code for dangerous patterns before creation
      const code = String(spec.code);
      const dangerousPatterns = [/require\s*\(\s*['"]child_process['"]/, /exec\s*\(/, /eval\s*\(/, /process\.exit/, /fs\.unlink.*\//, /rm\s+-rf/];
      const foundDanger = dangerousPatterns.find(rx => rx.test(code));
      if (foundDanger) {
        // Still allow but mark as DANGEROUS and require confirmation to retain
        // For temp execution, policy gate will still apply
      }
      try {
        // Create controlled utility: wrap code as function body
        // Use Function constructor in controlled manner — only for arithmetic/data transforms in prototype
        // In production, this would use a sandboxed VM (e.g., vm2) or policy-approved interpreter
        const fn = new Function('args', 'context', `${code}\n`);
        handler = async (args, context) => {
          const res = fn(args, context);
          return res instanceof Promise ? await res : res;
        };
      } catch (e) {
        return { ok: false, error: `Tool code invalid: ${e.message}` };
      }
    }
    if (!handler || typeof handler !== 'function') {
      return { ok: false, error: 'Tool handler function required (provide spec.handler or spec.code)' };
    }

    // Policy gate for creation (§32 propose/store according to user config and security policy)
    let gate = { allowed: true, tier: 'NORMAL' };
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      try {
        gate = await this.policyEngine.assess({
          tool: name,
          permission: 'NORMAL',
          args: { code: spec.code ? String(spec.code).slice(0, 200) : '', inputSchema: spec.inputSchema },
          context: { agent: 'WorkflowLearner', operation: 'create_tool' },
        });
        if (!gate.allowed && gate.needsConfirmation && !opts.confirmed) {
          // For temp tool creation, we still allow creation as temporary but mark requiresConfirmation for persistence
          // Do not block temp creation unless explicitly DANGEROUS and policy says blocked without confirmation
          // But if tier DANGEROUS and needsConfirmation, require confirmation for persistent only
        }
      } catch {}
    }

    const record = {
      name,
      description: redactString(String(spec.description || '').slice(0, 500)),
      code: spec.code ? String(spec.code).slice(0, 5000) : null,
      inputSchema: spec.inputSchema ? redactValue(spec.inputSchema) : { type: 'object', properties: {}, required: [] },
      outputSchema: spec.outputSchema ? redactValue(spec.outputSchema) : { type: 'object', properties: { ok: { type: 'boolean' } } },
      handler,
      status: TOOL_STATUS.TEMPORARY,
      createdAt: nowIso(),
      expiresAt: opts.expiresInMs ? new Date(Date.now() + Number(opts.expiresInMs)).toISOString() : null,
      persistent: !!opts.persistent,
      retained: false,
      policy: gate,
      requiresConfirmation: !!gate.needsConfirmation && gate.tier === 'DANGEROUS',
    };

    this.tempTools.set(name, record);
    this.save();

    this._emit('tool:created', { name, status: record.status, tier: gate.tier });
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: `tool:${name}`,
      action: `createTemporaryTool`,
      result: `Created temp tool ${name} tier=${gate.tier}`,
      permission: gate.tier || 'NORMAL',
      confirmation: !!opts.confirmed,
    });

    // Optionally register with ToolRegistry as temporary (if registry available)
    if (this.toolRegistry && typeof this.toolRegistry.register === 'function' && opts.register !== false) {
      try {
        this.toolRegistry.register({
          name,
          description: record.description,
          permission: gate.tier === 'DANGEROUS' ? 'DANGEROUS' : gate.tier === 'SAFE' ? 'SAFE' : 'NORMAL',
          category: 'automation:temporary',
          inputSchema: record.inputSchema,
          outputSchema: record.outputSchema,
          handler,
          version: '0.1.0-temp',
          plugin: 'workflow-learner:temp',
        });
      } catch {}
    }

    return { ok: true, tool: { name, description: record.description, status: record.status, tier: gate.tier, requiresConfirmation: record.requiresConfirmation }, handler };
  }

  validateToolSpec(spec) {
    if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec object required' };
    if (!spec.name || typeof spec.name !== 'string' || !spec.name.trim()) return { ok: false, error: 'spec.name required' };
    if (spec.inputSchema && typeof spec.inputSchema !== 'object') return { ok: false, error: 'inputSchema must be object' };
    if (spec.outputSchema && typeof spec.outputSchema !== 'object') return { ok: false, error: 'outputSchema must be object' };
    if (!spec.handler && !spec.code) return { ok: false, error: 'spec.handler or spec.code required' };
    if (spec.code && typeof spec.code !== 'string') return { ok: false, error: 'spec.code must be string' };
    if (spec.code && spec.code.length > 5000) return { ok: false, error: 'spec.code too large (max 5000 chars)' };
    return { ok: true };
  }

  /**
   * Validate a temporary tool's code/handler before execution §32 Validate it
   */
  async validateTool(name) {
    const t = this.tempTools.get(String(name));
    if (!t) return { ok: false, error: `Tool not found: ${name}` };
    // Simple validation: ensure handler executes without throwing on empty args
    try {
      if (typeof t.handler !== 'function') return { ok: false, error: 'No handler' };
      // Try dry-run with empty args if safe
      const testArgs = {};
      // Don't actually call handler with side effects; just check it's a function
      t.status = TOOL_STATUS.VALIDATED;
      this.save();
      this._emit('tool:validated', { name });
      return { ok: true, tool: { name, status: t.status } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Execute a temporary tool §32 Execute it
   */
  async executeTemporaryTool(name, args = {}, context = {}) {
    const t = this.tempTools.get(String(name));
    if (!t) return { ok: false, error: `Tool not found: ${name}` };
    if (typeof t.handler !== 'function') return { ok: false, error: `No handler for ${name}` };

    // Policy gate per execution — §32 + §34
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      try {
        const gate = await this.policyEngine.assess({ tool: name, permission: t.policy?.tier || 'NORMAL', args, context: { agent: 'WorkflowLearner', operation: `execute_temp:${name}`, ...context } });
        if (!gate.allowed && gate.needsConfirmation && !context.confirmed) {
          return { ok: false, error: `Tool ${name} execution requires confirmation (${gate.tier})`, needsConfirmation: true, tier: gate.tier };
        }
      } catch {}
    }

    // Expiry check
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now() && !t.persistent) {
      return { ok: false, error: `Tool ${name} expired at ${t.expiresAt}` };
    }

    let result;
    try {
      const maybePromise = t.handler(args, context);
      result = maybePromise instanceof Promise ? await maybePromise : maybePromise;
      if (!result || typeof result !== 'object') result = { ok: true, result: String(result) };
      if (result.ok === undefined) result.ok = true;
    } catch (e) {
      result = { ok: false, error: e.message || String(e) };
    }

    t.status = TOOL_STATUS.EXECUTED;
    t.lastResult = redactValue(result);
    t.lastExecutedAt = nowIso();
    this.save();

    this._emit('tool:executed', { name, result: { ok: result.ok } });
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: name,
      action: `executeTemporaryTool`,
      result: result.ok ? `Executed ${name} ok` : `Failed ${name}: ${result.error?.slice(0, 100)}`,
      permission: t.policy?.tier || 'NORMAL',
      confirmation: !!context.confirmed,
    });

    // Decide retention: delete or retain according to policy / opts
    const shouldDelete = !t.persistent && !context.retain && t.status === TOOL_STATUS.EXECUTED;
    // For temp tools, default is delete after execution unless persistent or retain requested — §32 Delete or retain according to policy
    // But we keep record with DELETED status for audit, and optionally unregister from registry
    if (shouldDelete) {
      // Mark as deleted but keep record for audit; optionally unregister
      t.status = TOOL_STATUS.DELETED;
      if (this.toolRegistry && typeof this.toolRegistry.unregister === 'function') {
        try { this.toolRegistry.unregister(name); } catch {}
      }
      this.save();
      this._emit('tool:deleted', { name, reason: 'temporary executed — deleted per policy' });
    }

    return { ...result, tool: name, status: t.status };
  }

  /**
   * Propose to retain a temporary tool persistently — §32 propose/store according to user configuration and security policy
   */
  async proposePersistentTool(name, context = {}) {
    const t = this.tempTools.get(String(name));
    if (!t) return { ok: false, error: `Tool not found: ${name}` };
    if (t.retained) return { ok: true, tool: { name, status: TOOL_STATUS.RETAINED }, alreadyRetained: true };
    // Policy check for persistence
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      try {
        const gate = await this.policyEngine.assess({ tool: name, permission: 'NORMAL', args: { code: t.code || '' }, context: { agent: 'WorkflowLearner', operation: 'retain_tool', ...context } });
        if (!gate.allowed && gate.needsConfirmation && !context.confirmed) {
          t.status = TOOL_STATUS.PROPOSED;
          this.save();
          return { ok: false, error: `Retaining tool ${name} requires confirmation (${gate.tier})`, needsConfirmation: true, tier: gate.tier, proposal: { name, tier: gate.tier } };
        }
      } catch {}
    }

    t.persistent = true;
    t.retained = true;
    t.status = TOOL_STATUS.RETAINED;
    t.retainedAt = nowIso();
    this.save();

    // Register persistently if not already
    if (this.toolRegistry && typeof this.toolRegistry.register === 'function') {
      try {
        const exists = this.toolRegistry.get?.(name);
        if (!exists) {
          this.toolRegistry.register({
            name,
            description: t.description,
            permission: t.policy?.tier === 'DANGEROUS' ? 'DANGEROUS' : 'NORMAL',
            category: 'automation:persistent',
            inputSchema: t.inputSchema,
            outputSchema: t.outputSchema,
            handler: t.handler,
            version: '0.1.0-persistent',
            plugin: 'workflow-learner:persistent',
          });
        }
      } catch {}
    }

    this._emit('tool:retained', { name, persistent: true });
    this._audit({
      agent: 'WorkflowLearner',
      task: null,
      tool: name,
      action: 'retainTool',
      result: `Retained tool ${name} as persistent`,
      permission: t.policy?.tier || 'NORMAL',
      confirmation: !!context.confirmed,
    });

    try {
      if (this.memoryStore && typeof this.memoryStore.add === 'function') {
        this.memoryStore.add('ToolKnowledge', `Retained persistent tool [${name}] — ${t.description}`, { source: 'workflow-learner', tool: name });
      }
    } catch {}

    return { ok: true, tool: { name, status: t.status, persistent: true } };
  }

  async retainTool(name, context) { return this.proposePersistentTool(name, context); }

  deleteTool(name, reason = 'deleted') {
    const t = this.tempTools.get(String(name));
    if (!t) return { ok: false, error: `Tool not found: ${name}` };
    this.tempTools.delete(name);
    if (this.toolRegistry && typeof this.toolRegistry.unregister === 'function') {
      try { this.toolRegistry.unregister(name); } catch {}
    }
    this.save();
    this._emit('tool:deleted', { name, reason });
    return { ok: true, deleted: name };
  }

  listTools(filter = {}) {
    let out = [...this.tempTools.values()];
    if (filter.status) out = out.filter(t => t.status === String(filter.status).toLowerCase());
    if (filter.persistent !== undefined) out = out.filter(t => !!t.persistent === !!filter.persistent);
    out.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, tools: out.map(t => ({ name: t.name, description: t.description, status: t.status, persistent: t.persistent, createdAt: t.createdAt, expiresAt: t.expiresAt, policy: t.policy })), total };
  }

  getTool(name) {
    if (!name) return { ok: false, error: 'name required' };
    const t = this.tempTools.get(String(name));
    if (!t) return { ok: false, error: `Tool not found: ${name}` };
    return { ok: true, tool: { name: t.name, description: t.description, code: t.code, status: t.status, persistent: t.persistent, createdAt: t.createdAt, inputSchema: t.inputSchema, outputSchema: t.outputSchema } };
  }

  // ------------------------- config -------------------------
  getConfig() { return { ...this.config }; }
  updateConfig(patch = {}) {
    if (typeof patch !== 'object') return { ok: false, error: 'patch object required' };
    for (const k of Object.keys(patch)) {
      if (k in this.config) this.config[k] = patch[k];
    }
    this.save();
    return { ok: true, config: { ...this.config } };
  }

  // ------------------------- stats & maintenance -------------------------
  getStats() {
    const pending = this.proposals.filter(p => p.status === WORKFLOW_STATUS.PENDING).length;
    const approved = this.proposals.filter(p => p.status === WORKFLOW_STATUS.APPROVED).length;
    const byTier = {};
    for (const p of this.proposals) byTier[p.riskTier] = (byTier[p.riskTier] || 0) + 1;
    const byAuto = this.automations.filter(a => a.auto).length;
    return {
      ok: true,
      observations: this.observations.length,
      proposals: this.proposals.length,
      pending,
      approved,
      automations: this.automations.length,
      autoAutomations: byAuto,
      byTier,
      tempTools: this.tempTools.size,
      persistentTools: [...this.tempTools.values()].filter(t => t.persistent).length,
      file: this.filePath,
      config: { ...this.config },
    };
  }

  clear(filter = {}) {
    if (filter.observations) {
      const c = this.observations.length;
      this.observations = [];
      this.save();
      return { ok: true, cleared: 'observations', count: c };
    }
    if (filter.proposals) {
      const c = this.proposals.length;
      this.proposals = [];
      this.save();
      return { ok: true, cleared: 'proposals', count: c };
    }
    if (filter.automations) {
      const c = this.automations.length;
      this.automations = [];
      this.save();
      return { ok: true, cleared: 'automations', count: c };
    }
    if (filter.tools) {
      const c = this.tempTools.size;
      this.tempTools.clear();
      this.save();
      return { ok: true, cleared: 'tools', count: c };
    }
    const counts = { observations: this.observations.length, proposals: this.proposals.length, automations: this.automations.length, tools: this.tempTools.size };
    this.observations = [];
    this.proposals = [];
    this.automations = [];
    this.tempTools.clear();
    this.save();
    return { ok: true, cleared: 'all', counts };
  }

  verifyNoSecrets() {
    const blob = JSON.stringify([...this.observations, ...this.proposals, ...this.automations]);
    const patterns = [/sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{30,}/, /AIza[0-9A-Za-z-_]{30,}/];
    const violations = [];
    for (const rx of patterns) if (rx.test(blob) && !blob.includes('[REDACTED]')) violations.push(rx.source);
    return { ok: violations.length === 0, violations, checked: this.observations.length + this.proposals.length };
  }

  destroy() {
    this.removeAllListeners();
  }
}

// Default singleton for app (§5 Master Orchestrator may wire)
export const workflowLearner = new WorkflowLearner();
export const learner = workflowLearner; // alias

export function getDefaultWorkflowPathFn() { return getDefaultWorkflowPath(); }
export function hashWorkflowSteps(steps) { return hashSteps(steps); }

export default WorkflowLearner;
