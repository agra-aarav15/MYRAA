// Myraa Audit Log — MASTER BUILD PROMPT §38, §53
// Records security-relevant actions: timestamp, agent, task, tool, action, result, permission, confirmation, device, error
// Never logs secrets (§23). Persistent JSON at %APPDATA%\myraa\audit.json (§52)
// Provider-independent, local-first, event-driven (§50)

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers: paths, redaction §23 never log secrets
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultAuditPath() {
  return path.join(getMyraaDataDir(), 'audit.json');
}
function nowIso() { return new Date().toISOString(); }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function genId() {
  return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
}

// Secret redaction — must match memory/store.js and policy/engine.js to guarantee no leakage
const SECRET_KEY_PATTERN = /api[_-]?key|apikey|secret|password|passwd|pwd|token|credential|auth/i;
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
const JSON_SECRET_REGEX_DQ = /"(api[_-]?key|apikey|secret[_-]?key|access[_-]?key|password|passwd|pwd|token|bearer|auth[_-]?token|credential|secret)"\s*:\s*"([^"]*)"/gi;
const JSON_SECRET_REGEX_SQ = /'(api[_-]?key|apikey|secret[_-]?key|access[_-]?key|password|passwd|pwd|token|bearer|auth[_-]?token|credential|secret)'\s*:\s*'([^']*)'/gi;

function redactString(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { regex, replacement } of RAW_SECRET_REGEXES) {
    out = out.replace(new RegExp(regex.source, regex.flags), replacement);
  }
  out = out.replace(GENERIC_ASSIGNMENT_REGEX, (_m, key) => {
    const hasQuotes = _m.includes('"') || _m.includes("'");
    const quote = hasQuotes ? '"' : '';
    return `${key}=${quote}[REDACTED]${quote}`;
  });
  // JSON style: "password":"value" -> "password":"[REDACTED]"
  out = out.replace(JSON_SECRET_REGEX_DQ, (_m, key) => `"${key}":"[REDACTED]"`);
  out = out.replace(JSON_SECRET_REGEX_SQ, (_m, key) => `'${key}':'[REDACTED]'`);
  // Also handle JSON without quotes around value (numbers/booleans) -> still redact string-like values
  // Fallback: try to parse as JSON and redact object values
  if (out.includes('"password"') || out.includes('"token"') || out.includes('"secret"') || out.includes('"apiKey"')) {
    try {
      const parsed = JSON.parse(out);
      if (parsed && typeof parsed === 'object') {
        const redacted = redactValue(parsed);
        out = JSON.stringify(redacted);
      }
    } catch {}
  }
  return out;
}
function isSecretKey(key) { return SECRET_KEY_PATTERN.test(String(key)); }

function redactValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return redactString(val);
  if (Array.isArray(val)) return val.map(redactValue);
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (isSecretKey(k)) out[k] = '[REDACTED]';
      else if (typeof v === 'string') out[k] = redactString(v);
      else if (typeof v === 'object' && v !== null) out[k] = redactValue(v);
      else out[k] = v;
    }
    return out;
  }
  return val;
}

function redactArgs(args) {
  if (!args || typeof args !== 'object') return args;
  return redactValue(args);
}
function truncateForLog(str, max = 2000) {
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + `...[truncated ${str.length - max} chars]`;
}

// ---------------------------------------------------------------------------
// AuditLogger §38
// ---------------------------------------------------------------------------
export class AuditLogger {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (default %APPDATA%\myraa\audit.json)
   * @param {number} opts.maxEntries - cap to avoid unbounded growth (default 5000)
   * @param {object} opts.eventBus - optional EventEmitter for audit:logged
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad - load from disk on construction (default true)
   */
  constructor({ filePath, maxEntries = 5000, eventBus = null, logger = console, autoLoad = true } = {}) {
    this.filePath = filePath || getDefaultAuditPath();
    this.maxEntries = maxEntries;
    this.eventBus = eventBus;
    this.logger = logger;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    /** @type {Array} */
    this.entries = [];
    this._writeQueue = Promise.resolve();
    if (autoLoad) this.load();
  }

  // ------------------------- persistence -------------------------
  _getPersistPayload() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      entries: this.entries,
    };
  }

  save() {
    try {
      ensureDirForFile(this.filePath);
      const payload = this._getPersistPayload();
      // redact again before write as safety (should already be redacted, but double-check)
      const safePayload = {
        ...payload,
        entries: payload.entries.map(e => {
          // ensure entry fields are redacted
          const copy = { ...e };
          if (copy.result && typeof copy.result === 'string') copy.result = redactString(copy.result);
          if (copy.error && typeof copy.error === 'string') copy.error = redactString(copy.error);
          if (copy.args) copy.args = redactValue(copy.args);
          // ensure no secret keys leak in top-level
          for (const k of Object.keys(copy)) {
            if (isSecretKey(k) && typeof copy[k] === 'string') copy[k] = '[REDACTED]';
          }
          return copy;
        }),
      };
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(safePayload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.updatedAt = payload.updatedAt;
      return { ok: true, path: this.filePath, count: this.entries.length };
    } catch (e) {
      this.logger.warn?.(`[AuditLogger] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this.entries.length };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[AuditLogger] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (Array.isArray(data.entries)) {
      this.entries = data.entries
        .filter(e => e && typeof e === 'object')
        .map(e => ({
          id: e.id || genId(),
          timestamp: e.timestamp || nowIso(),
          agent: e.agent || 'unknown',
          task: e.task || null,
          taskId: e.taskId || e.task || null,
          tool: e.tool || null,
          action: e.action || e.tool || 'unknown',
          result: e.result !== undefined ? e.result : null,
          permission: e.permission || null,
          permissionDecision: e.permissionDecision || e.permission || null,
          confirmation: e.confirmation !== undefined ? e.confirmation : (e.confirmationState ?? null),
          confirmationState: e.confirmationState ?? e.confirmation ?? null,
          device: e.device || null,
          error: e.error || null,
          durationMs: e.durationMs ?? null,
          args: e.args ? redactValue(e.args) : undefined,
          context: e.context ? redactValue(e.context) : undefined,
        }))
        // ensure no secrets: filter entries that still contain raw secrets patterns?
        .slice(-this.maxEntries);
    }
  }

  // ------------------------- core: log §38 -------------------------
  /**
   * Record a security-relevant action. Never logs secrets.
   * @param {object} entry - { agent, task, taskId, tool, action, result, permission, permissionDecision, confirmation, confirmationState, device, error, args, durationMs }
   * @returns {{ ok:boolean, entry:object }}
   */
  log(entry = {}) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'entry object required' };

    // Extract fields per spec: timestamp, agent, task, tool, action, result, permission, confirmation, device, error, no secrets
    const timestamp = entry.timestamp || nowIso();
    const id = entry.id || genId();

    // Normalize task/taskId
    const task = entry.task ?? entry.taskId ?? null;
    const taskId = entry.taskId ?? entry.task ?? null;

    // Normalize permission
    const permission = entry.permission ?? entry.permissionDecision ?? entry.tier ?? null;
    const permissionDecision = entry.permissionDecision ?? entry.permission ?? permission;

    // Confirmation state: could be boolean, string, or object
    let confirmation = entry.confirmation ?? entry.confirmationState ?? null;
    // normalize to boolean/string: if entry has confirmed flag
    if (confirmation === undefined && entry.confirmed !== undefined) confirmation = entry.confirmed;
    // also check inside permission decision object
    if (confirmation === null && entry.needsConfirmation !== undefined) confirmation = entry.needsConfirmation ? 'pending' : 'confirmed';

    const agent = entry.agent ?? entry.agentId ?? 'unknown';
    const tool = entry.tool ?? entry.action ?? null;
    const action = entry.action ?? entry.tool ?? null;

    // Collect secret values from original args to ensure any occurrence in result/error is scrubbed
    const secretValues = [];
    if (entry.args && typeof entry.args === 'object' && entry.args !== null) {
      const collectSecrets = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          if (isSecretKey(k) && typeof v === 'string' && v.length >= 3) secretValues.push(String(v));
          if (v && typeof v === 'object') collectSecrets(v);
          // also handle nested arrays
          if (Array.isArray(v)) for (const item of v) if (typeof item === 'object' && item !== null) collectSecrets(item);
        }
      };
      try { collectSecrets(entry.args); } catch {}
      // also check if args contains raw secret patterns in string values even without secret key (high entropy)
      // Collect any high-entropy string values that look like secrets (length >=20 with mix)
      const scanHighEntropy = (obj) => {
        if (typeof obj === 'string' && obj.length >= 20) {
          for (const { regex } of RAW_SECRET_REGEXES) {
            if (new RegExp(regex.source, regex.flags).test(obj)) secretValues.push(obj);
          }
        } else if (obj && typeof obj === 'object') {
          for (const v of Object.values(obj)) scanHighEntropy(v);
        }
      };
      try { scanHighEntropy(entry.args); } catch {}
    }

    function redactWithCollected(str) {
      if (typeof str !== 'string') return str;
      let out = redactString(str);
      for (const sv of secretValues) {
        if (sv && sv.length >= 3 && out.includes(sv)) {
          out = out.split(sv).join('[REDACTED]');
        }
      }
      return out;
    }

    let result = entry.result ?? entry.output ?? null;
    if (typeof result === 'string') result = truncateForLog(redactWithCollected(result), 2000);
    else if (result && typeof result === 'object') result = truncateForLog(redactWithCollected(JSON.stringify(result)), 2000);

    let error = entry.error ?? null;
    if (typeof error === 'string') error = truncateForLog(redactWithCollected(error), 2000);
    else if (error && typeof error === 'object') error = truncateForLog(redactWithCollected(String(error.message || JSON.stringify(error))), 2000);

    const device = entry.device ?? entry.deviceId ?? null;

    // Redact args if present — never log raw secrets
    let safeArgs;
    if (entry.args) safeArgs = redactValue(entry.args);

    // Build redacted entry
    const logEntry = {
      id,
      timestamp,
      agent: String(agent),
      task: task ? String(task) : null,
      taskId: taskId ? String(taskId) : null,
      tool: tool ? String(tool) : null,
      action: action ? String(action) : null,
      result: result !== undefined ? result : null,
      permission: permission ? String(permission) : null,
      permissionDecision: permissionDecision ? String(permissionDecision) : null,
      confirmation: confirmation !== null && confirmation !== undefined ? confirmation : null,
      confirmationState: confirmation !== null && confirmation !== undefined ? confirmation : null,
      device: device ? String(device) : null,
      error: error ? String(error) : null,
      durationMs: entry.durationMs ?? null,
      // optional but not secret: category, tier
      tier: entry.tier ?? permission ?? null,
    };
    // Only include args if provided and not too large, redacted
    if (safeArgs !== undefined) logEntry.args = safeArgs;

    // Double-check no secret patterns remain in any string field (including collected secret values)
    for (const k of ['result','error','tool','action','agent']) {
      if (typeof logEntry[k] === 'string') {
        let redacted = redactWithCollected(logEntry[k]);
        if (redacted !== logEntry[k]) logEntry[k] = redacted;
        // ensure no raw secret remains
        if (/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}|AIza|gsk_/i.test(logEntry[k] || '')) {
          logEntry[k] = '[REDACTED]';
        }
        // also check collected values again after generic redaction
        for (const sv of secretValues) {
          if (sv && logEntry[k].includes(sv)) {
            logEntry[k] = logEntry[k].split(sv).join('[REDACTED]');
          }
        }
      }
    }

    this.entries.push(logEntry);
    // cap
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    this.updatedAt = nowIso();
    this.save();

    // Emit event for UI / observability §50 (structured events, not exposing secrets)
    try {
      this.eventBus?.emit?.('audit:logged', { ts: timestamp, entry: { ...logEntry, args: undefined } });
    } catch {}
    try {
      // also try global bus if available (lazy import to avoid cycle)
      import('../eventBus.js').then(m => {
        try { m.emit('audit:logged', { entry: logEntry }); } catch {}
      }).catch(()=>{});
    } catch {}

    return { ok: true, entry: logEntry };
  }

  // Convenience alias per spec naming
  record(entry) { return this.log(entry); }
  add(entry) { return this.log(entry); }

  // Wrap tool execution for automatic auditing
  async auditToolCall({ agent, task, tool, args, permission, device, confirmed }, executeFn) {
    const start = Date.now();
    let result, error, ok;
    try {
      result = await executeFn();
      ok = result?.ok !== false;
      error = result?.error || null;
    } catch (e) {
      ok = false;
      error = e.message || String(e);
      result = { ok: false, error };
    }
    const durationMs = Date.now() - start;
    this.log({
      agent: agent || 'unknown',
      task: task || null,
      tool,
      action: tool,
      args: redactValue(args),
      result: ok ? (result?.result ?? result?.output ?? 'ok') : null,
      permission: permission || result?.permission || null,
      confirmation: confirmed !== undefined ? confirmed : null,
      device: device || null,
      error,
      durationMs,
    });
    return result;
  }

  // ------------------------- query & inspection -------------------------
  getAll() {
    return [...this.entries];
  }

  getEntries() { return this.getAll(); }

  /**
   * Query audit logs with filters.
   * @param {object} filter - { agent, task, taskId, tool, permission, device, since, until, limit, offset, hasError }
   */
  query(filter = {}) {
    let out = [...this.entries];
    if (filter.agent) {
      const a = String(filter.agent).toLowerCase();
      out = out.filter(e => String(e.agent).toLowerCase() === a || String(e.agent).toLowerCase().includes(a));
    }
    if (filter.task || filter.taskId) {
      const t = String(filter.task || filter.taskId).toLowerCase();
      out = out.filter(e => (e.task && String(e.task).toLowerCase().includes(t)) || (e.taskId && String(e.taskId).toLowerCase().includes(t)));
    }
    if (filter.tool) {
      const tl = String(filter.tool).toLowerCase();
      out = out.filter(e => e.tool && String(e.tool).toLowerCase().includes(tl));
    }
    if (filter.permission) {
      const p = String(filter.permission).toUpperCase();
      out = out.filter(e => String(e.permission).toUpperCase() === p || String(e.permissionDecision).toUpperCase() === p);
    }
    if (filter.device) {
      const d = String(filter.device).toLowerCase();
      out = out.filter(e => e.device && String(e.device).toLowerCase() === d);
    }
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter(e => new Date(e.timestamp).getTime() >= since);
    }
    if (filter.until) {
      const until = new Date(filter.until).getTime();
      out = out.filter(e => new Date(e.timestamp).getTime() <= until);
    }
    if (filter.hasError !== undefined) {
      if (filter.hasError) out = out.filter(e => !!e.error);
      else out = out.filter(e => !e.error);
    }
    // sort newest first
    out.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = out.length;
    const offset = Number(filter.offset || 0);
    const limit = filter.limit ? Number(filter.limit) : null;
    if (offset) out = out.slice(offset);
    if (limit && limit > 0) out = out.slice(0, limit);
    return { ok: true, results: out, total, filter };
  }

  search(query, opts = {}) {
    if (!query || typeof query !== 'string') return { ok: false, error: 'query required' };
    const lower = query.toLowerCase();
    let out = this.entries.filter(e =>
      (e.tool && String(e.tool).toLowerCase().includes(lower)) ||
      (e.action && String(e.action).toLowerCase().includes(lower)) ||
      (e.agent && String(e.agent).toLowerCase().includes(lower)) ||
      (e.task && String(e.task).toLowerCase().includes(lower)) ||
      (e.result && String(e.result).toLowerCase().includes(lower)) ||
      (e.error && String(e.error).toLowerCase().includes(lower))
    );
    out.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = out.length;
    if (opts.limit) out = out.slice(0, Number(opts.limit));
    return { ok: true, results: out, total, query };
  }

  getByTask(taskId) {
    if (!taskId) return { ok: false, error: 'taskId required' };
    return this.query({ taskId });
  }

  getByAgent(agentId) {
    if (!agentId) return { ok: false, error: 'agentId required' };
    return this.query({ agent: agentId });
  }

  getByTool(toolName) {
    if (!toolName) return { ok: false, error: 'toolName required' };
    return this.query({ tool: toolName });
  }

  // ------------------------- stats & maintenance -------------------------
  getStats() {
    const counts = {};
    const byPermission = {};
    const byAgent = {};
    const byTool = {};
    let errors = 0;
    for (const e of this.entries) {
      const p = e.permission || 'UNKNOWN';
      byPermission[p] = (byPermission[p] || 0) + 1;
      const ag = e.agent || 'unknown';
      byAgent[ag] = (byAgent[ag] || 0) + 1;
      const t = e.tool || 'unknown';
      byTool[t] = (byTool[t] || 0) + 1;
      if (e.error) errors++;
    }
    return {
      ok: true,
      total: this.entries.length,
      errors,
      byPermission,
      byAgent,
      byTool,
      file: this.filePath,
      maxEntries: this.maxEntries,
      updatedAt: this.updatedAt,
      version: this.version,
    };
  }

  clear() {
    const count = this.entries.length;
    this.entries = [];
    this.save();
    return { ok: true, cleared: count };
  }

  clearAll() { return this.clear(); }

  export() {
    return this._getPersistPayload();
  }

  // Import entries (for migration)
  import(data, { replace = false } = {}) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid import data' };
    if (replace) {
      this._hydrate(data);
      this.save();
      return { ok: true, count: this.entries.length };
    }
    const incoming = Array.isArray(data.entries) ? data.entries : (Array.isArray(data) ? data : []);
    let added = 0;
    for (const e of incoming) {
      const res = this.log(e);
      if (res.ok) added++;
    }
    return { ok: true, added, total: this.entries.length };
  }

  // Verify no secrets in logs (for security tests)
  verifyNoSecrets() {
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /sk-proj-[a-zA-Z0-9-_]{60,}/,
      /ghp_[a-zA-Z0-9]{30,}/,
      /AIza[0-9A-Za-z-_]{30,}/,
      /gsk_[a-zA-Z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
    ];
    const violations = [];
    for (const e of this.entries) {
      const blob = JSON.stringify(e);
      for (const rx of secretPatterns) {
        if (rx.test(blob) && !blob.includes('[REDACTED]')) {
          violations.push({ id: e.id, tool: e.tool, pattern: rx.source });
          break;
        }
      }
      // also check for raw password assignments without redaction
      if (/password\s*[:=]\s*[^'"\s]+\s*/i.test(blob) && !blob.includes('[REDACTED]')) {
        // Check if it's actual secret value not redacted marker
        // We treat as violation if contains password= and not [REDACTED]
        violations.push({ id: e.id, tool: e.tool, pattern: 'generic password assignment' });
      }
    }
    return { ok: violations.length === 0, violations, checked: this.entries.length };
  }
}

// Default singleton for Master Orchestrator / Policy Engine
export const auditLogger = new AuditLogger();
export const auditLog = auditLogger; // alias

export function getDefaultAuditPathFn() { return getDefaultAuditPath(); }

export default AuditLogger;
