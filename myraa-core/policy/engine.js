// Myraa Policy Engine — MASTER BUILD PROMPT §34-36, §53-55
// Implements SAFE/NORMAL/DANGEROUS with configurable per tool/app/website/device/operation/directory/command/account/agent (§35)
// Every tool action must pass through engine with risk evaluation (§34). Dangerous operations list §36 requires confirmation, configurable.
// Provider-independent, event-driven, local-first. Persists to %APPDATA%\myraa\policy.json (§52)
// No secrets logged. Integrates with ToolRegistry §34, Audit §38, STOP §37.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { stopController as defaultStopController } from './stop.js';

// ---------------------------------------------------------------------------
// Permission model §34
// ---------------------------------------------------------------------------
export const Permission = Object.freeze({
  SAFE: 'SAFE',
  NORMAL: 'NORMAL',
  DANGEROUS: 'DANGEROUS',
});
export const RiskTier = Permission;
export const TIER_ORDER = Object.freeze({ SAFE: 0, NORMAL: 1, DANGEROUS: 2 });
export function tierRank(t) { return TIER_ORDER[t] ?? 1; }
export function maxTier(...tiers) {
  let best = 'SAFE';
  let bestRank = -1;
  for (const t of tiers) {
    const r = tierRank(t);
    if (r > bestRank) { bestRank = r; best = t; }
  }
  return best;
}
export function isValidTier(t) { return t === Permission.SAFE || t === Permission.NORMAL || t === Permission.DANGEROUS; }

// ---------------------------------------------------------------------------
// Dangerous operations §36 — configurable, requires confirmation by default
// ---------------------------------------------------------------------------
export const DANGEROUS_OPERATIONS_DEFAULT = Object.freeze([
  {
    id: 'destructive_file_deletion',
    label: 'Destructive file deletion',
    description: 'Permanent or recursive deletion, move/rename of important files',
    tools: ['deleteFile', 'moveFile', 'renameFile'],
    patterns: [],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'drive_formatting',
    label: 'Drive formatting',
    description: 'Format, mkfs, diskpart clean, fdisk, partition destruction',
    tools: ['runTerminalCommand', 'executeCommand'],
    patterns: ['format\\s+[a-z]:', 'mkfs', 'diskpart', 'fdisk', 'parted', 'clean\\s+disk', 'rm\\s+-rf\\s+\\/\\s*$', 'rm\\s+-rf\\s+\\/\\*'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'major_system_changes',
    label: 'Major system changes',
    description: 'System settings, registry, autostart, power actions, brightness/volume system-level',
    tools: ['enableAutoStart', 'disableAutoStart', 'requestPowerAction', 'executePowerAction'],
    patterns: ['shutdown', 'restart', 'reboot', 'registry', 'reg\\s+add', 'bcdedit', 'shutdown\\.exe', 'rundll32.*LockWorkStation', 'SetSuspendState'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'admin_operations',
    label: 'Administrator operations',
    description: 'Elevated privilege: sudo, runas, net user, secedit, icacls, takeown, chmod 777',
    tools: ['runTerminalCommand', 'executeCommand', 'runPythonScript'],
    patterns: ['\\bsudo\\b', 'runas', 'net\\s+user', 'net\\s+localgroup', 'secedit', 'icacls', 'takeown', 'chmod\\s+777', 'chown', 'net\\s+session'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'destructive_git',
    label: 'Destructive Git operations',
    description: 'Force push, hard reset, clean -fdx, branch -D, checkout --force',
    tools: ['runTerminalCommand', 'executeCommand'],
    patterns: [
      'git\\s+push\\s+.*(--force|-f)(\\s|$)',
      'git\\s+reset\\s+--hard',
      'git\\s+clean\\s+.*-f',
      'git\\s+branch\\s+.*-D',
      'git\\s+checkout\\s+.*--force',
      'git\\s+rebase(\\s|$)',
      'git\\s+push\\s+.*--delete',
    ],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'repository_deletion',
    label: 'Repository deletion',
    description: 'Delete GitHub repository, remote, or .git folder',
    tools: ['runTerminalCommand', 'executeCommand', 'browserClick'],
    patterns: ['gh\\s+repo\\s+delete', 'git\\s+remote\\s+remove', 'rm\\s+-rf\\s+\\.git', 'repository.*delete', 'gh\\s+api.*repos.*--method\\s+DELETE'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'financial_transactions',
    label: 'Financial transactions',
    description: 'Payments, transfers, Stripe/PayPal, financial operations',
    tools: ['runTerminalCommand', 'executeCommand', 'browserFillForm', 'browserType', 'desktopBrowserFillForm'],
    patterns: ['payment', '\\bstripe\\b', 'paypal', 'financial', 'transfer.*money', 'transaction.*confirm', 'charge\\s+card'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'purchases',
    label: 'Purchases',
    description: 'Buying, ordering, checkout, cart purchases',
    tools: ['browserClick', 'browserFillForm', 'desktopBrowserClick', 'desktopBrowserFillForm'],
    patterns: ['purchase', 'buy\\s+now', 'checkout', 'add\\s+to\\s+cart', 'order\\s+confirm', 'place\\s+order'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'sending_sensitive_info',
    label: 'Sending sensitive information',
    description: 'Exfiltrating secrets, PII, credentials via clipboard, email, browser, terminal',
    tools: ['pasteClipboard', 'browserType', 'runTerminalCommand', 'browserFillForm'],
    patterns: ['send.*secret', 'exfiltrate', 'credential.*send', 'send.*password', 'upload.*secret'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'high_impact_publishing',
    label: 'High-impact publishing',
    description: 'Publishing releases: npm publish, docker push, deploy, git push to main/master, release',
    tools: ['runTerminalCommand', 'executeCommand', 'browserClick'],
    patterns: ['npm\\s+publish', 'docker\\s+push', 'git\\s+push.*origin\\s+(main|master)\\b', '\\bdeploy\\b', '\\brelease\\b', 'publish.*prod', 'vercel\\s+--prod', 'firebase\\s+deploy'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'destructive_cloud',
    label: 'Destructive cloud actions',
    description: 'Cloud resource deletion: aws/az/gcloud/kubectl/terraform destructive',
    tools: ['runTerminalCommand', 'executeCommand'],
    patterns: ['aws\\s+.*delete', 'az\\s+.*delete', 'gcloud\\s+.*delete', 'kubectl\\s+delete', 'terraform\\s+destroy', 's3\\s+rm', 'ec2\\s+terminate'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
  {
    id: 'credential_changes',
    label: 'Credential changes',
    description: 'Password, token, credential modifications, secret rotation',
    tools: ['runTerminalCommand', 'executeCommand'],
    patterns: ['password', 'passwd', 'credential.*change', 'token.*rotate', 'secret.*update', 'apikey.*change', 'gh\\s+auth.*login'],
    pathPatterns: [],
    requiresConfirmation: true,
    enabled: true,
  },
]);

// ---------------------------------------------------------------------------
// Helpers: data dir §52, redaction, path normalization
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultPolicyPath() {
  return path.join(getMyraaDataDir(), 'policy.json');
}
function nowIso() { return new Date().toISOString(); }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function normalizeKey(k) { return String(k || '').trim().toLowerCase(); }
function normalizePath(p) {
  if (!p) return '';
  try { return path.normalize(String(p)).toLowerCase(); } catch { return String(p).toLowerCase(); }
}
function extractHostname(urlOrName) {
  if (!urlOrName) return '';
  let s = String(urlOrName).trim();
  // if it's already a hostname without scheme
  if (!s.includes('://') && s.includes('.') && !s.includes(' ')) {
    // treat as host
    s = 'https://' + s;
  }
  try {
    const u = new URL(s);
    return u.hostname.toLowerCase();
  } catch {
    // fallback: extract domain-like token
    const m = s.toLowerCase().match(/([a-z0-9-]+\.)+[a-z]{2,}/);
    return m ? m[0] : s.toLowerCase();
  }
}
function extractCommandString(args) {
  if (!args || typeof args !== 'object') return '';
  const cmd = args.command ?? args.cmd ?? args.code ?? '';
  return String(cmd);
}
function extractPathsFromArgs(args) {
  if (!args || typeof args !== 'object') return [];
  const keys = ['path','filePath','dirPath','folder','directory','folderPath','source','destination','oldPath','newPath','target','cwd','file','fileName','script'];
  const out = [];
  for (const k of keys) {
    if (args[k]) out.push(String(args[k]));
    // also handle filePath alias etc already
  }
  // also check content for path-like strings? not needed
  return out.filter(Boolean);
}

// Secret redaction for logs — never log secrets §38
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
  out = out.replace(GENERIC_ASSIGNMENT_REGEX, (_m, key, _q) => {
    const hasQuotes = _m.includes('"') || _m.includes("'");
    const quote = hasQuotes ? '"' : '';
    return `${key}=${quote}[REDACTED]${quote}`;
  });
  return out;
}
function redactArgsForLog(args) {
  if (!args || typeof args !== 'object') return args;
  const copy = { ...args };
  for (const k of Object.keys(copy)) {
    if (/api[_-]?key|apikey|secret|password|passwd|pwd|token|credential|auth/i.test(k)) {
      copy[k] = '[REDACTED]';
    } else if (typeof copy[k] === 'string') {
      copy[k] = redactString(copy[k]);
    }
  }
  return copy;
}

// ---------------------------------------------------------------------------
// PolicyEngine — §34-35
// ---------------------------------------------------------------------------
export class PolicyEngine {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (default %APPDATA%\myraa\policy.json)
   * @param {object} opts.initialRules - override initial rules (for tests)
   * @param {object} opts.logger
   * @param {object} opts.stopController - optional STOP controller for emergency blocking
   * @param {boolean} opts.autoLoad - load from disk on construction (default true)
   */
  constructor({ filePath, initialRules, logger = console, stopController = null, autoLoad = true } = {}) {
    this.filePath = filePath || getDefaultPolicyPath();
    this.logger = logger;
    this.stopController = stopController;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    // Configurable rules per §35
    this.rules = {
      tools: {},        // toolName -> tier
      apps: {},         // appName -> tier
      websites: {},     // hostname/domain -> tier
      devices: {},      // deviceId -> tier
      operations: {},   // operation -> tier
      directories: {},  // path prefix -> tier
      commands: {},     // substring/pattern -> tier
      accounts: {},     // account -> tier
      agents: {},       // agentId -> tier
    };
    // Dangerous operations list (configurable)
    this.dangerousOperations = DANGEROUS_OPERATIONS_DEFAULT.map(o => ({ ...o }));
    // Global flags
    this.global = {
      defaultDangerousRequiresConfirmation: true,
      allowDangerousEnvOverride: true,
    };

    if (initialRules) this._applyInitialRules(initialRules);
    if (autoLoad) this.load();
  }

  _applyInitialRules(initial) {
    if (!initial || typeof initial !== 'object') return;
    for (const scope of Object.keys(this.rules)) {
      if (initial[scope] && typeof initial[scope] === 'object') {
        for (const [k, v] of Object.entries(initial[scope])) {
          const tier = String(v).toUpperCase();
          if (isValidTier(tier)) this.rules[scope][normalizeKey(k)] = tier;
        }
      }
    }
    // allow directory keys with original path casing preserved but normalized lookup will handle
    if (initial.global && typeof initial.global === 'object') {
      Object.assign(this.global, initial.global);
    }
    if (Array.isArray(initial.dangerousOperations)) {
      // merge overrides
      for (const o of initial.dangerousOperations) {
        if (!o || !o.id) continue;
        const idx = this.dangerousOperations.findIndex(x => x.id === o.id);
        if (idx >= 0) this.dangerousOperations[idx] = { ...this.dangerousOperations[idx], ...o };
        else this.dangerousOperations.push({ ...o });
      }
    }
  }

  // ------------------------- persistence §52 -------------------------
  _getPersistPayload() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      rules: this.rules,
      dangerousOperations: this.dangerousOperations,
      global: this.global,
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
      this.logger.warn?.(`[PolicyEngine] save failed: ${e.message}`);
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
      // no file — keep defaults
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[PolicyEngine] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (data.rules && typeof data.rules === 'object') {
      for (const scope of Object.keys(this.rules)) {
        if (data.rules[scope] && typeof data.rules[scope] === 'object') {
          // sanitize tiers
          this.rules[scope] = {};
          for (const [k, v] of Object.entries(data.rules[scope])) {
            const tier = String(v).toUpperCase();
            if (isValidTier(tier)) this.rules[scope][normalizeKey(k)] = tier;
            // directory keys need path normalization for matching still ok via normalizePath
          }
          // for directories, we may need to keep original path keys for display but normalized for lookup
          // Keep normalized keys; original display lost but functional — we also store directories with normalized paths
          if (scope === 'directories' && data.rules[scope]) {
            // re-normalize directory keys to path-normalized form for matching consistency
            const normalized = {};
            for (const [k, v] of Object.entries(this.rules[scope])) {
              const nk = normalizePath(k);
              normalized[nk] = v;
            }
            this.rules[scope] = normalized;
          }
        }
      }
    }
    if (Array.isArray(data.dangerousOperations)) {
      // merge with defaults: keep default entries but apply overrides
      const byId = new Map(this.dangerousOperations.map(o => [o.id, o]));
      for (const o of data.dangerousOperations) {
        if (!o || !o.id) continue;
        if (byId.has(o.id)) byId.set(o.id, { ...byId.get(o.id), ...o });
        else byId.set(o.id, { ...o });
      }
      // also handle removals if persisted list is shorter? Keep only persisted if they intentionally removed?
      // For now use byId values
      this.dangerousOperations = [...byId.values()];
    }
    if (data.global && typeof data.global === 'object') {
      this.global = { ...this.global, ...data.global };
    }
  }

  // ------------------------- configurable permissions §35 -------------------------
  getRules() {
    // return deep copy
    return {
      version: this.version,
      updatedAt: this.updatedAt,
      rules: JSON.parse(JSON.stringify(this.rules)),
      dangerousOperations: this.dangerousOperations.map(o => ({ ...o })),
      global: { ...this.global },
    };
  }

  getConfig() { return this.getRules(); }

  /**
   * Set rule per scope/key -> tier.
   * @param {string} scope - one of tools/apps/websites/devices/operations/directories/commands/accounts/agents
   * @param {string} key
   * @param {string} tier - SAFE/NORMAL/DANGEROUS
   */
  setRule(scope, key, tier) {
    if (!scope || !key) return { ok: false, error: 'scope and key required' };
    const s = normalizeKey(scope);
    // map plural/singular
    const scopeMap = {
      tool: 'tools', tools: 'tools',
      app: 'apps', apps: 'apps', application: 'apps', applications: 'apps',
      website: 'websites', websites: 'websites', site: 'websites',
      device: 'devices', devices: 'devices',
      operation: 'operations', operations: 'operations', op: 'operations',
      directory: 'directories', directories: 'directories', dir: 'directories', folder: 'directories',
      command: 'commands', commands: 'commands', cmd: 'commands',
      account: 'accounts', accounts: 'accounts',
      agent: 'agents', agents: 'agents',
    };
    const resolvedScope = scopeMap[s];
    if (!resolvedScope || !(resolvedScope in this.rules)) {
      return { ok: false, error: `Invalid scope: ${scope}. Valid: ${Object.keys(scopeMap).join(', ')}` };
    }
    const t = String(tier).toUpperCase();
    if (!isValidTier(t)) return { ok: false, error: `Invalid tier: ${tier}. Must be SAFE/NORMAL/DANGEROUS` };
    let normalizedKey = normalizeKey(key);
    if (resolvedScope === 'directories') normalizedKey = normalizePath(key);
    this.rules[resolvedScope][normalizedKey] = t;
    this.save();
    return { ok: true, scope: resolvedScope, key: normalizedKey, tier: t };
  }

  removeRule(scope, key) {
    if (!scope || !key) return { ok: false, error: 'scope and key required' };
    const scopeMap = {
      tool: 'tools', tools: 'tools',
      app: 'apps', apps: 'apps',
      website: 'websites', websites: 'websites',
      device: 'devices', devices: 'devices',
      operation: 'operations', operations: 'operations',
      directory: 'directories', directories: 'directories',
      command: 'commands', commands: 'commands',
      account: 'accounts', accounts: 'accounts',
      agent: 'agents', agents: 'agents',
    };
    const resolvedScope = scopeMap[normalizeKey(scope)];
    if (!resolvedScope || !(resolvedScope in this.rules)) return { ok: false, error: `Invalid scope: ${scope}` };
    let nk = normalizeKey(key);
    if (resolvedScope === 'directories') nk = normalizePath(key);
    const existed = nk in this.rules[resolvedScope];
    delete this.rules[resolvedScope][nk];
    this.save();
    return { ok: true, removed: existed, scope: resolvedScope, key: nk };
  }

  // Convenience wrappers
  setToolRule(tool, tier) { return this.setRule('tools', tool, tier); }
  setAppRule(app, tier) { return this.setRule('apps', app, tier); }
  setWebsiteRule(host, tier) { return this.setRule('websites', host, tier); }
  setDeviceRule(device, tier) { return this.setRule('devices', device, tier); }
  setOperationRule(op, tier) { return this.setRule('operations', op, tier); }
  setDirectoryRule(dir, tier) { return this.setRule('directories', dir, tier); }
  setCommandRule(pattern, tier) { return this.setRule('commands', pattern, tier); }
  setAccountRule(account, tier) { return this.setRule('accounts', account, tier); }
  setAgentRule(agent, tier) { return this.setRule('agents', agent, tier); }

  // Bulk set
  setRulesBulk(rulesObj) {
    if (!rulesObj || typeof rulesObj !== 'object') return { ok: false, error: 'rules object required' };
    let count = 0;
    for (const [scope, map] of Object.entries(rulesObj)) {
      if (!map || typeof map !== 'object') continue;
      for (const [k, v] of Object.entries(map)) {
        const res = this.setRule(scope, k, v);
        if (res.ok) count++;
      }
    }
    return { ok: true, updated: count };
  }

  clearScope(scope) {
    const scopeMap = {
      tools: 'tools', apps: 'apps', websites: 'websites', devices: 'devices',
      operations: 'operations', directories: 'directories', commands: 'commands',
      accounts: 'accounts', agents: 'agents',
    };
    const resolved = scopeMap[normalizeKey(scope)];
    if (!resolved) return { ok: false, error: `Invalid scope: ${scope}` };
    this.rules[resolved] = {};
    this.save();
    return { ok: true, scope: resolved };
  }

  reset() {
    for (const k of Object.keys(this.rules)) this.rules[k] = {};
    this.dangerousOperations = DANGEROUS_OPERATIONS_DEFAULT.map(o => ({ ...o }));
    this.global = { defaultDangerousRequiresConfirmation: true, allowDangerousEnvOverride: true };
    this.save();
    return { ok: true };
  }

  // ------------------------- dangerous operations §36 configurable -------------------------
  listDangerousOperations() {
    return this.dangerousOperations.map(o => ({ ...o }));
  }

  getDangerousOperation(id) {
    if (!id) return null;
    const found = this.dangerousOperations.find(o => o.id === normalizeKey(id));
    return found ? { ...found } : null;
  }

  configureDangerousOperation(id, cfg = {}) {
    if (!id) return { ok: false, error: 'id required' };
    const idx = this.dangerousOperations.findIndex(o => o.id === normalizeKey(id));
    if (idx === -1) return { ok: false, error: `Dangerous operation not found: ${id}` };
    const cur = this.dangerousOperations[idx];
    const next = { ...cur };
    if ('requiresConfirmation' in cfg) next.requiresConfirmation = !!cfg.requiresConfirmation;
    if ('enabled' in cfg) next.enabled = !!cfg.enabled;
    if ('description' in cfg) next.description = String(cfg.description);
    if ('label' in cfg) next.label = String(cfg.label);
    this.dangerousOperations[idx] = next;
    this.save();
    return { ok: true, operation: { ...next } };
  }

  addDangerousOperation(def) {
    if (!def || !def.id) return { ok: false, error: 'def with id required' };
    if (this.dangerousOperations.some(o => o.id === normalizeKey(def.id))) return { ok: false, error: `Already exists: ${def.id}` };
    const entry = {
      id: normalizeKey(def.id),
      label: def.label || def.id,
      description: def.description || '',
      tools: Array.isArray(def.tools) ? def.tools : [],
      patterns: Array.isArray(def.patterns) ? def.patterns : [],
      pathPatterns: Array.isArray(def.pathPatterns) ? def.pathPatterns : [],
      requiresConfirmation: def.requiresConfirmation !== false,
      enabled: def.enabled !== false,
    };
    this.dangerousOperations.push(entry);
    this.save();
    return { ok: true, operation: { ...entry } };
  }

  removeDangerousOperation(id) {
    if (!id) return { ok: false, error: 'id required' };
    const before = this.dangerousOperations.length;
    this.dangerousOperations = this.dangerousOperations.filter(o => o.id !== normalizeKey(id));
    const removed = this.dangerousOperations.length < before;
    if (removed) this.save();
    return { ok: true, removed };
  }

  setGlobal(key, value) {
    if (!(key in this.global)) return { ok: false, error: `Invalid global key: ${key}. Valid: ${Object.keys(this.global).join(', ')}` };
    this.global[key] = value;
    this.save();
    return { ok: true, key, value };
  }

  // ------------------------- internal matching -------------------------
  _matchApp(args) {
    const raw = args?.name ?? args?.application ?? args?.appName ?? args?.app ?? '';
    const app = normalizeKey(raw);
    if (!app) return null;
    if (this.rules.apps[app]) return { key: app, tier: this.rules.apps[app], source: 'apps' };
    // also try partial? e.g., "Visual Studio Code" vs "vscode" — keep simple exact match
    return null;
  }

  _matchWebsite(args) {
    const url = args?.url ?? args?.href ?? (typeof args?.name === 'string' && args.name.includes('.') ? args.name : '');
    if (!url) return null;
    const host = extractHostname(url);
    if (!host) return null;
    // exact match
    if (this.rules.websites[host]) return { key: host, tier: this.rules.websites[host], source: 'websites' };
    // suffix match: e.g., rule "github.com" matches "api.github.com"
    for (const [k, tier] of Object.entries(this.rules.websites)) {
      if (host === k || host.endsWith('.' + k)) return { key: k, tier, source: 'websites', matchedHost: host };
    }
    return null;
  }

  _matchDevice(context) {
    const d = normalizeKey(context?.device);
    if (!d) return null;
    if (this.rules.devices[d]) return { key: d, tier: this.rules.devices[d], source: 'devices' };
    return null;
  }

  _matchOperation(context, tool) {
    const opRaw = normalizeKey(context?.operation);
    if (opRaw && this.rules.operations[opRaw]) return { key: opRaw, tier: this.rules.operations[opRaw], source: 'operations' };
    // derive from tool category hint: if tool contains operation substring
    if (tool) {
      const tl = normalizeKey(tool);
      for (const [k, tier] of Object.entries(this.rules.operations)) {
        if (tl.includes(k)) return { key: k, tier, source: 'operations', derived: true };
      }
    }
    return null;
  }

  _matchAccount(context) {
    const a = normalizeKey(context?.account);
    if (!a) return null;
    if (this.rules.accounts[a]) return { key: a, tier: this.rules.accounts[a], source: 'accounts' };
    return null;
  }

  _matchAgent(context) {
    const ag = normalizeKey(context?.agent);
    if (!ag) return null;
    if (this.rules.agents[ag]) return { key: ag, tier: this.rules.agents[ag], source: 'agents' };
    // also try agent without numeric suffix? e.g., coding-abc -> coding
    const base = ag.split('-')[0];
    if (base && this.rules.agents[base]) return { key: base, tier: this.rules.agents[base], source: 'agents', base };
    return null;
  }

  _matchTool(tool) {
    const t = normalizeKey(tool);
    if (!t) return null;
    if (this.rules.tools[t]) return { key: t, tier: this.rules.tools[t], source: 'tools' };
    return null;
  }

  _matchDirectories(args) {
    const paths = extractPathsFromArgs(args);
    if (!paths.length) return null;
    let best = null;
    let bestLen = -1;
    for (const p of paths) {
      const np = normalizePath(p);
      for (const [rulePath, tier] of Object.entries(this.rules.directories)) {
        // rulePath is already normalized
        if (np === rulePath || np.startsWith(rulePath + path.sep) || np.startsWith(rulePath + '/') || np.startsWith(rulePath)) {
          // choose longest prefix
          if (rulePath.length > bestLen) {
            bestLen = rulePath.length;
            best = { key: rulePath, tier, source: 'directories', matchedPath: p };
          }
        }
      }
    }
    return best;
  }

  _matchCommands(args) {
    const cmd = extractCommandString(args).toLowerCase();
    if (!cmd) return null;
    let best = null;
    for (const [pattern, tier] of Object.entries(this.rules.commands)) {
      const pat = pattern.toLowerCase();
      // support regex if pattern starts and ends with /
      let matched = false;
      if (pat.startsWith('/') && pat.endsWith('/') && pat.length > 1) {
        try {
          const rx = new RegExp(pat.slice(1, -1), 'i');
          matched = rx.test(cmd);
        } catch { matched = cmd.includes(pat.slice(1, -1)); }
      } else {
        matched = cmd.includes(pat);
        if (!matched) {
          try {
            const rx = new RegExp(pat, 'i');
            matched = rx.test(cmd);
          } catch {}
        }
      }
      if (matched) {
        // longest pattern wins
        if (!best || pat.length > best.key.length) best = { key: pattern, tier, source: 'commands', cmd };
      }
    }
    return best;
  }

  _matchDangerousOperations(tool, args, context) {
    const matches = [];
    const cmd = extractCommandString(args);
    const argsJson = (() => {
      try { return JSON.stringify(args).toLowerCase(); } catch { return ''; }
    })();
    const pathVals = extractPathsFromArgs(args).join(' ').toLowerCase();
    const toolNorm = normalizeKey(tool);

    for (const op of this.dangerousOperations) {
      if (!op.enabled) continue;
      let matched = false;
      let reason = '';

      // tool list direct
      if (Array.isArray(op.tools) && op.tools.map(normalizeKey).includes(toolNorm)) {
        // For file deletion, any delete tool counts; for others, also require pattern if patterns defined?
        // But if tool matches and patterns exist, we still consider match if tool is in list
        // However for terminal/generic destructive patterns, we want pattern match, not just tool.
        // Decision: if op has patterns and tool is terminal-like, require pattern match to reduce false positives for normal terminal commands like ls.
        const terminalTools = ['runterminalcommand', 'executecommand'];
        if (terminalTools.includes(toolNorm) && Array.isArray(op.patterns) && op.patterns.length > 0) {
          // Defer to pattern check below
        } else {
          matched = true;
          reason = `tool "${tool}" is listed for dangerous operation "${op.id}"`;
        }
      }

      // pattern regex on command / args
      if (!matched && Array.isArray(op.patterns) && op.patterns.length > 0) {
        const haystacks = [cmd, argsJson, pathVals];
        // also consider context.operation
        if (context?.operation) haystacks.push(String(context.operation).toLowerCase());
        for (const pat of op.patterns) {
          let rx;
          try {
            rx = typeof pat === 'string' ? new RegExp(pat, 'i') : pat;
          } catch { continue; }
          for (const hs of haystacks) {
            if (hs && rx.test(hs)) {
              matched = true;
              reason = `pattern /${rx.source}/ matched for "${op.id}"`;
              break;
            }
          }
          if (matched) break;
        }
      }

      // pathPatterns
      if (!matched && Array.isArray(op.pathPatterns) && op.pathPatterns.length > 0) {
        for (const pp of op.pathPatterns) {
          if (pathVals.includes(pp.toLowerCase())) {
            matched = true;
            reason = `path contains "${pp}" for "${op.id}"`;
            break;
          }
        }
      }

      // context operation direct id match
      if (!matched && context?.operation && normalizeKey(context.operation) === op.id) {
        matched = true;
        reason = `context operation "${context.operation}" matches "${op.id}"`;
      }

      if (matched) matches.push({ ...op, matchedReason: reason });
    }
    return matches;
  }

  // ------------------------- risk evaluation §34 -------------------------
  /**
   * Evaluate risk for a tool action.
   * @param {string|object} toolOrObj - tool name or { tool, args, context, permission }
   * @param {object} args - tool args (if toolOrObj is string)
   * @param {object} context - { agent, task, device, account, operation, confirmed, ... }
   * @returns {{ tier:string, baseTier:string, effectiveTier:string, dangerousMatches:Array, perScopeMatches:Array, reason:string, requiresConfirmation:boolean }}
   */
  evaluateRisk(toolOrObj, args = {}, context = {}) {
    // Support overloads:
    //  - evaluateRisk({ tool, args, context, permission })
    //  - evaluateRisk(tool, args, context)
    //  - evaluateRisk(missionString) legacy for MasterOrchestrator §5
    let tool, effectiveArgs, effectiveContext, baseTierHint;
    if (typeof toolOrObj === 'object' && toolOrObj !== null && !Array.isArray(toolOrObj) && (toolOrObj.tool || toolOrObj.permission || toolOrObj.args)) {
      tool = toolOrObj.tool;
      effectiveArgs = toolOrObj.args || {};
      effectiveContext = toolOrObj.context || {};
      baseTierHint = toolOrObj.permission;
      // allow second param as context override if provided as object with agent etc.
      if (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length > 0 && !args.command && !args.path && !args.filePath) {
        // heuristic: if args looks like context (has agent/device), merge
        if ('agent' in args || 'device' in args || 'confirmed' in args) {
          effectiveContext = { ...effectiveContext, ...args };
        }
      }
      if (context && typeof context === 'object' && Object.keys(context).length > 0) {
        effectiveContext = { ...effectiveContext, ...context };
      }
    } else if (typeof toolOrObj === 'string') {
      // check if it's a mission string (contains spaces and not a known tool)
      const maybeTool = toolOrObj;
      const knownTools = new Set([...Object.keys(this.rules.tools), ...DANGEROUS_OPERATIONS_DEFAULT.flatMap(o => o.tools), 'deleteFile','readFile','writeCodeFile','runTerminalCommand','executeCommand','openApplication','openWebsite','listFiles']);
      // If args is provided and looks like tool args, treat as tool call; else treat as mission
      if (args && typeof args === 'object' && Object.keys(args).length > 0 && (args.command !== undefined || args.path !== undefined || args.filePath !== undefined || args.name !== undefined || args.url !== undefined)) {
        tool = maybeTool;
        effectiveArgs = args;
        effectiveContext = context || {};
      } else if (knownTools.has(maybeTool) || maybeTool.includes(':') || /^[a-zA-Z]+$/.test(maybeTool) && maybeTool.length < 30) {
        // treat as tool name if short and known or no-space
        tool = maybeTool;
        effectiveArgs = args || {};
        effectiveContext = context || {};
      } else {
        // mission string evaluation — simple heuristic: scan for dangerous keywords
        return this._evaluateMissionString(maybeTool, args, context);
      }
    } else {
      tool = String(toolOrObj);
      effectiveArgs = args || {};
      effectiveContext = context || {};
    }

    tool = tool ? String(tool) : 'unknown';
    effectiveArgs = effectiveArgs || {};
    effectiveContext = effectiveContext || {};

    // Determine base tier
    let baseTier = baseTierHint ? String(baseTierHint).toUpperCase() : null;
    if (!baseTier || !isValidTier(baseTier)) {
      // try per-tool rule first
      const toolMatch = this._matchTool(tool);
      if (toolMatch) baseTier = toolMatch.tier;
      else {
        // default tiers based on known tools fallback (mirrors registry)
        const SAFE_TOOLS = new Set(['readFile','listFiles','searchFiles','getClipboard','takeScreenshot','saveScreenshot','analyzeScreenshot','readScreen','systemInfo','gpuInfo','temperatureInfo','getAutoStartStatus','getComputerState','searchWeb','searchYouTube','searchGoogle','searchGitHub','playYouTube']);
        const DANGEROUS_TOOLS = new Set(['deleteFile','moveFile','renameFile','closeApplication','closeWindow','requestPowerAction','executePowerAction','runTerminalCommand','executeCommand','runPythonScript','enableAutoStart','disableAutoStart']);
        const tNorm = normalizeKey(tool);
        if (SAFE_TOOLS.has(tool) || SAFE_TOOLS.has(tNorm)) baseTier = Permission.SAFE;
        else if (DANGEROUS_TOOLS.has(tool) || DANGEROUS_TOOLS.has(tNorm)) baseTier = Permission.DANGEROUS;
        else baseTier = Permission.NORMAL;
      }
    }

    // Gather per-scope matches
    const perScopeMatches = [];
    const matchers = [
      this._matchTool(tool),
      this._matchApp(effectiveArgs),
      this._matchWebsite(effectiveArgs),
      this._matchDevice(effectiveContext),
      this._matchOperation(effectiveContext, tool),
      this._matchDirectories(effectiveArgs),
      this._matchCommands(effectiveArgs),
      this._matchAccount(effectiveContext),
      this._matchAgent(effectiveContext),
    ];
    for (const m of matchers) if (m) perScopeMatches.push(m);

    // Dangerous operations matches
    const dangerousMatches = this._matchDangerousOperations(tool, effectiveArgs, effectiveContext);

    // Compute effective tier: max of base + per-scope + dangerous (dangerous => DANGEROUS)
    const allTiers = [baseTier, ...perScopeMatches.map(m => m.tier)];
    if (dangerousMatches.length > 0) allTiers.push(Permission.DANGEROUS);
    const effectiveTier = maxTier(...allTiers);

    // Requires confirmation?
    let requiresConfirmation = false;
    if (effectiveTier === Permission.DANGEROUS) {
      // check global toggle
      if (this.global.defaultDangerousRequiresConfirmation) {
        // if any dangerous match has requiresConfirmation true, require; else if no dangerous matches but tier DANGEROUS via per-scope, also require
        if (dangerousMatches.length > 0) {
          // if at least one matched op requires confirmation, then require; if all have requiresConfirmation false, don't require
          const anyRequires = dangerousMatches.some(m => m.requiresConfirmation);
          const anyEnabledRequires = dangerousMatches.some(m => m.enabled && m.requiresConfirmation);
          requiresConfirmation = anyRequires || anyEnabledRequires;
          // if configurable says no confirmation for all matched, then false
          if (!anyRequires && dangerousMatches.length > 0) requiresConfirmation = false;
          // but if matched ops all disabled? shouldn't happen because disabled not matched
        } else {
          requiresConfirmation = true;
        }
      }
    }

    // Build reason
    const parts = [];
    parts.push(`base:${baseTier}`);
    if (perScopeMatches.length) parts.push(`per-scope:${perScopeMatches.map(m => `${m.source}:${m.key}=${m.tier}`).join(',')}`);
    if (dangerousMatches.length) parts.push(`dangerous:${dangerousMatches.map(m => m.id).join(',')}`);
    parts.push(`effective:${effectiveTier}`);
    if (requiresConfirmation) parts.push('requiresConfirmation');
    const reason = parts.join(' | ');

    return {
      tier: effectiveTier,
      baseTier,
      effectiveTier,
      dangerousMatches,
      perScopeMatches,
      reason,
      requiresConfirmation,
      tool,
      args: redactArgsForLog(effectiveArgs),
      context: { ...effectiveContext },
    };
  }

  _evaluateMissionString(mission, _args, _context) {
    const lower = String(mission).toLowerCase();
    const dangerousKeywords = [
      'delete', 'format', 'shutdown', 'restart', 'admin', 'git push --force', 'force push',
      'reset --hard', 'clean -fd', 'branch -d', 'branch -D', 'rm -rf', 'financial',
      'purchase', 'payment', 'sensitive', 'publish', 'deploy', 'credential', 'token'
    ];
    const found = dangerousKeywords.filter(k => lower.includes(k));
    const tier = found.length ? Permission.DANGEROUS : Permission.NORMAL;
    return {
      tier,
      baseTier: tier,
      effectiveTier: tier,
      dangerousMatches: found.length ? [{ id: 'mission:keyword', matchedReason: found.join(',') }] : [],
      perScopeMatches: [],
      reason: found.length ? `mission contains dangerous keywords: ${found.join(',')}` : `mission evaluated as ${tier}`,
      requiresConfirmation: tier === Permission.DANGEROUS && this.global.defaultDangerousRequiresConfirmation,
      tool: 'mission',
      args: { mission: String(mission).slice(0, 200) },
      context: {},
    };
  }

  // ------------------------- assess — main gate §34 -------------------------
  /**
   * Assess whether a tool action is allowed. Every tool action must pass through this.
   * @param {object|string} input - { tool, permission, args, context } or tool string
   * @param {object} maybeArgs
   * @param {object} maybeContext
   * @returns {{ allowed:boolean, needsConfirmation:boolean, tier:string, reason:string, risk:object }}
   */
  async assess(input, maybeArgs, maybeContext) {
    // Emergency STOP check — independent gate §37
    if (this.stopController && typeof this.stopController.isStopped === 'function' && this.stopController.isStopped()) {
      const state = typeof this.stopController.getState === 'function' ? this.stopController.getState() : {};
      return {
        allowed: false,
        needsConfirmation: false,
        tier: Permission.DANGEROUS,
        reason: `Emergency STOP active — blocked (reason: ${state.reason || 'unknown'})`,
        blockedByStop: true,
        risk: { tier: Permission.DANGEROUS, reason: 'STOP active' },
      };
    }

    let risk;
    // Support registry calling with { tool, permission, args, context }
    if (typeof input === 'object' && input !== null && ('tool' in input || 'permission' in input || 'args' in input)) {
      risk = this.evaluateRisk(input, maybeArgs, maybeContext);
    } else {
      risk = this.evaluateRisk(input, maybeArgs, maybeContext);
    }

    const needsConfirmation = !!risk.requiresConfirmation;
    const confirmed = !!(risk.context?.confirmed === true || risk.context?.confirmed === 'true' || maybeArgs?.confirmed === true || maybeContext?.confirmed === true);
    // Also check inside effectiveContext? evaluateRisk already extracted context; but confirm may be in top-level context passed separately
    const ctxConfirmed = !!(maybeContext?.confirmed === true || maybeArgs?.confirmed === true || risk.context?.confirmed === true);

    // Also check env override
    let envAllows = false;
    if (this.global.allowDangerousEnvOverride && process.env.MYRAA_ALLOW_DANGEROUS === '1') envAllows = true;

    // Also check per-tool explicit allow? If user set tool rule to NORMAL/SAFE, we already computed tier accordingly, so not needed.

    let allowed;
    if (risk.effectiveTier === Permission.SAFE || risk.effectiveTier === Permission.NORMAL) {
      // SAFE/NORMAL auto-allowed unless STOP
      allowed = true;
    } else if (risk.effectiveTier === Permission.DANGEROUS) {
      if (needsConfirmation) {
        if (ctxConfirmed || confirmed || envAllows) allowed = true;
        else allowed = false;
      } else {
        allowed = true; // DANGEROUS but confirmation not required per config
      }
    } else {
      allowed = true;
    }

    return {
      allowed,
      needsConfirmation: needsConfirmation && !allowed,
      tier: risk.effectiveTier,
      reason: risk.reason,
      risk,
      confirmed: !!(confirmed || ctxConfirmed || envAllows),
      blockedByStop: false,
    };
  }

  // Backwards compat aliases for ToolRegistry integration
  async checkPermission(tool, args, context) { return this.assess({ tool, args, context }); }
  async evaluate(tool, args, context) { return this.assess({ tool, args, context }); }

  // ------------------------- stop controller hook -------------------------
  setStopController(controller) {
    this.stopController = controller;
    return { ok: true };
  }

  // ------------------------- inspection -------------------------
  getStats() {
    return {
      version: this.version,
      file: this.filePath,
      rulesCount: Object.fromEntries(Object.entries(this.rules).map(([k, v]) => [k, Object.keys(v).length])),
      dangerousOperationsCount: this.dangerousOperations.length,
      dangerousRequiresConfirmation: this.global.defaultDangerousRequiresConfirmation,
      totalRules: Object.values(this.rules).reduce((acc, m) => acc + Object.keys(m).length, 0),
    };
  }

  describe() { return this.getRules(); }

  // Expose helpers for external validation
  isDangerous(tool, args, context) {
    const m = this._matchDangerousOperations(tool, args, context);
    return m.length > 0;
  }
  getDangerousMatches(tool, args, context) {
    return this._matchDangerousOperations(tool, args, context);
  }
}

// Default singleton for Master Orchestrator / ToolRegistry
export const policyEngine = new PolicyEngine();
// Wire emergency STOP by default §37 — must function independently but policy must respect STOP
try { policyEngine.setStopController(defaultStopController); } catch {}

export default PolicyEngine;
