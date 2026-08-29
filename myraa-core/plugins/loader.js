// Myraa Plugin System — MASTER BUILD PROMPT §33
// Implements plugin/tool architecture with metadata, version, permissions, input/output schemas,
// authentication requirements, security policy, capability declaration.
// Integrates with ToolRegistry §33, PolicyEngine §34-35, Audit §38, Credential system §23.
// UI frozen — no dist/assets/black-glassmorphism.css changes.
// Local-first, provider-independent, event-driven (§50), persistent (§52).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers: paths, ids, time (#52 durable storage)
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultPluginsPath() {
  return path.join(getMyraaDataDir(), 'plugins.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'plug') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Validation helpers — §33
// ---------------------------------------------------------------------------
export const PermissionTier = Object.freeze({ SAFE: 'SAFE', NORMAL: 'NORMAL', DANGEROUS: 'DANGEROUS' });
const VALID_TIERS = new Set(Object.values(PermissionTier));
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{1,64}$/i;
const CAPABILITY_REGEX = /^[a-z0-9._-]{1,80}:[a-z0-9._-]{1,80}(:[a-z0-9._-]+)?$/i; // e.g., spotify:play, github:push, aws:s3:read

function isValidSemver(v) { return typeof v === 'string' && SEMVER_REGEX.test(v.trim()); }
function isValidPluginId(id) { return typeof id === 'string' && PLUGIN_ID_REGEX.test(id.trim()); }
function isValidTier(t) { return VALID_TIERS.has(String(t).toUpperCase()); }
function isValidCapability(cap) {
  if (typeof cap !== 'string' || !cap.trim()) return false;
  // allow simple like "spotify.play" or "github:push" — normalize to at least contain : or .
  const s = cap.trim();
  if (CAPABILITY_REGEX.test(s)) return true;
  // also allow single word like "spotify" for legacy, but spec says capability declaration should be explicit
  // accept single segment 2-40 chars alnum
  if (/^[a-z0-9._-]{2,80}$/i.test(s)) return true;
  return false;
}

// Simple JSON Schema validator (subset) — reuses registry logic but standalone for loader validation
function validateJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return { ok: false, error: 'schema must be an object' };
  if (!schema.type) return { ok: false, error: 'schema.type is required (e.g., "object")' };
  const allowedTypes = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null']);
  if (!allowedTypes.has(schema.type)) return { ok: false, error: `invalid schema.type: ${schema.type}` };
  if (schema.type === 'object') {
    if (schema.properties && typeof schema.properties !== 'object') return { ok: false, error: 'schema.properties must be object' };
    if (schema.required && !Array.isArray(schema.required)) return { ok: false, error: 'schema.required must be array' };
    if (schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        if (!v || typeof v !== 'object') return { ok: false, error: `property ${k} must be object` };
        if (v.type && !allowedTypes.has(v.type)) return { ok: false, error: `property ${k} has invalid type ${v.type}` };
      }
    }
  }
  if (schema.enum && !Array.isArray(schema.enum)) return { ok: false, error: 'schema.enum must be array' };
  return { ok: true };
}

function validateMetadata(meta) {
  const errors = [];
  if (!meta || typeof meta !== 'object') return { ok: false, errors: ['metadata must be object'] };
  if (!meta.id || typeof meta.id !== 'string' || !meta.id.trim()) errors.push('metadata.id is required (string)');
  else if (!isValidPluginId(meta.id)) errors.push(`metadata.id invalid: "${meta.id}" must match ${PLUGIN_ID_REGEX.source}`);
  if (!meta.name || typeof meta.name !== 'string' || !meta.name.trim()) errors.push('metadata.name is required');
  if (!meta.description || typeof meta.description !== 'string' || !meta.description.trim()) errors.push('metadata.description is required');
  if (meta.displayName !== undefined && typeof meta.displayName !== 'string') errors.push('metadata.displayName must be string');
  if (meta.author !== undefined && typeof meta.author !== 'string') errors.push('metadata.author must be string');
  if (meta.homepage !== undefined && typeof meta.homepage !== 'string') errors.push('metadata.homepage must be string');
  if (meta.license !== undefined && typeof meta.license !== 'string') errors.push('metadata.license must be string');
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validatePermissions(perms) {
  if (!perms) return { ok: false, error: 'permissions is required' };
  // Support: string tier, array of { capability, tier/permission }, object map capability->tier, or { tier, scopes }
  if (typeof perms === 'string') {
    if (!isValidTier(perms)) return { ok: false, error: `invalid permission tier: ${perms}` };
    return { ok: true, normalized: { tier: String(perms).toUpperCase() } };
  }
  if (Array.isArray(perms)) {
    if (perms.length === 0) return { ok: false, error: 'permissions array must not be empty' };
    const normalized = [];
    for (let i = 0; i < perms.length; i++) {
      const p = perms[i];
      if (!p || typeof p !== 'object') return { ok: false, error: `permissions[${i}] must be object` };
      const cap = p.capability || p.tool || p.scope || p.name;
      const tier = p.tier || p.permission || p.level;
      if (!cap || typeof cap !== 'string') return { ok: false, error: `permissions[${i}].capability is required` };
      if (!tier || !isValidTier(tier)) return { ok: false, error: `permissions[${i}].tier invalid: ${tier}` };
      normalized.push({ capability: String(cap), tier: String(tier).toUpperCase() });
    }
    return { ok: true, normalized };
  }
  if (typeof perms === 'object') {
    // object map or { tier, defaultTier }
    if (perms.tier && isValidTier(perms.tier)) {
      return { ok: true, normalized: { tier: String(perms.tier).toUpperCase(), scopes: perms.scopes || null } };
    }
    // map like { "spotify:play": "NORMAL", "github:push": "DANGEROUS" }
    const keys = Object.keys(perms);
    if (keys.length === 0) return { ok: false, error: 'permissions object must not be empty' };
    const normalized = [];
    for (const k of keys) {
      const v = perms[k];
      const tier = typeof v === 'string' ? v : (v.tier || v.permission);
      if (!isValidTier(tier)) return { ok: false, error: `permissions["${k}"] invalid tier: ${tier}` };
      normalized.push({ capability: k, tier: String(tier).toUpperCase() });
    }
    return { ok: true, normalized };
  }
  return { ok: false, error: 'permissions must be string, array, or object' };
}

function validateAuth(auth) {
  if (auth === null || auth === undefined) return { ok: false, error: 'authentication is required (declare { type, required }) — even if { type: "none", required: false }' };
  if (typeof auth !== 'object') return { ok: false, error: 'auth must be object' };
  // allow { type: "none", required: false } for no-auth plugins
  const type = auth.type || auth.provider || auth.method;
  if (!type || typeof type !== 'string') return { ok: false, error: 'auth.type is required (e.g., "oauth", "apiKey", "none")' };
  const allowedTypes = new Set(['none', 'oauth', 'oauth2', 'apiKey', 'bearer', 'basic', 'token', 'credentials', 'signing']);
  const lower = String(type).toLowerCase();
  // Allow custom types but must be non-empty string 2-30 chars alnum; warn if not in allowed set but not fail — extensibility for future AWS/Docker etc.
  if (typeof type === 'string' && type.trim().length < 2) return { ok: false, error: `auth.type too short: ${type}` };
  if (auth.required !== undefined && typeof auth.required !== 'boolean') return { ok: false, error: 'auth.required must be boolean' };
  if (auth.scopes !== undefined && !Array.isArray(auth.scopes)) return { ok: false, error: 'auth.scopes must be array' };
  if (auth.provider !== undefined && typeof auth.provider !== 'string') return { ok: false, error: 'auth.provider must be string' };
  return { ok: true, normalized: { type: String(type), required: auth.required !== undefined ? !!auth.required : (lower !== 'none'), scopes: auth.scopes || [], provider: auth.provider || null } };
}

function validateSecurityPolicy(policy) {
  if (!policy || typeof policy !== 'object') return { ok: false, error: 'securityPolicy is required (object with isolation/mode)' };
  // Expect at least one of: isolation, sandbox, network, filesystem
  const allowedIsolation = new Set(['none', 'sandbox', 'vm', 'container', 'restricted']);
  if (policy.isolation !== undefined) {
    const iso = String(policy.isolation).toLowerCase();
    if (!allowedIsolation.has(iso) && iso.length < 2) return { ok: false, error: `securityPolicy.isolation invalid: ${policy.isolation}` };
  } else if (policy.sandbox === undefined && policy.mode === undefined) {
    // Require at least one marker; we can default to restricted if missing but spec says security policy is required
    // Do not fail, but provide default — yet for validation we treat missing as error for completeness
    // For backward compat, allow if policy has at least one key like network/filesystem/permissions
    const hasAny = ['network', 'filesystem', 'permissions', 'allowedDomains', 'capabilities'].some(k => k in policy);
    if (!hasAny) return { ok: false, error: 'securityPolicy must declare at least isolation, sandbox, network, filesystem, or permissions' };
  }
  if (policy.allowedDomains !== undefined && !Array.isArray(policy.allowedDomains)) return { ok: false, error: 'securityPolicy.allowedDomains must be array' };
  if (policy.network !== undefined && typeof policy.network !== 'string' && typeof policy.network !== 'object') return { ok: false, error: 'securityPolicy.network must be string or object' };
  if (policy.permissions !== undefined && typeof policy.permissions !== 'object' && typeof policy.permissions !== 'string') return { ok: false, error: 'securityPolicy.permissions must be string or object' };
  return { ok: true, normalized: { ...policy } };
}

function validateCapabilities(caps) {
  if (caps === undefined || caps === null) return { ok: false, error: 'capability declaration is required (capabilities: string[] like ["spotify:play", "github:push"])' };
  if (!Array.isArray(caps)) return { ok: false, error: 'capabilities must be array of strings' };
  if (caps.length === 0) return { ok: false, error: 'capabilities must not be empty — declare at least one capability' };
  const errors = [];
  const normalized = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (typeof c !== 'string' || !c.trim()) { errors.push(`capabilities[${i}] must be non-empty string`); continue; }
    if (!isValidCapability(c)) { errors.push(`capabilities[${i}] invalid: "${c}" must be like "service:action" (e.g., "spotify:play")`); continue; }
    normalized.push(String(c).trim());
  }
  if (errors.length) return { ok: false, error: errors.join('; '), errors };
  // deduplicate
  const deduped = [...new Set(normalized)];
  return { ok: true, normalized: deduped };
}

// Full plugin validation — §33 all 7 required dimensions
export function validatePlugin(plugin) {
  const errors = [];
  if (!plugin || typeof plugin !== 'object') return { ok: false, errors: ['plugin must be object'], valid: false };
  // metadata
  const metaRes = validateMetadata(plugin.metadata || plugin.meta);
  if (!metaRes.ok) errors.push(...(metaRes.errors || [metaRes.error]));
  // version
  const ver = plugin.version || plugin.metadata?.version;
  if (!ver || typeof ver !== 'string' || !isValidSemver(ver)) errors.push(`version is required and must be semver (e.g., "1.0.0") got "${ver}"`);
  // permissions
  const permRes = validatePermissions(plugin.permissions || plugin.permission);
  if (!permRes.ok) errors.push(`permissions: ${permRes.error}`);
  // input/output schema — per plugin or per tool
  // Plugin-level inputSchema/outputSchema or tools[].inputSchema/outputSchema
  const hasPluginLevelSchemas = plugin.inputSchema && plugin.outputSchema;
  const hasToolLevelSchemas = Array.isArray(plugin.tools) && plugin.tools.length > 0 && plugin.tools.every(t => t.inputSchema && t.outputSchema);
  const hasAnyTool = Array.isArray(plugin.tools) && plugin.tools.length > 0;
  if (!hasPluginLevelSchemas && !hasToolLevelSchemas) {
    // Allow plugin with no tools but must have schemas? Spec says plugins must have input/output schema.
    // For plugin-as-tool-container, require at least plugin-level or per-tool schemas.
    // If no tools array, require plugin.inputSchema + outputSchema
    if (!plugin.inputSchema) errors.push('inputSchema is required (JSON schema object) — per plugin or per tool');
    else {
      const r = validateJsonSchema(plugin.inputSchema);
      if (!r.ok) errors.push(`inputSchema: ${r.error}`);
    }
    if (!plugin.outputSchema) errors.push('outputSchema is required (JSON schema object) — per plugin or per tool');
    else {
      const r = validateJsonSchema(plugin.outputSchema);
      if (!r.ok) errors.push(`outputSchema: ${r.error}`);
    }
  } else {
    if (hasPluginLevelSchemas) {
      const r1 = validateJsonSchema(plugin.inputSchema);
      if (!r1.ok) errors.push(`inputSchema: ${r1.error}`);
      const r2 = validateJsonSchema(plugin.outputSchema);
      if (!r2.ok) errors.push(`outputSchema: ${r2.error}`);
    }
    if (hasAnyTool) {
      for (let i = 0; i < plugin.tools.length; i++) {
        const t = plugin.tools[i];
        if (!t || typeof t !== 'object') { errors.push(`tools[${i}] must be object`); continue; }
        if (!t.name || typeof t.name !== 'string') errors.push(`tools[${i}].name is required`);
        if (!t.inputSchema) errors.push(`tools[${i}].inputSchema is required`);
        else { const r = validateJsonSchema(t.inputSchema); if (!r.ok) errors.push(`tools[${i}].inputSchema: ${r.error}`); }
        if (!t.outputSchema) errors.push(`tools[${i}].outputSchema is required`);
        else { const r = validateJsonSchema(t.outputSchema); if (!r.ok) errors.push(`tools[${i}].outputSchema: ${r.error}`); }
        // each tool should have handler or capability
        if (!t.handler && !t.capability && !t.description) { /* allow but warn */ }
      }
    }
  }
  // auth
  const authRes = validateAuth(plugin.auth || plugin.authentication || plugin.authenticationRequirements);
  if (!authRes.ok) errors.push(`authentication: ${authRes.error}`);
  // securityPolicy
  const secRes = validateSecurityPolicy(plugin.securityPolicy || plugin.policy || plugin.security);
  if (!secRes.ok) errors.push(`securityPolicy: ${secRes.error}`);
  // capabilities
  const capRes = validateCapabilities(plugin.capabilities || plugin.capabilityDeclaration || plugin.declaredCapabilities);
  if (!capRes.ok) errors.push(`capabilities: ${capRes.error || capRes.errors?.join('; ')}`);

  if (errors.length) return { ok: false, valid: false, errors, reason: errors.join('; ') };
  return { ok: true, valid: true, errors: [], normalized: {
    metadata: plugin.metadata || plugin.meta,
    version: ver,
    permissions: permRes.normalized,
    auth: authRes.normalized,
    securityPolicy: secRes.normalized,
    capabilities: capRes.normalized,
  }};
}

// ---------------------------------------------------------------------------
// PluginLoader — §33
// ---------------------------------------------------------------------------
export class PluginLoader extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (default %APPDATA%\myraa\plugins.json)
   * @param {object} opts.registry - ToolRegistry instance (defaults to new registry if not provided)
   * @param {object} opts.policyEngine - policy engine for permission/security checks
   * @param {object} opts.auditLogger - audit logger
   * @param {object} opts.credentialsStore - optional credential store for auth validation
   * @param {object} opts.eventBus - optional eventBus
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad - load from disk (default true)
   */
  constructor({ filePath, registry = null, policyEngine = null, auditLogger = null, credentialsStore = null, eventBus = null, logger = console, autoLoad = true } = {}) {
    super();
    this.filePath = filePath || getDefaultPluginsPath();
    this.registry = registry; // lazy init if needed
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;
    this.credentialsStore = credentialsStore;
    this.eventBus = eventBus;
    this.logger = logger;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    /** @type {Map<string, object>} id -> stored plugin */
    this.plugins = new Map();
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(()=>{}); } catch {}
    // lazy imports
    this._policyModule = null;
    this._toolsRegistryModule = null;
    if (autoLoad) this.load();
  }

  async _ensureRegistry() {
    if (this.registry) return this.registry;
    try {
      const mod = await import('../tools/registry.js');
      this._toolsRegistryModule = mod;
      const { ToolRegistry } = mod;
      this.registry = new ToolRegistry({ policyEngine: this.policyEngine, eventBus: this.eventBus, logger: this.logger });
      return this.registry;
    } catch (e) {
      this.logger.warn?.(`[PluginLoader] failed to init registry: ${e.message}`);
      return null;
    }
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
      plugins: [...this.plugins.values()],
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
      return { ok: true, path: this.filePath, count: this.plugins.size };
    } catch (e) {
      this.logger.warn?.(`[PluginLoader] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this.plugins.size };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[PluginLoader] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    const list = Array.isArray(data.plugins) ? data.plugins : (Array.isArray(data) ? data : []);
    this.plugins.clear();
    for (const p of list) {
      if (!p || !p.metadata || !p.metadata.id) continue;
      const id = String(p.metadata.id).toLowerCase();
      this.plugins.set(id, p);
    }
  }

  // ------------------------- validation wrapper -------------------------
  validate(plugin) { return validatePlugin(plugin); }

  // ------------------------- core: register plugin §33 -------------------------
  /**
   * Load and register a plugin.
   * @param {object} plugin - manifest with metadata, version, permissions, schemas, auth, securityPolicy, capabilities, tools[]
   * @param {object} opts - { force, enable }
   */
  // persistence load is sync `load()` above — keep plugin loader under explicit name to avoid shadowing
  async loadPlugin(plugin, opts = {}) {
    if (!plugin || typeof plugin !== 'object') return { ok: false, error: 'plugin object required' };
    // normalize id lowercasing for consistency
    const rawId = (plugin.metadata?.id || plugin.meta?.id || plugin.id || '').toString();
    const idLower = rawId.toLowerCase();

    // Validate
    const validation = validatePlugin(plugin);
    if (!validation.ok) {
      this._emit('plugin:validation:failed', { pluginId: idLower || 'unknown', errors: validation.errors, plugin });
      return { ok: false, error: `Plugin validation failed: ${validation.reason}`, errors: validation.errors, valid: false };
    }

    // Duplicate check
    if (this.plugins.has(idLower) && !opts.force) {
      return { ok: false, error: `Plugin ${idLower} already loaded (use force to replace)`, duplicate: true };
    }

    // Policy/security check — DANGEROUS plugins require confirmation via policyEngine §34-36
    const perms = validation.normalized.permissions;
    let requiresConfirmation = false;
    let highestTier = 'SAFE';
    // Determine highest tier from permissions
    if (Array.isArray(perms)) {
      for (const p of perms) if (String(p.tier).toUpperCase() === 'DANGEROUS') { highestTier = 'DANGEROUS'; break; } else if (String(p.tier).toUpperCase() === 'NORMAL' && highestTier !== 'DANGEROUS') highestTier = 'NORMAL';
    } else if (perms && perms.tier) {
      highestTier = String(perms.tier).toUpperCase();
    }
    // also check per-tool permissions if any?
    if (highestTier === 'DANGEROUS') requiresConfirmation = true;

    // If loader has policyEngine, check if plugin's permissions would be allowed
    if (this.policyEngine && requiresConfirmation && !opts.confirmed) {
      try {
        // Check if caller confirmed dangerous plugin intentionally — look for opts.confirmed or env
        const envAllows = process.env.MYRAA_ALLOW_DANGEROUS === '1';
        if (!envAllows && opts.confirmed !== true) {
          // For tests, we allow dangerous plugins when opts.confirmed or env, otherwise block but still emit validation
          // Per §36 dangerous operations require confirmation — we enforce for plugins too
          // Return needsConfirmation signal, but still allow if tests set confirmed:true
          // If not confirmed, we block load
          if (highestTier === 'DANGEROUS') {
            this._emit('plugin:blocked', { pluginId: idLower, reason: 'DANGEROUS plugin requires confirmation', tier: highestTier });
            return { ok: false, error: `DANGEROUS plugin "${idLower}" requires confirmation (set confirmed:true or MYRAA_ALLOW_DANGEROUS=1)`, needsConfirmation: true, tier: highestTier };
          }
        }
      } catch {}
    }

    // Prepare stored record
    const version = plugin.version || plugin.metadata.version;
    const stored = {
      metadata: {
        id: String(plugin.metadata?.id || plugin.meta?.id || plugin.id).trim(),
        name: String(plugin.metadata?.name || plugin.meta?.name || plugin.name).trim(),
        displayName: plugin.metadata?.displayName || plugin.metadata?.name || plugin.displayName || plugin.name,
        description: String(plugin.metadata?.description || plugin.meta?.description || plugin.description || '').trim(),
        author: plugin.metadata?.author || plugin.meta?.author || plugin.author || 'unknown',
        homepage: plugin.metadata?.homepage || null,
        license: plugin.metadata?.license || null,
        ...plugin.metadata,
      },
      version: String(version).trim(),
      permissions: plugin.permissions || plugin.permission,
      inputSchema: plugin.inputSchema || null,
      outputSchema: plugin.outputSchema || null,
      auth: plugin.auth || plugin.authentication || plugin.authenticationRequirements,
      securityPolicy: plugin.securityPolicy || plugin.policy || plugin.security,
      capabilities: [...validation.normalized.capabilities],
      tools: Array.isArray(plugin.tools) ? plugin.tools.map(t => ({ ...t })) : [],
      enabled: opts.enable !== false,
      loadedAt: nowIso(),
      updatedAt: nowIso(),
      tier: highestTier,
      requiresConfirmation,
      source: plugin.source || 'manual',
    };

    // Register tools with ToolRegistry if available
    const registry = await this._ensureRegistry();
    if (registry) {
      // For each tool, register with registry
      for (const tool of stored.tools) {
        // Ensure tool has required registry fields
        const def = {
          name: tool.name,
          description: tool.description || stored.metadata.description,
          permission: tool.permission || tool.tier || highestTier || 'NORMAL',
          category: tool.category || `plugin:${stored.metadata.id}:${tool.capability || tool.name}`,
          inputSchema: tool.inputSchema || stored.inputSchema,
          outputSchema: tool.outputSchema || stored.outputSchema,
          handler: tool.handler || tool.fn || (async () => ({ ok: true, result: `[Plugin ${stored.metadata.id}] ${tool.name} executed (stub)` })),
          version: tool.version || stored.version,
          auth: tool.auth ?? (stored.auth?.required ? true : false),
          capability: tool.capability || tool.name,
          plugin: stored.metadata.id,
          fallback: tool.fallback || null,
        };
        try {
          registry.register(def);
        } catch (e) {
          // If duplicate tool name, warn but continue — plugin may override
          this.logger.warn?.(`[PluginLoader] tool register failed ${tool.name}: ${e.message}`);
          if (opts.force) {
            try { registry.unregister?.(tool.name); registry.register(def); } catch {}
          }
        }
      }
      // Also register plugin container itself with registry if it has no tools but has schemas (plugin as single tool)
      if (stored.tools.length === 0 && stored.inputSchema && stored.outputSchema) {
        const singleToolDef = {
          name: stored.metadata.id,
          description: stored.metadata.description,
          permission: highestTier,
          category: `plugin:${stored.metadata.id}`,
          inputSchema: stored.inputSchema,
          outputSchema: stored.outputSchema,
          handler: plugin.handler || plugin.execute || (async (args) => ({ ok: true, result: `[Plugin ${stored.metadata.id}] executed`, args })),
          version: stored.version,
          auth: !!stored.auth?.required,
          capability: stored.capabilities[0] || stored.metadata.id,
          plugin: stored.metadata.id,
        };
        try { registry.register(singleToolDef); } catch (e) { this.logger.warn?.(`[PluginLoader] plugin single-tool register failed ${stored.metadata.id}: ${e.message}`); }
      }
    }

    // Persist
    this.plugins.set(idLower, stored);
    this.save();
    this._emit('plugin:loaded', { pluginId: idLower, version: stored.version, capabilities: stored.capabilities, tier: highestTier, toolCount: stored.tools.length });
    this._emit('plugin:registered', { pluginId: idLower, plugin: { ...stored } });
    this._audit({ agent: 'PluginLoader', task: null, tool: `plugin:${idLower}`, action: 'loadPlugin', result: `Loaded plugin ${idLower} v${stored.version} capabilities=${stored.capabilities.join(',')} tier=${highestTier}`, permission: highestTier, device: null });

    return { ok: true, plugin: { ...stored }, pluginId: idLower, version: stored.version, tier: highestTier, toolCount: stored.tools.length };
  }

  // Alias per §33 future examples language (avoid shadowing persistence `load()`)
  async register(plugin, opts) { return this.loadPlugin(plugin, opts); }

  async loadFromFile(filePath, opts = {}) {
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'filePath required' };
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      // Support both single plugin and { plugins: [...] }
      if (Array.isArray(data.plugins)) {
        const results = [];
        for (const p of data.plugins) {
          const res = await this.loadPlugin(p, opts);
          results.push(res);
        }
        return { ok: true, results, count: results.length };
      }
      return this.loadPlugin(data, opts);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async loadFromDirectory(dirPath, opts = {}) {
    if (!dirPath || typeof dirPath !== 'string') return { ok: false, error: 'dirPath required' };
    try {
      if (!fs.existsSync(dirPath)) return { ok: false, error: `Directory not found: ${dirPath}` };
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const results = [];
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.json')) {
          const fp = path.join(dirPath, e.name);
          const res = await this.loadFromFile(fp, opts);
          results.push({ file: e.name, result: res });
        }
      }
      return { ok: true, results, count: results.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ------------------------- unload / enable -------------------------
  unload(pluginId) {
    if (!pluginId) return { ok: false, error: 'pluginId required' };
    const key = String(pluginId).toLowerCase();
    const existing = this.plugins.get(key);
    if (!existing) return { ok: false, error: `Plugin not found: ${pluginId}` };
    // unregister tools from registry
    if (this.registry) {
      for (const tool of (existing.tools || [])) {
        try { this.registry.unregister?.(tool.name); } catch {}
      }
      if ((existing.tools || []).length === 0) {
        try { this.registry.unregister?.(existing.metadata.id); } catch {}
      }
      // also check registry's plugin map
      try { this.registry._plugins?.delete?.(key); } catch {}
    }
    this.plugins.delete(key);
    this.save();
    this._emit('plugin:unloaded', { pluginId: key });
    this._audit({ agent: 'PluginLoader', task: null, tool: `plugin:${key}`, action: 'unloadPlugin', result: `Unloaded plugin ${key}`, permission: existing.tier });
    return { ok: true, pluginId: key, removed: { ...existing } };
  }
  remove(pluginId) { return this.unload(pluginId); }

  enable(pluginId) {
    const key = String(pluginId).toLowerCase();
    const p = this.plugins.get(key);
    if (!p) return { ok: false, error: `Plugin not found: ${pluginId}` };
    p.enabled = true; p.updatedAt = nowIso();
    this.save();
    this._emit('plugin:enabled', { pluginId: key });
    return { ok: true, pluginId: key, enabled: true };
  }
  disable(pluginId) {
    const key = String(pluginId).toLowerCase();
    const p = this.plugins.get(key);
    if (!p) return { ok: false, error: `Plugin not found: ${pluginId}` };
    p.enabled = false; p.updatedAt = nowIso();
    this.save();
    this._emit('plugin:disabled', { pluginId: key });
    return { ok: true, pluginId: key, enabled: false };
  }

  // ------------------------- query -------------------------
  getPlugin(pluginId) {
    if (!pluginId) return { ok: false, error: 'pluginId required' };
    const key = String(pluginId).toLowerCase();
    const p = this.plugins.get(key);
    if (!p) return { ok: false, error: `Plugin not found: ${pluginId}` };
    return { ok: true, plugin: { ...p, metadata: { ...p.metadata }, capabilities: [...p.capabilities], tools: [...(p.tools||[])] } };
  }
  has(pluginId) { return this.plugins.has(String(pluginId).toLowerCase()); }
  isLoaded(pluginId) { return this.has(pluginId); }

  listPlugins(filter = {}) {
    let out = [...this.plugins.values()];
    if (filter.enabled !== undefined) out = out.filter(p => p.enabled === !!filter.enabled);
    if (filter.tier) out = out.filter(p => String(p.tier).toUpperCase() === String(filter.tier).toUpperCase());
    if (filter.capability) {
      const q = String(filter.capability).toLowerCase();
      out = out.filter(p => p.capabilities.some(c => String(c).toLowerCase().includes(q)));
    }
    if (filter.query) {
      const q = String(filter.query).toLowerCase();
      out = out.filter(p => p.metadata.id.toLowerCase().includes(q) || p.metadata.name.toLowerCase().includes(q) || p.capabilities.some(c => String(c).toLowerCase().includes(q)));
    }
    out.sort((a, b) => new Date(b.loadedAt) - new Date(a.loadedAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, plugins: out.map(p => ({ ...p })), total };
  }

  hasCapability(capability) {
    if (!capability) return false;
    const q = String(capability).toLowerCase();
    for (const p of this.plugins.values()) {
      if (!p.enabled) continue;
      for (const c of p.capabilities) if (String(c).toLowerCase() === q || String(c).toLowerCase().includes(q) || q.includes(String(c).toLowerCase())) return true;
    }
    return false;
  }

  listCapabilities() {
    const set = new Set();
    for (const p of this.plugins.values()) for (const c of p.capabilities) set.add(c);
    return { ok: true, capabilities: [...set].sort(), count: set.size };
  }

  // Auth check — delegates to credentials store if available
  async checkAuth(pluginId) {
    const res = this.getPlugin(pluginId);
    if (!res.ok) return res;
    const p = res.plugin;
    if (!p.auth || p.auth.required === false || String(p.auth.type).toLowerCase() === 'none') return { ok: true, requiresAuth: false, authenticated: true };
    // If credentials store available, check
    if (this.credentialsStore && typeof this.credentialsStore.has === 'function') {
      try {
        const has = await this.credentialsStore.has(pluginId);
        return { ok: true, requiresAuth: true, authenticated: !!has, type: p.auth.type };
      } catch {}
    }
    // Fallback: check env or assume not authenticated
    return { ok: true, requiresAuth: true, authenticated: false, type: p.auth.type, note: 'credentials not configured' };
  }

  getStats() {
    const all = [...this.plugins.values()];
    const enabled = all.filter(p => p.enabled);
    const byTier = {};
    for (const p of all) byTier[p.tier] = (byTier[p.tier] || 0) + 1;
    return {
      ok: true,
      total: all.length,
      enabled: enabled.length,
      disabled: all.length - enabled.length,
      byTier,
      capabilities: this.listCapabilities().capabilities,
      file: this.filePath,
      version: this.version,
    };
  }

  clear() {
    const count = this.plugins.size;
    // unregister all from registry
    if (this.registry) {
      for (const p of this.plugins.values()) {
        for (const t of (p.tools||[])) try { this.registry.unregister?.(t.name); } catch {}
        try { this.registry.unregister?.(p.metadata.id); } catch {}
      }
    }
    this.plugins.clear();
    this.save();
    return { ok: true, cleared: count };
  }
}

// Default singleton for app / orchestrator
export const pluginLoader = new PluginLoader();

export function getDefaultPluginsPathFn() { return getDefaultPluginsPath(); }

export default PluginLoader;
