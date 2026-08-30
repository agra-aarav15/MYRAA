// Myraa Memory Architecture — MASTER BUILD PROMPT §21-22, §51
// Implements persistent, categorized memory store with scoped retrieval, inspect/edit/delete/clear,
// persistent JSON at %APPDATA%\myraa\myraa_memory.json (local-first §25), and no-secrets redaction (§23).
//
// Categories per §21, §22, §51:
//   ConversationMemory, ProjectMemory, Preferences (User Preferences), TaskHistory, WorkflowMemory, SystemKnowledge, ToolKnowledge
// Spec task lists 6 mandatory categories: ConversationMemory, ProjectMemory, Preferences, TaskHistory, WorkflowMemory, SystemKnowledge
// ToolKnowledge included as extension per §51 for completeness but the 6 are strictly required.
// Features: scoped retrieval (avoid irrelevant memory §51), disabled categories, project-scoped clear,
// edit/delete/inspect/clear, secret redaction, atomic persistence, legacy migration.

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Paths — %APPDATA%\myraa\myraa_memory.json per spec (§21-22)
// Follows same resolution as myraa-core/tools/computer.js DATA_DIR
// ---------------------------------------------------------------------------

export function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}

export function getDefaultMemoryPath() {
  return path.join(getMyraaDataDir(), 'myraa_memory.json');
}

export function getLegacyMemoryPath() {
  // Old file used by dist/server.cjs: memories.json
  return path.join(getMyraaDataDir(), 'memories.json');
}

// ---------------------------------------------------------------------------
// Categories — §51 separate memory categories with scoped retrieval
// ---------------------------------------------------------------------------

export const CATEGORIES = Object.freeze({
  CONVERSATION: 'ConversationMemory',
  PROJECT: 'ProjectMemory',
  PREFERENCES: 'Preferences',
  TASK_HISTORY: 'TaskHistory',
  WORKFLOW: 'WorkflowMemory',
  SYSTEM: 'SystemKnowledge',
  TOOL: 'ToolKnowledge',
});

/** Alias for compatibility */
export const MEMORY_CATEGORIES = CATEGORIES;

/** List of all category values */
export const CATEGORY_LIST = Object.freeze(Object.values(CATEGORIES));

/** Mandatory 6 per prompt §21-22 */
export const REQUIRED_CATEGORIES = Object.freeze([
  CATEGORIES.CONVERSATION,
  CATEGORIES.PROJECT,
  CATEGORIES.PREFERENCES,
  CATEGORIES.TASK_HISTORY,
  CATEGORIES.WORKFLOW,
  CATEGORIES.SYSTEM,
]);

export function isValidCategory(cat) {
  return CATEGORY_LIST.includes(cat);
}

// ---------------------------------------------------------------------------
// Secret redaction — §22 "Do not store secrets in ordinary memory" + §23
// Never place raw secrets in chat history, memory, logs, task traces etc.
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERN = /api[_-]?key|apikey|secret|password|passwd|pwd|token|credential|auth/i;

// Patterns that detect raw secret values (provider keys + generic assignments)
// All replacements contain exact "[REDACTED]" substring for testability and consistency (§23)
const RAW_SECRET_REGEXES = [
  { name: 'openai', regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED]' },
  { name: 'openai_proj', regex: /sk-proj-[a-zA-Z0-9-_]{60,}/g, replacement: '[REDACTED]' },
  { name: 'anthropic', regex: /sk-ant-api03-[a-zA-Z0-9-_]{30,}/g, replacement: '[REDACTED]' },
  { name: 'gemini', regex: /AIza[0-9A-Za-z-_]{30,}/g, replacement: '[REDACTED]' },
  { name: 'groq', regex: /gsk_[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED]' },
  { name: 'github', regex: /ghp_[a-zA-Z0-9]{30,}/g, replacement: '[REDACTED]' },
  { name: 'aws', regex: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
  { name: 'private_key', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, replacement: '[REDACTED]' },
  { name: 'bearer', regex: /Bearer\s+[A-Za-z0-9\-_.]{20,}/g, replacement: 'Bearer [REDACTED]' },
];

const GENERIC_ASSIGNMENT_REGEX =
  /(api[_-]?key|apikey|secret[_-]?key|access[_-]?key|password|passwd|pwd|token|bearer|auth[_-]?token|credential|secret)\s*[:=]\s*(['"]?)([^'"\s,;]+)\2/gi;

/**
 * Redact secrets from a string.
 * @param {string} text
 * @returns {{ redactedText: string, wasRedacted: boolean, redactions: number }}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return { redactedText: text, wasRedacted: false, redactions: 0 };
  let out = text;
  let wasRedacted = false;
  let redactions = 0;

  for (const { regex, replacement } of RAW_SECRET_REGEXES) {
    // need fresh regex per call because global state
    const re = new RegExp(regex.source, regex.flags);
    if (re.test(out)) {
      out = out.replace(new RegExp(regex.source, regex.flags), replacement);
      wasRedacted = true;
      redactions++;
    }
  }

  // generic key=value assignments — replace value with [REDACTED]
  const beforeGeneric = out;
  // we need to handle replacement function that preserves key
  out = out.replace(GENERIC_ASSIGNMENT_REGEX, (_m, key, _q, _val) => {
    wasRedacted = true;
    redactions++;
    // preserve key casing as-is, normalize separator to =
    // detect if original had quotes
    const hasQuotes = _m.includes('"') || _m.includes("'");
    const quote = hasQuotes ? '"' : '';
    return `${key}=${quote}[REDACTED]${quote}`;
  });

  // If any change happened but generic regex didn't capture raw entropy long strings in quotes, do extra entropy check
  // high-entropy quoted strings length >=32 that look like keys and are not already redacted
  // conservative: only if contains mix of upper/lower/digit and length >=32
  const entropyRegex = /(['"])([A-Za-z0-9_\-\/+]{32,})\1/g;
  // Only redact if surrounding context suggests secret (avoid redacting normal code strings)
  // We keep this narrow: only redact if string is inside a secret key context or is standalone long token without spaces
  // For now, do not blanket redact all high-entropy strings to avoid over-redaction

  if (out !== text) wasRedacted = true;
  // also check if any remaining [REDACTED] marker was added
  if (out.includes('[REDACTED')) wasRedacted = true;

  return { redactedText: out, wasRedacted, redactions };
}

export function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key));
}

/**
 * Deep-redact an object: keys matching secret pattern get value [REDACTED],
 * string values are scanned with redactSecrets.
 */
export function redactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return redactSecrets(obj).redactedText;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSecretKey(k)) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'string') {
        out[k] = redactSecrets(v).redactedText;
      } else if (typeof v === 'object' && v !== null) {
        out[k] = redactObject(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// MemoryStore — §21 persistent project/user memory, §22 controls, §51 scoped retrieval
// ---------------------------------------------------------------------------

export class MemoryStore {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - override persistence path (for tests). Defaults to %APPDATA%\myraa\myraa_memory.json
   * @param {number} opts.maxPerCategory - cap per category to avoid unbounded growth (default 1000)
   * @param {boolean} opts.autoLoad - load from disk on construction (default true)
   */
  constructor({ filePath, maxPerCategory = 1000, autoLoad = true } = {}) {
    this.filePath = filePath || getDefaultMemoryPath();
    this.maxPerCategory = maxPerCategory;
    /** @type {Record<string, Array>} */
    this.memories = {};
    for (const cat of CATEGORY_LIST) this.memories[cat] = [];
    /** @type {Set<string>} */
    this.disabledCategories = new Set();
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;

    if (autoLoad) this.load();
  }

  // ------------------------- persistence -------------------------

  _getPersistPayload() {
    // ensure no secrets leak even if caller somehow injected raw secret into memory object
    const safeMemories = {};
    for (const cat of CATEGORY_LIST) {
      safeMemories[cat] = (this.memories[cat] || []).map((e) => {
        // double-redact text field
        const redacted = redactSecrets(String(e.text ?? '')).redactedText;
        return { ...e, text: redacted };
      });
    }
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      disabledCategories: [...this.disabledCategories],
      memories: safeMemories,
    };
  }

  save() {
    try {
      ensureDirForFile(this.filePath);
      const payload = this._getPersistPayload();
      // atomic write: write to temp then rename
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.updatedAt = payload.updatedAt;
      return { ok: true, path: this.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, migrated: false };
      }
      // try legacy migration: only for default path — temp/test stores must remain isolated
      const defaultPath = getDefaultMemoryPath();
      const legacy = getLegacyMemoryPath();
      if (this.filePath === defaultPath && fs.existsSync(legacy) && legacy !== this.filePath) {
        try {
          const lraw = fs.readFileSync(legacy, 'utf8');
          const ldata = JSON.parse(lraw);
          // legacy format is array of { id, category, text, ... } or similar — migrate
          if (Array.isArray(ldata)) {
            for (const item of ldata) {
              const cat = item.category || CATEGORIES.CONVERSATION;
              const safeCat = isValidCategory(cat) ? cat : CATEGORIES.CONVERSATION;
              const { redactedText } = redactSecrets(String(item.text || item.content || ''));
              const entry = {
                id: item.id || genId(),
                category: safeCat,
                text: redactedText,
                timestamp: item.timestamp || item.createdAt || nowIso(),
                projectId: item.projectId || null,
                source: item.source || 'legacy-migration',
                redacted: false,
              };
              this.memories[safeCat].push(entry);
            }
            this.save();
            return { ok: true, path: this.filePath, migrated: true, legacy };
          } else if (ldata && typeof ldata === 'object' && ldata.memories) {
            this._hydrate(ldata);
            this.save();
            return { ok: true, path: this.filePath, migrated: true, legacy };
          }
        } catch {}
      }
      // no file — keep empty
      return { ok: true, path: this.filePath, empty: true };
    } catch (e) {
      return { ok: false, error: e.message, path: this.filePath };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    if (Array.isArray(data.disabledCategories)) {
      this.disabledCategories = new Set(data.disabledCategories.filter(isValidCategory));
    }
    const mems = data.memories;
    if (mems && typeof mems === 'object' && !Array.isArray(mems)) {
      for (const cat of CATEGORY_LIST) {
        if (Array.isArray(mems[cat])) {
          // deep clone and ensure redaction
          this.memories[cat] = mems[cat].map((e) => {
            const redacted = redactSecrets(String(e.text ?? '')).redactedText;
            return {
              id: e.id || genId(),
              category: cat,
              text: redacted,
              timestamp: e.timestamp || e.createdAt || nowIso(),
              updatedAt: e.updatedAt || null,
              projectId: e.projectId || null,
              source: e.source || null,
              redacted: !!e.redacted || redacted !== String(e.text ?? ''),
            };
          });
        } else {
          this.memories[cat] = [];
        }
      }
    } else if (Array.isArray(mems)) {
      // flat array format
      for (const cat of CATEGORY_LIST) this.memories[cat] = [];
      for (const e of mems) {
        const cat = isValidCategory(e.category) ? e.category : CATEGORIES.CONVERSATION;
        const redacted = redactSecrets(String(e.text ?? '')).redactedText;
        this.memories[cat].push({
          id: e.id || genId(),
          category: cat,
          text: redacted,
          timestamp: e.timestamp || nowIso(),
          projectId: e.projectId || null,
          source: e.source || null,
          redacted: !!e.redacted,
        });
      }
    }
  }

  // ------------------------- category controls §22 -------------------------

  disableCategory(category) {
    if (!isValidCategory(category)) return { ok: false, error: `Invalid category: ${category}` };
    this.disabledCategories.add(category);
    this.save();
    return { ok: true, disabled: [...this.disabledCategories] };
  }

  enableCategory(category) {
    if (!isValidCategory(category)) return { ok: false, error: `Invalid category: ${category}` };
    this.disabledCategories.delete(category);
    this.save();
    return { ok: true, disabled: [...this.disabledCategories] };
  }

  isDisabled(category) {
    return this.disabledCategories.has(category);
  }

  getDisabledCategories() {
    return [...this.disabledCategories];
  }

  // ------------------------- core CRUD -------------------------

  /**
   * Add a memory entry — redacts secrets automatically.
   * @param {string} category - one of CATEGORIES values
   * @param {string} text - declarative fact to remember
   * @param {object} opts - { projectId, source, id, timestamp }
   */
  add(category, text, opts = {}) {
    if (!isValidCategory(category)) return { ok: false, error: `Invalid category: ${category}. Valid: ${CATEGORY_LIST.join(', ')}` };
    if (this.isDisabled(category)) return { ok: false, error: `Category disabled: ${category}`, disabled: true };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'text is required and must be non-empty string' };

    // redact before storing — §23 never store raw secrets
    const { redactedText, wasRedacted } = redactSecrets(text);
    // also redact opts if they contain strings
    const safeOpts = redactObject(opts);

    const entry = {
      id: safeOpts.id || genId(),
      category,
      text: redactedText,
      timestamp: safeOpts.timestamp || nowIso(),
      updatedAt: null,
      projectId: safeOpts.projectId || null,
      source: safeOpts.source || null,
      redacted: wasRedacted,
    };

    this.memories[category].push(entry);
    // enforce cap: keep most recent
    if (this.memories[category].length > this.maxPerCategory) {
      this.memories[category] = this.memories[category].slice(-this.maxPerCategory);
    }
    this.save();
    return { ok: true, entry, wasRedacted };
  }

  /** Alias per legacy naming */
  addMemory(category, text, opts) {
    return this.add(category, text, opts);
  }

  /**
   * Scoped retrieval — §51 avoid sending irrelevant memory to models.
   * Supports:
   *  - get(category) -> all for category
   *  - get({ categories, query, limit, projectId, includeDisabled })
   *  - retrieve / search helpers
   */
  get(categoryOrOpts, maybeOpts = {}) {
    // overload handling
    if (typeof categoryOrOpts === 'string') {
      const cat = categoryOrOpts;
      const opts = maybeOpts;
      return this._getScoped({ categories: [cat], ...opts });
    }
    if (categoryOrOpts && typeof categoryOrOpts === 'object') {
      return this._getScoped(categoryOrOpts);
    }
    // no args -> all
    return this._getScoped({});
  }

  _getScoped({ categories, category, query, limit, projectId, includeDisabled = false, offset = 0 } = {}) {
    let cats = [];
    if (category) cats = [category];
    else if (categories) cats = Array.isArray(categories) ? categories : [categories];
    else cats = [...CATEGORY_LIST];

    // filter valid and respect disabled
    cats = cats.filter(isValidCategory);
    if (!includeDisabled) cats = cats.filter((c) => !this.isDisabled(c));

    let results = [];
    for (const cat of cats) {
      const entries = this.memories[cat] || [];
      for (const e of entries) {
        // project filter
        if (projectId && e.projectId !== projectId) continue;
        // query filter (case-insensitive substring)
        if (query && !String(e.text).toLowerCase().includes(String(query).toLowerCase())) continue;
        results.push({ ...e });
      }
    }
    // sort newest first
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = results.length;
    if (offset) results = results.slice(offset);
    if (limit && limit > 0) results = results.slice(0, limit);
    return { ok: true, results, total, categories: cats, query: query || null, projectId: projectId || null };
  }

  /** Scoped retrieval alias §51 */
  retrieve(opts = {}) {
    return this._getScoped(opts);
  }

  /** Search across categories — convenience wrapper */
  search(query, opts = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) return { ok: false, error: 'query required' };
    return this._getScoped({ query, ...opts });
  }

  /** Inspect memory — returns grouped view + flat list */
  inspect(opts = {}) {
    const { category, categories, projectId, includeDisabled = false } = opts;
    // if specific category requested, return filtered
    if (category || categories) {
      const res = this._getScoped({ category, categories, projectId, includeDisabled, limit: opts.limit });
      return {
        ok: true,
        results: res.results,
        total: res.total,
        categories: res.categories,
        disabledCategories: this.getDisabledCategories(),
        file: this.filePath,
      };
    }
    // full inspect: grouped + counts
    const grouped = {};
    let total = 0;
    for (const cat of CATEGORY_LIST) {
      const entries = this.memories[cat] || [];
      const filtered = projectId ? entries.filter((e) => e.projectId === projectId) : entries;
      grouped[cat] = filtered.map((e) => ({ ...e }));
      total += filtered.length;
    }
    const flat = Object.values(grouped).flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limited = opts.limit ? flat.slice(0, opts.limit) : flat;
    return {
      ok: true,
      grouped,
      results: limited,
      total,
      counts: Object.fromEntries(CATEGORY_LIST.map((c) => [c, (grouped[c] || []).length])),
      disabledCategories: this.getDisabledCategories(),
      file: this.filePath,
      version: this.version,
    };
  }

  /** Get by id */
  getById(id) {
    if (!id) return { ok: false, error: 'id required' };
    for (const cat of CATEGORY_LIST) {
      const found = (this.memories[cat] || []).find((e) => e.id === id);
      if (found) return { ok: true, entry: { ...found } };
    }
    return { ok: false, error: `Not found: ${id}` };
  }

  /**
   * Edit memory by id — redacts new text.
   * @param {string} id
   * @param {string} newText
   * @param {object} opts - { categoryHint }
   */
  edit(id, newText, opts = {}) {
    if (!id) return { ok: false, error: 'id required' };
    if (typeof newText !== 'string' || !newText.trim()) return { ok: false, error: 'newText required' };
    const { redactedText, wasRedacted } = redactSecrets(newText);
    for (const cat of CATEGORY_LIST) {
      const idx = (this.memories[cat] || []).findIndex((e) => e.id === id);
      if (idx !== -1) {
        const entry = this.memories[cat][idx];
        entry.text = redactedText;
        entry.updatedAt = nowIso();
        entry.redacted = entry.redacted || wasRedacted;
        // optionally update projectId/source if provided
        if (opts.projectId !== undefined) entry.projectId = opts.projectId;
        if (opts.source !== undefined) entry.source = opts.source;
        this.save();
        return { ok: true, entry: { ...entry }, wasRedacted };
      }
    }
    return { ok: false, error: `Not found: ${id}` };
  }

  /** Update alias */
  update(id, newText, opts) {
    return this.edit(id, newText, opts);
  }

  /**
   * Delete memory by id.
   * @param {string} id
   */
  delete(id) {
    if (!id) return { ok: false, error: 'id required' };
    for (const cat of CATEGORY_LIST) {
      const arr = this.memories[cat] || [];
      const idx = arr.findIndex((e) => e.id === id);
      if (idx !== -1) {
        const [removed] = arr.splice(idx, 1);
        this.save();
        return { ok: true, removed: { ...removed } };
      }
    }
    return { ok: false, error: `Not found: ${id}` };
  }

  /** Alias for delete — matches §22 controls */
  remove(id) {
    return this.delete(id);
  }

  /**
   * Clear a category or all.
   * @param {string|null} category - if null/undefined clears all
   */
  clear(category = null) {
    if (category) {
      if (!isValidCategory(category)) return { ok: false, error: `Invalid category: ${category}` };
      const count = (this.memories[category] || []).length;
      this.memories[category] = [];
      this.save();
      return { ok: true, cleared: category, count };
    }
    // clear all
    let total = 0;
    for (const cat of CATEGORY_LIST) {
      total += (this.memories[cat] || []).length;
      this.memories[cat] = [];
    }
    this.save();
    return { ok: true, cleared: 'all', count: total };
  }

  clearCategory(category) {
    return this.clear(category);
  }

  clearAll() {
    return this.clear(null);
  }

  /**
   * Clear project-scoped memory — §22 clear project memory.
   * Per spec, ProjectMemory is the dedicated category for project-specific knowledge (§21).
   * If projectId provided, clears only ProjectMemory entries with that projectId (project-scoped).
   * If no projectId, clears entire ProjectMemory category.
   * Other categories (WorkflowMemory etc.) are not cleared to avoid over-deletion; use clearAll or clear(category) for those.
   */
  clearProjectMemory(projectId = null) {
    if (projectId) {
      const before = this.memories[CATEGORIES.PROJECT].length;
      this.memories[CATEGORIES.PROJECT] = this.memories[CATEGORIES.PROJECT].filter((e) => e.projectId !== projectId);
      const removed = before - this.memories[CATEGORIES.PROJECT].length;
      this.save();
      return { ok: true, cleared: `project:${projectId}`, count: removed };
    }
    return this.clear(CATEGORIES.PROJECT);
  }

  /** Also provide clearConversation, clearPreferences etc for completeness */
  clearConversation() {
    return this.clear(CATEGORIES.CONVERSATION);
  }

  /** Stats */
  getStats() {
    const counts = {};
    let total = 0;
    for (const cat of CATEGORY_LIST) {
      counts[cat] = (this.memories[cat] || []).length;
      total += counts[cat];
    }
    return {
      ok: true,
      total,
      counts,
      disabledCategories: this.getDisabledCategories(),
      file: this.filePath,
      version: this.version,
      updatedAt: this.updatedAt,
    };
  }

  /** Export snapshot (redacted already) */
  export() {
    return this._getPersistPayload();
  }

  /** Import — merges or replaces */
  import(data, { replace = false } = {}) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid import data' };
    if (replace) {
      this._hydrate(data);
      // ensure disabledCategories from import
      if (Array.isArray(data.disabledCategories)) {
        this.disabledCategories = new Set(data.disabledCategories.filter(isValidCategory));
      }
    } else {
      // merge: add each entry via add (which handles redaction)
      const mems = data.memories || data;
      if (mems && typeof mems === 'object' && !Array.isArray(mems)) {
        for (const cat of CATEGORY_LIST) {
          if (Array.isArray(mems[cat])) {
            for (const e of mems[cat]) {
              this.add(cat, String(e.text || ''), { projectId: e.projectId, source: e.source, timestamp: e.timestamp });
            }
          }
        }
      } else if (Array.isArray(mems)) {
        for (const e of mems) {
          const cat = isValidCategory(e.category) ? e.category : CATEGORIES.CONVERSATION;
          this.add(cat, String(e.text || ''), { projectId: e.projectId, source: e.source, timestamp: e.timestamp });
        }
      }
    }
    this.save();
    return { ok: true };
  }
}

// Default singleton for Master Orchestrator / app usage
export const memoryStore = new MemoryStore();

export default MemoryStore;
