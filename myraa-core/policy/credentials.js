// Myraa Secure Credential System — MASTER BUILD PROMPT §23, §53
// Dedicated secure credential system: OS credential stores, encrypted storage, env injection, short-lived tokens, scoped credentials.
// Never place raw secrets in chat history, memory, logs, task traces, analytics, source code §23.
// Local-first, provider-independent, least privilege, sandboxed.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Helpers: paths, key management
// ---------------------------------------------------------------------------
function getMyraaDataDir() {
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, 'myraa');
}
function getDefaultCredsPath() {
  return path.join(getMyraaDataDir(), 'credentials.enc.json');
}
function getDefaultKeyPath() {
  return path.join(getMyraaDataDir(), '.myraa_key');
}
function nowIso() { return new Date().toISOString(); }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function genId() { return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36); }

// Secret patterns to avoid ever persisting raw in logs
const SECRET_REDACT = '[REDACTED]';
function isSecretKey(key) {
  return /api[_-]?key|apikey|secret|password|passwd|pwd|token|credential|auth/i.test(String(key));
}
function redactForLog(value) {
  if (typeof value === 'string' && value.length > 0) return SECRET_REDACT;
  if (isSecretKey(value)) return SECRET_REDACT;
  return SECRET_REDACT;
}

// ---------------------------------------------------------------------------
// Encryption: AES-256-GCM with key persisted at %APPDATA%\myraa\.myraa_key
// Key file mode 600 where supported.
// ---------------------------------------------------------------------------
function getOrCreateKey(keyPath) {
  ensureDirForFile(keyPath);
  try {
    if (fs.existsSync(keyPath)) {
      const raw = fs.readFileSync(keyPath, 'utf8').trim();
      // support hex or base64
      let buf;
      if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
      else if (/^[A-Za-z0-9+/=]{40,}$/.test(raw)) buf = Buffer.from(raw, 'base64');
      else buf = Buffer.from(raw, 'utf8');
      if (buf.length === 32) return buf;
      if (buf.length > 32) return buf.slice(0, 32);
      if (buf.length < 32) {
        // pad via hash
        return crypto.createHash('sha256').update(buf).digest();
      }
    }
  } catch {}
  // generate new
  const newKey = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, newKey.toString('hex'), { mode: 0o600 });
    // try chmod explicitly
    try { fs.chmodSync(keyPath, 0o600); } catch {}
  } catch (e) {
    // fallback without mode
    try { fs.writeFileSync(keyPath, newKey.toString('hex'), 'utf8'); } catch {}
  }
  return newKey;
}

function encryptValue(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: enc.toString('base64'),
    tag: tag.toString('base64'),
  };
}
function decryptValue(encObj, key) {
  const iv = Buffer.from(encObj.iv, 'base64');
  const data = Buffer.from(encObj.data, 'base64');
  const tag = Buffer.from(encObj.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

// ---------------------------------------------------------------------------
// OS Credential Store abstraction — Windows Credential Manager, macOS Keychain, libsecret
// Attempts OS store where possible, gracefully falls back to encrypted file.
// ---------------------------------------------------------------------------
function tryOSSet(key, value, scope) {
  if (process.env.MYRAA_CREDENTIALS_OS === '0') return { ok: false, reason: 'OS store disabled via MYRAA_CREDENTIALS_OS=0' };
  // Windows: try cmdkey /generic
  if (process.platform === 'win32') {
    try {
      // cmdkey stores generic credentials: cmdkey /generic:Myraa:<key> /user:<key> /pass:<value>
      // Use powershell with SecureString for better handling? But cmdkey is simple and available.
      // Escape value for cmdkey — use base64 to avoid special chars? For now try direct but with redacted logging.
      const target = `Myraa:${scope ? scope + ':' : ''}${key}`;
      // We avoid logging raw value; use b64 via PowerShell to safely pass
      const b64Val = Buffer.from(String(value), 'utf8').toString('base64');
      // Use PowerShell to add via CredentialManager module if available, else cmdkey
      // Attempt cmdkey first (simpler, synchronous)
      const cmd = `cmdkey /generic:"${target.replace(/"/g, '')}" /user:"${key.replace(/"/g, '')}" /pass:"${String(value).replace(/"/g, '""')}"`;
      // For security, we use exec with timeout and hide window; but value may contain quotes — better use PowerShell SecureString method
      // Instead try PowerShell approach that decodes base64:
      const ps = `
        $t=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Val}'));
        $target=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(target, 'utf8').toString('base64')}'));
        $user=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(String(key), 'utf8').toString('base64')}'));
        cmd /c "cmdkey /generic:\`"$target\`" /user:\`"$user\`" /pass:\`"$t\`"" | Out-Null;
        if ($LASTEXITCODE -eq 0) { Write-Output "OK" } else { throw "cmdkey failed $LASTEXITCODE" }
      `;
      const out = execSync(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, { encoding: 'utf8', timeout: 4000, windowsHide: true });
      if (out.includes('OK')) return { ok: true, backend: 'windows-cmdkey' };
    } catch (e) {
      // fallback
      return { ok: false, reason: e.message, backend: 'windows-cmdkey' };
    }
  }
  // macOS: try security add-generic-password
  if (process.platform === 'darwin') {
    try {
      const service = `Myraa${scope ? ':' + scope : ''}`;
      execSync(`security add-generic-password -a "${String(key).replace(/"/g,'')}" -s "${service.replace(/"/g,'')}" -w "${String(value).replace(/"/g,'')}" -U`, { timeout: 3000 });
      return { ok: true, backend: 'macos-keychain' };
    } catch (e) {
      return { ok: false, reason: e.message, backend: 'macos-keychain' };
    }
  }
  // Linux: try secret-tool (libsecret)
  if (process.platform === 'linux') {
    try {
      const label = `Myraa ${scope ? scope + ':' : ''}${key}`;
      execSync(`secret-tool store --label="${label.replace(/"/g,'')}" service Myraa account "${String(key).replace(/"/g,'')}"`, { input: String(value), timeout: 3000 });
      return { ok: true, backend: 'libsecret' };
    } catch (e) {
      return { ok: false, reason: e.message, backend: 'libsecret' };
    }
  }
  return { ok: false, reason: 'No OS store available on this platform' };
}

function tryOSGet(key, scope) {
  if (process.env.MYRAA_CREDENTIALS_OS === '0') return { ok: false, reason: 'OS store disabled' };
  if (process.platform === 'win32') {
    try {
      const target = `Myraa:${scope ? scope + ':' : ''}${key}`;
      const ps = `
        $target=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(target, 'utf8').toString('base64')}'));
        $out = cmd /c "cmdkey /list:\`"$target\`"" 2>&1 | Out-String;
        if ($out -match "Target:") { Write-Output "EXISTS" } else { Write-Output "NOT_FOUND" }
      `;
      const out = execSync(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, { encoding: 'utf8', timeout: 3000, windowsHide: true });
      if (out.includes('EXISTS')) {
        // cmdkey does not allow retrieving password directly via cmdkey — need Credential Manager API via PowerShell
        // Try using [Windows.Security.Credentials.PasswordVault] or cmdkey unattainable
        // For now we consider OS get as not directly retrievable via cmdkey — fallback to file
        return { ok: false, reason: 'cmdkey list only, password vault retrievable via PowerShell vault (not implemented)', backend: 'windows-cmdkey' };
      }
      return { ok: false, reason: 'not found', backend: 'windows-cmdkey' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  if (process.platform === 'darwin') {
    try {
      const service = `Myraa${scope ? ':' + scope : ''}`;
      const out = execSync(`security find-generic-password -a "${String(key).replace(/"/g,'')}" -s "${service.replace(/"/g,'')}" -w`, { encoding: 'utf8', timeout: 3000 });
      const val = out.trim();
      if (val) return { ok: true, value: val, backend: 'macos-keychain' };
      return { ok: false, reason: 'not found' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  if (process.platform === 'linux') {
    try {
      const out = execSync(`secret-tool lookup service Myraa account "${String(key).replace(/"/g,'')}"`, { encoding: 'utf8', timeout: 3000 });
      const val = out.trim();
      if (val) return { ok: true, value: val, backend: 'libsecret' };
      return { ok: false, reason: 'not found' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  return { ok: false, reason: 'No OS store' };
}

function tryOSDelete(key, scope) {
  if (process.env.MYRAA_CREDENTIALS_OS === '0') return { ok: false, reason: 'disabled' };
  if (process.platform === 'win32') {
    try {
      const target = `Myraa:${scope ? scope + ':' : ''}${key}`;
      execSync(`cmdkey /delete:"${target.replace(/"/g,'')}"`, { timeout: 3000, windowsHide: true });
      return { ok: true, backend: 'windows-cmdkey' };
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  if (process.platform === 'darwin') {
    try {
      const service = `Myraa${scope ? ':' + scope : ''}`;
      execSync(`security delete-generic-password -a "${String(key).replace(/"/g,'')}" -s "${service.replace(/"/g,'')}"`, { timeout: 3000 });
      return { ok: true, backend: 'macos-keychain' };
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  if (process.platform === 'linux') {
    try {
      execSync(`secret-tool clear service Myraa account "${String(key).replace(/"/g,'')}"`, { timeout: 3000 });
      return { ok: true, backend: 'libsecret' };
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  return { ok: false, reason: 'No OS store' };
}

// ---------------------------------------------------------------------------
// CredentialStore — §23, §53
// ---------------------------------------------------------------------------
export class CredentialStore {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - encrypted storage path (default %APPDATA%\myraa\credentials.enc.json)
   * @param {string} opts.keyPath - key file path (default %APPDATA%\myraa\.myraa_key)
   * @param {object} opts.logger
   * @param {boolean} opts.useOSStore - try OS credential store where possible (default true)
   * @param {boolean} opts.autoLoad - load on construction (default true)
   */
  constructor({ filePath, keyPath, logger = console, useOSStore = true, autoLoad = true } = {}) {
    this.filePath = filePath || getDefaultCredsPath();
    this.keyPath = keyPath || getDefaultKeyPath();
    this.logger = logger;
    this.useOSStore = useOSStore !== false && process.env.MYRAA_CREDENTIALS_OS !== '0';
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    /** @type {Map<string, object>} store: compositeKey -> { id, key, scope, encrypted, metadata, createdAt, expiresAt } */
    this._store = new Map();
    this._key = getOrCreateKey(this.keyPath);

    if (autoLoad) this.load();
  }

  _compositeKey(key, scope) {
    const s = scope ? String(scope).trim() : '';
    const k = String(key).trim();
    if (s) return `${s}:${k}`;
    return k;
  }

  _parseComposite(composite) {
    const idx = composite.lastIndexOf(':');
    // heuristic: if scope contains colon, we use first colon? But composite is scope:key, scope may contain colons? Use last colon as separator
    // For our usage scope is simple like "github" "openai", so last colon is fine
    // If no scope, composite == key
    // To disambiguate, we store scope separately, so we can split by checking map
    return composite;
  }

  // ------------------------- persistence -------------------------
  _getPersistPayload() {
    const entries = {};
    for (const [composite, entry] of this._store.entries()) {
      entries[composite] = {
        id: entry.id,
        key: entry.key,
        scope: entry.scope || null,
        encrypted: entry.encrypted, // { iv, data, tag }
        metadata: entry.metadata || {},
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt || null,
        backend: entry.backend || 'file',
        account: entry.account || null,
      };
    }
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: nowIso(),
      entries,
    };
  }

  save() {
    try {
      ensureDirForFile(this.filePath);
      const payload = this._getPersistPayload();
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      try { fs.chmodSync(tmp, 0o600); } catch {}
      fs.renameSync(tmp, this.filePath);
      try { fs.chmodSync(this.filePath, 0o600); } catch {}
      this.updatedAt = payload.updatedAt;
      return { ok: true, path: this.filePath, count: this._store.size };
    } catch (e) {
      this.logger.warn?.(`[CredentialStore] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this._store.size };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[CredentialStore] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    const entries = data.entries || {};
    this._store.clear();
    // handle both map object and array
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      for (const [composite, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== 'object' || !entry.encrypted) continue;
        // skip expired? keep but will be filtered on get
        this._store.set(composite, {
          id: entry.id || genId(),
          key: entry.key || composite,
          scope: entry.scope || null,
          encrypted: entry.encrypted,
          metadata: entry.metadata || {},
          createdAt: entry.createdAt || nowIso(),
          updatedAt: entry.updatedAt || null,
          expiresAt: entry.expiresAt || null,
          backend: entry.backend || 'file',
          account: entry.account || null,
        });
      }
    } else if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!entry || !entry.encrypted) continue;
        const composite = this._compositeKey(entry.key, entry.scope);
        this._store.set(composite, {
          id: entry.id || genId(),
          key: entry.key,
          scope: entry.scope || null,
          encrypted: entry.encrypted,
          metadata: entry.metadata || {},
          createdAt: entry.createdAt || nowIso(),
          updatedAt: entry.updatedAt || null,
          expiresAt: entry.expiresAt || null,
          backend: entry.backend || 'file',
          account: entry.account || null,
        });
      }
    }
    // purge expired on load
    this.clearExpired({ save: false });
  }

  // ------------------------- expiry helpers -------------------------
  _isExpired(entry) {
    if (!entry.expiresAt) return false;
    const exp = new Date(entry.expiresAt).getTime();
    return Date.now() > exp;
  }

  clearExpired({ save = true } = {}) {
    let cleared = 0;
    for (const [composite, entry] of [...this._store.entries()]) {
      if (this._isExpired(entry)) {
        this._store.delete(composite);
        cleared++;
        // also try OS delete for completeness
        if (this.useOSStore) tryOSDelete(entry.key, entry.scope);
      }
    }
    if (cleared > 0 && save) this.save();
    return { ok: true, cleared };
  }

  // ------------------------- core CRUD — secure, scoped, short-lived -------------------------
  /**
   * Store a credential securely. Never logs raw value.
   * @param {string} key - credential key (e.g., "github_token", "openai_api_key")
   * @param {string} value - raw secret (will be encrypted)
   * @param {object} opts - { scope, expiresInMs, ttl, expiresAt, account, metadata }
   */
  set(key, value, opts = {}) {
    if (!key || typeof key !== 'string' || !key.trim()) return { ok: false, error: 'key is required' };
    if (value === undefined || value === null || String(value).trim() === '') return { ok: false, error: 'value is required' };
    const k = String(key).trim();
    const scope = opts.scope ? String(opts.scope).trim() : null;
    const account = opts.account ? String(opts.account).trim() : null;
    const composite = this._compositeKey(k, scope);

    // Determine expiry for short-lived tokens §23
    let expiresAt = null;
    if (opts.expiresAt) {
      expiresAt = new Date(opts.expiresAt).toISOString();
    } else if (opts.expiresInMs !== undefined && opts.expiresInMs !== null) {
      const ms = Number(opts.expiresInMs);
      if (!Number.isNaN(ms) && ms > 0) expiresAt = new Date(Date.now() + ms).toISOString();
    } else if (opts.ttl !== undefined && opts.ttl !== null) {
      const ms = Number(opts.ttl);
      if (!Number.isNaN(ms) && ms > 0) expiresAt = new Date(Date.now() + ms).toISOString();
    } else if (opts.expiresIn !== undefined) {
      const ms = Number(opts.expiresIn);
      if (!Number.isNaN(ms) && ms > 0) expiresAt = new Date(Date.now() + ms).toISOString();
    }

    // Encrypt
    const encrypted = encryptValue(String(value), this._key);

    // Try OS store where possible §23 "Where possible use OS credential stores"
    let osResult = { ok: false };
    if (this.useOSStore) {
      try { osResult = tryOSSet(k, String(value), scope); } catch (e) { osResult = { ok: false, reason: e.message }; }
    }

    const entry = {
      id: this._store.get(composite)?.id || genId(),
      key: k,
      scope,
      encrypted,
      metadata: opts.metadata && typeof opts.metadata === 'object' ? { ...opts.metadata } : {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt,
      backend: osResult.ok ? osResult.backend : 'file',
      account,
    };
    this._store.set(composite, entry);
    this.save();

    // Do NOT log raw value — only metadata
    this.logger.info?.(`[CredentialStore] set credential key=${k} scope=${scope || 'default'} expiresAt=${expiresAt || 'never'} backend=${entry.backend} osStore=${osResult.ok ? 'yes' : 'no'}`);

    return {
      ok: true,
      key: k,
      scope,
      composite,
      expiresAt,
      backend: entry.backend,
      osStore: !!osResult.ok,
      id: entry.id,
    };
  }

  /**
   * Retrieve a credential. Returns decrypted value, checks expiry, never logs raw.
   * @param {string} key
   * @param {object} opts - { scope, account }
   */
  get(key, opts = {}) {
    if (!key || typeof key !== 'string' || !key.trim()) return { ok: false, error: 'key is required' };
    const k = String(key).trim();
    const scope = opts.scope ? String(opts.scope).trim() : null;
    const composite = this._compositeKey(k, scope);
    let entry = this._store.get(composite);

    // Fallback: try without scope if not found with scope, or try to find any entry with same key irrespective of scope?
    if (!entry && scope) {
      // try find by key alone
      const altComposite = this._compositeKey(k, null);
      entry = this._store.get(altComposite);
    }
    if (!entry) {
      // also try OS store retrieval if enabled and not in file
      if (this.useOSStore) {
        const osRes = tryOSGet(k, scope);
        if (osRes.ok && osRes.value) {
          return { ok: true, key: k, scope, value: osRes.value, backend: osRes.backend, fromOS: true };
        }
      }
      return { ok: false, error: `Credential not found: ${scope ? scope + ':' : ''}${k}` };
    }

    // Check expiry
    if (this._isExpired(entry)) {
      this._store.delete(composite);
      this.save();
      if (this.useOSStore) tryOSDelete(k, scope);
      return { ok: false, error: `Credential expired: ${composite}`, expired: true };
    }

    // Try OS store first if useOSStore and backend was OS? For file backend we decrypt
    if (entry.backend !== 'file' && this.useOSStore) {
      const osRes = tryOSGet(k, scope);
      if (osRes.ok && osRes.value) {
        return { ok: true, key: k, scope, value: osRes.value, backend: osRes.backend, fromOS: true, expiresAt: entry.expiresAt };
      }
      // fall through to file decrypt
    }

    try {
      const plain = decryptValue(entry.encrypted, this._key);
      return {
        ok: true,
        key: k,
        scope,
        value: plain,
        composite,
        backend: entry.backend,
        expiresAt: entry.expiresAt,
        createdAt: entry.createdAt,
        metadata: entry.metadata ? { ...entry.metadata } : {},
        account: entry.account || null,
      };
    } catch (e) {
      return { ok: false, error: `Decryption failed for ${composite}: ${e.message}` };
    }
  }

  /**
   * Get metadata without value — for listing scoped credentials.
   */
  getMetadata(key, opts = {}) {
    if (!key) return { ok: false, error: 'key required' };
    const k = String(key).trim();
    const scope = opts.scope ? String(opts.scope).trim() : null;
    const composite = this._compositeKey(k, scope);
    const entry = this._store.get(composite);
    if (!entry) return { ok: false, error: `Not found: ${composite}` };
    if (this._isExpired(entry)) return { ok: false, error: 'expired', expired: true };
    return {
      ok: true,
      key: k,
      scope,
      composite,
      metadata: entry.metadata ? { ...entry.metadata } : {},
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      backend: entry.backend,
      account: entry.account || null,
      hasValue: true,
      // never include value
    };
  }

  has(key, opts = {}) {
    const res = this.getMetadata(key, opts);
    return res.ok;
  }

  delete(key, opts = {}) {
    if (!key) return { ok: false, error: 'key required' };
    const k = String(key).trim();
    const scope = opts.scope ? String(opts.scope).trim() : null;
    const composite = this._compositeKey(k, scope);
    let existed = this._store.has(composite);
    let entry = this._store.get(composite);
    // if not found with scope, try without
    let targetComposite = composite;
    if (!existed && scope) {
      const alt = this._compositeKey(k, null);
      if (this._store.has(alt)) { existed = true; entry = this._store.get(alt); targetComposite = alt; }
    }
    if (!existed) {
      // still try OS delete
      if (this.useOSStore) tryOSDelete(k, scope);
      return { ok: false, error: `Not found: ${composite}` };
    }
    this._store.delete(targetComposite);
    this.save();
    if (this.useOSStore) tryOSDelete(entry.key, entry.scope);
    return { ok: true, deleted: k, scope: entry.scope, composite: targetComposite };
  }

  // Alias per spec
  remove(key, opts) { return this.delete(key, opts); }

  list(filter = {}) {
    // filter = { scope, account }
    const scopeFilter = filter.scope ? String(filter.scope).trim() : null;
    const accountFilter = filter.account ? String(filter.account).trim() : null;
    const out = [];
    for (const [composite, entry] of this._store.entries()) {
      if (this._isExpired(entry)) continue;
      if (scopeFilter && String(entry.scope || '') !== scopeFilter) continue;
      if (accountFilter && String(entry.account || '') !== accountFilter) continue;
      out.push({
        key: entry.key,
        scope: entry.scope || null,
        composite,
        metadata: entry.metadata ? { ...entry.metadata } : {},
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
        backend: entry.backend,
        account: entry.account || null,
        // never include value
      });
    }
    out.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { ok: true, results: out, count: out.length, total: out.length };
  }

  listScopes() {
    const scopes = new Set();
    for (const entry of this._store.values()) {
      if (this._isExpired(entry)) continue;
      scopes.add(entry.scope || 'default');
    }
    return { ok: true, scopes: [...scopes] };
  }

  getScoped(scope) {
    if (!scope) return { ok: false, error: 'scope required' };
    return this.list({ scope });
  }

  // ------------------------- env-based secret injection §23 -------------------------
  /**
   * Inject credentials into process.env without logging raw values.
   * Maps credential keys to ENV vars: e.g., key "openai_api_key" scope "openai" -> OPENAI_API_KEY
   * @param {object} opts - { prefix, scope, keys, override=false }
   */
  injectEnv(opts = {}) {
    const prefix = opts.prefix ? String(opts.prefix).trim().toUpperCase() : '';
    const scopeFilter = opts.scope ? String(opts.scope).trim() : null;
    const keysFilter = Array.isArray(opts.keys) ? opts.keys.map(k => String(k).trim()) : null;
    const override = !!opts.override;
    let injected = 0;
    const injectedKeys = [];
    for (const [composite, entry] of this._store.entries()) {
      if (this._isExpired(entry)) continue;
      if (scopeFilter && String(entry.scope || '') !== scopeFilter) continue;
      if (keysFilter && !keysFilter.includes(entry.key)) continue;

      // Derive env name: scope_key or key alone, uppercased, non-alphanum -> _
      let envName;
      if (opts.envMap && typeof opts.envMap === 'object' && opts.envMap[composite]) {
        envName = String(opts.envMap[composite]);
      } else if (opts.envMap && opts.envMap[entry.key]) {
        envName = String(opts.envMap[entry.key]);
      } else {
        const base = entry.scope ? `${entry.scope}_${entry.key}` : entry.key;
        envName = base.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (prefix) envName = `${prefix}_${envName}`;
        // normalize double underscores
        envName = envName.replace(/__+/g, '_');
      }

      if (!override && process.env[envName]) continue;

      const getRes = this.get(entry.key, { scope: entry.scope });
      if (!getRes.ok) continue;
      process.env[envName] = getRes.value;
      injected++;
      injectedKeys.push(envName);
      // never log raw value
    }
    return { ok: true, injected, keys: injectedKeys };
  }

  // ------------------------- short-lived tokens helpers -------------------------
  /**
   * Create a short-lived token — scoped, expiring credential.
   * @param {string} scope
   * @param {string} tokenValue
   * @param {object} opts - { ttlMs, expiresInMs, key, account }
   */
  createShortLivedToken(scope, tokenValue, opts = {}) {
    if (!scope) return { ok: false, error: 'scope required' };
    if (!tokenValue) return { ok: false, error: 'tokenValue required' };
    const key = opts.key || `token_${genId()}`;
    const ttl = opts.ttlMs ?? opts.expiresInMs ?? opts.ttl ?? 3600000; // default 1h
    return this.set(key, tokenValue, { scope, expiresInMs: Number(ttl), account: opts.account, metadata: { shortLived: true, ...opts.metadata } });
  }

  // ------------------------- maintenance -------------------------
  clear(scope = null) {
    if (scope) {
      const s = String(scope).trim();
      let cleared = 0;
      const toDelete = [];
      for (const [composite, entry] of this._store.entries()) {
        if (String(entry.scope || '') === s) toDelete.push(composite);
      }
      for (const c of toDelete) {
        const e = this._store.get(c);
        this._store.delete(c);
        if (this.useOSStore) tryOSDelete(e.key, e.scope);
        cleared++;
      }
      if (cleared) this.save();
      return { ok: true, cleared, scope: s };
    }
    const count = this._store.size;
    // also try OS delete for all
    if (this.useOSStore) {
      for (const e of this._store.values()) tryOSDelete(e.key, e.scope);
    }
    this._store.clear();
    this.save();
    return { ok: true, cleared: count };
  }

  clearAll() { return this.clear(null); }

  rotate(key, newValue, opts = {}) {
    if (!key) return { ok: false, error: 'key required' };
    const k = String(key).trim();
    const scope = opts.scope ? String(opts.scope).trim() : null;
    const composite = this._compositeKey(k, scope);
    const existing = this._store.get(composite);
    if (!existing) return { ok: false, error: `Not found for rotation: ${composite}` };
    const mergedOpts = {
      scope: existing.scope,
      account: opts.account || existing.account,
      metadata: { ...existing.metadata, ...opts.metadata, rotatedAt: nowIso() },
      expiresInMs: opts.expiresInMs ?? (existing.expiresAt ? new Date(existing.expiresAt).getTime() - Date.now() : undefined),
    };
    return this.set(k, newValue, mergedOpts);
  }

  getStats() {
    let expired = 0;
    let valid = 0;
    const byScope = {};
    const byBackend = {};
    for (const e of this._store.values()) {
      if (this._isExpired(e)) expired++;
      else valid++;
      const s = e.scope || 'default';
      byScope[s] = (byScope[s] || 0) + 1;
      byBackend[e.backend] = (byBackend[e.backend] || 0) + 1;
    }
    return {
      ok: true,
      total: this._store.size,
      valid,
      expired,
      byScope,
      byBackend,
      file: this.filePath,
      keyPath: this.keyPath,
      useOSStore: this.useOSStore,
      version: this.version,
    };
  }

  exportMetadata() {
    const payload = this._getPersistPayload();
    // strip encrypted data values, keep only metadata
    const metaOnly = {};
    for (const [composite, entry] of Object.entries(payload.entries)) {
      metaOnly[composite] = {
        key: entry.key,
        scope: entry.scope,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
        backend: entry.backend,
        account: entry.account,
        // encrypted omitted
      };
    }
    return { version: payload.version, createdAt: payload.createdAt, updatedAt: payload.updatedAt, entries: metaOnly };
  }

  // Verify no secrets in logs/memory etc — helper for tests
  verifyEncrypted() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      // Check file does not contain raw test secrets like "sk-..." unless redacted? It should contain only encrypted base64, not raw
      const containsRawSk = /sk-[a-zA-Z0-9]{20,}/.test(raw) && !raw.includes('[REDACTED]');
      // Encrypted file will contain base64 blobs, but not raw plaintext if encryption works
      // We check that raw known secret we set (if we know one) is not present — caller should test with known secret
      return { ok: !containsRawSk, containsRawSk, file: this.filePath, size: raw.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

// Default singleton for app / orchestrator
// Use disabled OS store for tests if env says? But default tries OS.
export const credentialStore = new CredentialStore();

export function getDefaultCredsPathFn() { return getDefaultCredsPath(); }
export function getDefaultKeyPathFn() { return getDefaultKeyPath(); }

export default CredentialStore;
