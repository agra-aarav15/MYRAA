// Myraa Device Network & Intelligent Selection — MASTER BUILD PROMPT §26-29
// Implements: Device Network as one ecosystem (Windows PC, Android, laptop, server) §26,
// Intelligent Device Selection (heavy build -> PC, quick -> phone, 24/7 -> server, GPU -> GPU device) §27,
// Android Companion remote, Cross-Device Task Continuity (continue build on PC) §28-29.
// Local-first (§25), event-driven (§50), persistent (§52), policy-aware (§34-35), audit (§38).
// UI frozen — no dist/assets/black-glassmorphism.css changes.

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
function getDefaultDevicesPath() {
  return path.join(getMyraaDataDir(), 'devices.json');
}
function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'dev') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function ensureDirForFile(filePath) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch {}
}
function normalizeType(t) { return String(t || '').trim().toLowerCase().replace(/\s+/g, '_'); }

// ---------------------------------------------------------------------------
// Device Types — §26 ecosystem: Windows PC, Android, Laptop, Server
// ---------------------------------------------------------------------------
export const DeviceType = Object.freeze({
  WINDOWS_PC: 'windows_pc',
  ANDROID: 'android',
  LAPTOP: 'laptop',
  SERVER: 'server',
  // aliases / generic for compatibility
  PC: 'windows_pc',
  PHONE: 'android',
});
export const ALL_DEVICE_TYPES = Object.freeze([...new Set(Object.values(DeviceType))]);
export const TYPE_ALIASES = Object.freeze({
  windows: 'windows_pc',
  win: 'windows_pc',
  pc: 'windows_pc',
  desktop: 'windows_pc',
  android: 'android',
  phone: 'android',
  mobile: 'android',
  laptop: 'laptop',
  macbook: 'laptop',
  notebook: 'laptop',
  server: 'server',
  cloud: 'server',
});

// Resolve alias to canonical
export function resolveDeviceType(raw) {
  const n = normalizeType(raw);
  if (TYPE_ALIASES[n]) return TYPE_ALIASES[n];
  if (ALL_DEVICE_TYPES.includes(n)) return n;
  // try to match substring
  for (const [alias, canonical] of Object.entries(TYPE_ALIASES)) {
    if (n.includes(alias)) return canonical;
  }
  return n || 'windows_pc';
}

export const DeviceStatus = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  IDLE: 'idle',
  BUSY: 'busy',
  UNKNOWN: 'unknown',
});

// Default capabilities per type — §26 "Capabilities of each device"
function defaultCapabilitiesFor(type) {
  const t = resolveDeviceType(type);
  if (t === DeviceType.SERVER) return { cpuCores: 8, ramGB: 32, gpu: false, storageGB: 500, network: 'ethernet', battery: false, platform: 'linux', arch: 'x64', supports: ['build', 'service', '24/7', 'long-running'] };
  if (t === DeviceType.WINDOWS_PC) return { cpuCores: 8, ramGB: 16, gpu: true, storageGB: 512, network: 'wifi', battery: false, platform: 'win32', arch: 'x64', supports: ['build', 'heavy', 'gpu', 'compile', 'apk'] };
  if (t === DeviceType.LAPTOP) return { cpuCores: 6, ramGB: 16, gpu: false, storageGB: 512, network: 'wifi', battery: true, platform: os.platform(), arch: os.arch(), supports: ['build', 'portable'] };
  if (t === DeviceType.ANDROID) return { cpuCores: 4, ramGB: 6, gpu: false, storageGB: 128, network: 'mobile', battery: true, platform: 'android', arch: 'arm64', supports: ['quick', 'mobile', 'voice', 'notification'] };
  return { cpuCores: 4, ramGB: 8, gpu: false, storageGB: 256, network: 'unknown', battery: false, platform: os.platform(), arch: os.arch(), supports: [] };
}

// Infer task hints from mission string/object — §27 examples
function inferHints(input) {
  let mission = '';
  let hint = { heavy: false, quick: false, gpu: false, service: false, build: false, type: 'general' };
  if (typeof input === 'string') mission = input;
  else if (input && typeof input === 'object') {
    mission = String(input.mission || input.task || input.query || input.text || '');
    if (input.heavy) hint.heavy = true;
    if (input.gpu || input.requiresGPU) hint.gpu = true;
    if (input.quick) hint.quick = true;
    if (input.service || input['24/7'] || input.service247) hint.service = true;
    if (input.type) hint.type = String(input.type);
  }
  const lower = mission.toLowerCase();
  if (/heavy|large build|apk|compile|build.*project|gradle|aapt2|webpack|vite build|docker build|intensive|cpu heavy|ram heavy/.test(lower)) { hint.heavy = true; hint.build = true; }
  if (/gpu|cuda|render|llava|vision|stable diffusion|training|inference.*gpu/.test(lower)) hint.gpu = true;
  if (/quick|fast|short|notification|send.*message|open.*app|quick action|phone.*task/.test(lower)) hint.quick = true;
  if (/24\/7|24x7|always on|daemon|server|service.*continuous|uptime|deploy.*server|hosting/.test(lower)) hint.service = true;
  if (/build|make.*game|snake.*ladder|compile/.test(lower)) hint.build = true;
  // explicit categories
  if (hint.service) hint.type = 'service';
  else if (hint.gpu) hint.type = 'gpu';
  else if (hint.heavy || hint.build) hint.type = 'heavy';
  else if (hint.quick) hint.type = 'quick';
  return { mission, hint, lower };
}

// ---------------------------------------------------------------------------
// DeviceManager — §26-29
// ---------------------------------------------------------------------------
export class DeviceManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.filePath - persistence path (default %APPDATA%\myraa\devices.json)
   * @param {object} opts.eventBus - optional external EventEmitter (myraa-core/eventBus)
   * @param {object} opts.policyEngine - optional policy engine (§34)
   * @param {object} opts.auditLogger - optional audit logger (§38)
   * @param {object} opts.monitor - optional SystemMonitor (§44) for resource awareness
   * @param {object} opts.logger
   * @param {boolean} opts.autoLoad - load from disk on construction (default true)
   * @param {number} opts.offlineTimeoutMs - offline if no heartbeat > this (default 60000)
   */
  constructor({ filePath, eventBus = null, policyEngine = null, auditLogger = null, monitor = null, logger = console, autoLoad = true, offlineTimeoutMs = 60000 } = {}) {
    super();
    this.filePath = filePath || getDefaultDevicesPath();
    this.eventBus = eventBus;
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;
    this.monitor = monitor;
    this.logger = logger;
    this.offlineTimeoutMs = offlineTimeoutMs;
    this.version = 1;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    // id -> device record
    this.devices = new Map();
    // taskId -> { task, fromDevice, toDevice, status, ts }
    this.transfers = new Map();
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(()=>{}); } catch {}
    // manual override history
    this.selectionHistory = [];
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
      devices: [...this.devices.values()],
      transfers: [...this.transfers.values()],
      selectionHistory: this.selectionHistory.slice(-100),
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
      return { ok: true, path: this.filePath, count: this.devices.size };
    } catch (e) {
      this.logger.warn?.(`[DeviceManager] save failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        this._hydrate(data);
        return { ok: true, path: this.filePath, count: this.devices.size };
      }
      return { ok: true, empty: true, path: this.filePath };
    } catch (e) {
      this.logger.warn?.(`[DeviceManager] load failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
  _hydrate(data) {
    if (!data || typeof data !== 'object') return;
    this.version = data.version || 1;
    this.createdAt = data.createdAt || this.createdAt;
    this.updatedAt = data.updatedAt || nowIso();
    const list = Array.isArray(data.devices) ? data.devices : (Array.isArray(data) ? data : []);
    this.devices.clear();
    for (const d of list) {
      if (!d || !d.id) continue;
      const rec = this._normalizeDevice(d);
      this.devices.set(rec.id, rec);
    }
    if (Array.isArray(data.transfers)) {
      this.transfers.clear();
      for (const t of data.transfers) if (t && t.taskId) this.transfers.set(String(t.taskId), t);
    }
    if (Array.isArray(data.selectionHistory)) this.selectionHistory = data.selectionHistory.slice(-100);
  }
  _normalizeDevice(raw) {
    const id = String(raw.id || genId('dev'));
    const type = resolveDeviceType(raw.type || raw.deviceType || 'windows_pc');
    const name = String(raw.name || `${type}-${id.slice(0,5)}`);
    const now = nowIso();
    const caps = { ...defaultCapabilitiesFor(type), ...(raw.capabilities || raw.caps || {}) };
    // ensure supports is array
    if (typeof caps.supports === 'string') caps.supports = [caps.supports];
    if (!Array.isArray(caps.supports)) caps.supports = defaultCapabilitiesFor(type).supports;
    const resources = {
      online: raw.resources?.online ?? raw.online ?? true,
      status: raw.resources?.status || raw.status || DeviceStatus.ONLINE,
      lastSeen: raw.resources?.lastSeen || raw.lastSeen || now,
      cpuUsage: raw.resources?.cpuUsage ?? raw.cpuUsage ?? null,
      memUsage: raw.resources?.memUsage ?? raw.memUsage ?? null,
      memUsedPercent: raw.resources?.memUsedPercent ?? null,
      battery: raw.resources?.battery ?? raw.battery ?? null,
      charging: raw.resources?.charging ?? null,
      storageFreeGB: raw.resources?.storageFreeGB ?? null,
      uptimeSec: raw.resources?.uptimeSec ?? null,
      loadAvg: raw.resources?.loadAvg ?? null,
      ...raw.resources,
    };
    // normalize online/status
    if (resources.online === true && !resources.status) resources.status = DeviceStatus.ONLINE;
    if (resources.online === false) resources.status = DeviceStatus.OFFLINE;
    if (!resources.lastSeen) resources.lastSeen = now;
    return {
      id,
      name,
      type,
      displayName: raw.displayName || name,
      platform: raw.platform || caps.platform || os.platform(),
      capabilities: caps,
      resources,
      status: resources.status,
      online: !!resources.online,
      tasks: Array.isArray(raw.tasks) ? [...raw.tasks] : [],
      currentTasks: Array.isArray(raw.currentTasks) ? [...raw.currentTasks] : (Array.isArray(raw.tasks) ? [...raw.tasks] : []),
      metadata: raw.metadata || {},
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
      lastHeartbeat: raw.lastHeartbeat || resources.lastSeen,
    };
  }

  // ------------------------- CRUD — §26 Which devices exist -------------------------
  /**
   * Register or upsert a device. Idempotent by id or name+type.
   * @param {object} spec - { id?, name, type, capabilities, resources, metadata }
   */
  registerDevice(spec = {}) {
    if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec object required' };
    // allow spec with only type/name
    const type = resolveDeviceType(spec.type || spec.deviceType || 'windows_pc');
    if (!ALL_DEVICE_TYPES.includes(type) && !Object.values(DeviceType).includes(type)) {
      // still allow custom but warn; normalize to type
    }
    // check duplicate by id
    let id = spec.id ? String(spec.id) : null;
    if (id && this.devices.has(id)) {
      // update existing
      return this.updateDevice(id, spec);
    }
    // check duplicate by name+type
    if (!id && spec.name) {
      for (const d of this.devices.values()) {
        if (d.name === spec.name && d.type === type) {
          return this.updateDevice(d.id, spec);
        }
      }
    }
    const rec = this._normalizeDevice({ ...spec, type, id: id || undefined });
    this.devices.set(rec.id, rec);
    this.save();
    this._emit('device:registered', { deviceId: rec.id, device: { ...rec }, type: rec.type });
    this._emit('device:changed', { deviceId: rec.id, change: 'registered', device: { ...rec } });
    this._audit({ agent: 'DeviceManager', task: null, tool: 'registerDevice', action: 'registerDevice', result: `Registered ${rec.type} ${rec.id}`, device: rec.id });
    return { ok: true, device: { ...rec }, deviceId: rec.id };
  }

  updateDevice(id, patch = {}) {
    const key = String(id);
    const existing = this.devices.get(key);
    if (!existing) return { ok: false, error: `Device not found: ${id}` };
    const merged = { ...existing };
    if (patch.name) merged.name = String(patch.name);
    if (patch.type || patch.deviceType) merged.type = resolveDeviceType(patch.type || patch.deviceType);
    if (patch.displayName) merged.displayName = String(patch.displayName);
    if (patch.capabilities || patch.caps) merged.capabilities = { ...merged.capabilities, ...(patch.capabilities || patch.caps) };
    if (patch.resources) merged.resources = { ...merged.resources, ...patch.resources, lastSeen: nowIso() };
    if (patch.online !== undefined) { merged.online = !!patch.online; merged.resources.online = !!patch.online; merged.status = patch.online ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE; }
    if (patch.status) { merged.status = String(patch.status); merged.resources.status = String(patch.status); merged.online = merged.status === DeviceStatus.ONLINE || merged.status === DeviceStatus.IDLE || merged.status === DeviceStatus.BUSY; merged.resources.online = merged.online; }
    if (patch.metadata) merged.metadata = { ...merged.metadata, ...patch.metadata };
    if (patch.tasks) merged.tasks = Array.isArray(patch.tasks) ? [...patch.tasks] : merged.tasks;
    if (Array.isArray(patch.currentTasks)) merged.currentTasks = [...patch.currentTasks];
    merged.updatedAt = nowIso();
    merged.lastHeartbeat = merged.resources.lastSeen || nowIso();
    // re-normalize type if changed
    if (patch.type) merged.capabilities = { ...defaultCapabilitiesFor(merged.type), ...merged.capabilities };
    this.devices.set(key, merged);
    this.save();
    this._emit('device:changed', { deviceId: key, change: 'updated', device: { ...merged }, patch: { ...patch } });
    return { ok: true, device: { ...merged } };
  }

  removeDevice(id) {
    const key = String(id);
    const existed = this.devices.get(key);
    if (!existed) return { ok: false, error: `Device not found: ${id}` };
    this.devices.delete(key);
    this.save();
    this._emit('device:removed', { deviceId: key, device: { ...existed } });
    this._emit('device:changed', { deviceId: key, change: 'removed' });
    return { ok: true, removed: { ...existed } };
  }

  getDevice(id) {
    if (!id) return { ok: false, error: 'id required' };
    const d = this.devices.get(String(id));
    if (!d) {
      // also try lookup by name
      for (const dev of this.devices.values()) if (dev.name === String(id)) return { ok: true, device: { ...dev } };
      return { ok: false, error: `Device not found: ${id}` };
    }
    return { ok: true, device: { ...d, capabilities: { ...d.capabilities }, resources: { ...d.resources } } };
  }

  listDevices(filter = {}) {
    let out = [...this.devices.values()];
    if (filter.type) {
      const t = resolveDeviceType(filter.type);
      out = out.filter(d => d.type === t);
    }
    if (filter.online !== undefined) out = out.filter(d => d.online === !!filter.online);
    if (filter.status) out = out.filter(d => d.status === String(filter.status));
    if (filter.gpu) out = out.filter(d => !!d.capabilities.gpu === !!filter.gpu);
    if (filter.query) {
      const q = String(filter.query).toLowerCase();
      out = out.filter(d => d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
    }
    out.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const total = out.length;
    if (filter.limit) out = out.slice(0, Number(filter.limit));
    return { ok: true, devices: out.map(d => ({ ...d })), total };
  }

  // ------------------------- §26 awareness -------------------------
  getOnlineDevices() {
    const online = [...this.devices.values()].filter(d => this.isOnline(d.id).online);
    return { ok: true, devices: online.map(d => ({ ...d })), count: online.length };
  }
  isOnline(id) {
    const d = this.devices.get(String(id));
    if (!d) return { ok: false, error: `Device not found: ${id}`, online: false };
    // check heartbeat timeout
    const last = d.lastHeartbeat || d.resources.lastSeen || d.updatedAt;
    const ageMs = Date.now() - new Date(last).getTime();
    const onlineByHeartbeat = ageMs < this.offlineTimeoutMs;
    // if explicitly offline, respect it; otherwise use heartbeat
    const online = d.online && onlineByHeartbeat;
    return { ok: true, online, ageMs, lastSeen: last, status: online ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE, deviceId: d.id };
  }

  getCapabilities(deviceId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    return { ok: true, deviceId: res.device.id, capabilities: { ...res.device.capabilities }, type: res.device.type };
  }

  getResourceAvailability(deviceId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    const d = res.device;
    // try to enrich via monitor if this device is local (pc/laptop)
    let liveResources = { ...d.resources };
    if (this.monitor && (d.type === DeviceType.WINDOWS_PC || d.type === DeviceType.LAPTOP) && d.online) {
      try {
        const mem = this.monitor.getMemoryUsage?.();
        const cpu = this.monitor.getCpuUsage?.();
        if (mem) { liveResources.memUsedPercent = mem.usedPercent; liveResources.memFreeGB = mem.freeGB; liveResources.memTotalGB = mem.totalGB; }
        if (cpu) liveResources.cpuUsage = cpu.usagePercent;
        if (this.monitor.getBatteryInfo) {
          const bat = this.monitor.getBatteryInfo();
          liveResources.battery = bat.level;
          liveResources.charging = bat.charging;
        }
      } catch {}
    }
    return { ok: true, deviceId: d.id, resources: liveResources, online: this.isOnline(d.id).online, lastSeen: d.resources.lastSeen };
  }

  getTaskState(deviceId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    return { ok: true, deviceId: res.device.id, tasks: [...(res.device.tasks || [])], currentTasks: [...(res.device.currentTasks || [])], status: res.device.status, online: res.device.online };
  }

  heartbeat(deviceId, resources = {}) {
    const d = this.devices.get(String(deviceId));
    if (!d) return { ok: false, error: `Device not found: ${deviceId}` };
    const now = nowIso();
    d.lastHeartbeat = now;
    d.resources.lastSeen = now;
    d.resources.online = true;
    d.online = true;
    d.status = DeviceStatus.ONLINE;
    if (resources && typeof resources === 'object') {
      d.resources = { ...d.resources, ...resources, lastSeen: now, online: true };
      if (resources.cpuUsage !== undefined) d.resources.cpuUsage = resources.cpuUsage;
      if (resources.battery !== undefined) d.resources.battery = resources.battery;
    }
    d.updatedAt = now;
    this.save();
    this._emit('device:heartbeat', { deviceId: d.id, resources: { ...d.resources } });
    return { ok: true, deviceId: d.id, lastSeen: now };
  }

  setOnline(deviceId, online) {
    return this.updateDevice(deviceId, { online: !!online });
  }

  // Ecosystem view — §26 diagram
  getEcosystem() {
    const all = [...this.devices.values()];
    const online = all.filter(d => this.isOnline(d.id).online);
    const byType = {};
    for (const t of ALL_DEVICE_TYPES) byType[t] = all.filter(d => d.type === t).length;
    const capabilitiesSummary = {};
    for (const d of all) {
      for (const s of (d.capabilities.supports || [])) capabilitiesSummary[s] = (capabilitiesSummary[s] || 0) + 1;
    }
    return {
      ok: true,
      ecosystem: {
        total: all.length,
        online: online.length,
        offline: all.length - online.length,
        byType,
        devices: all.map(d => ({ id: d.id, name: d.name, type: d.type, online: this.isOnline(d.id).online, capabilities: d.capabilities, status: d.status })),
        capabilitiesSummary,
        timestamp: nowIso(),
      },
      devices: all.map(d => ({ ...d })),
    };
  }

  // ------------------------- §27 Intelligent Device Selection -------------------------
  /**
   * Auto-select execution device based on task hints.
   * @param {string|object} taskOrMission - mission string or { mission, type, heavy, gpu, quick, service, priority, estimatedDuration }
   * @param {object} opts - { manualDevice, targetDevice, device, prefer, requireOnline=true, excludeBusy=false }
   * @returns {{ ok:boolean, device:object|null, reason:string, alternatives:Array, manualOverride:boolean, hint:object }}
   */
  selectDevice(taskOrMission, opts = {}) {
    const { hint, mission, lower } = inferHints(taskOrMission);
    const manualId = opts.manualDevice || opts.targetDevice || opts.device || opts.overrideDevice || null;
    let manualOverride = false;
    let selected = null;
    let reason = '';

    // Manual override — §27 Allow manual override
    if (manualId) {
      manualOverride = true;
      const lookup = this.getDevice(manualId);
      if (!lookup.ok) {
        // try by type
        const byType = [...this.devices.values()].find(d => d.type === resolveDeviceType(manualId));
        if (byType) {
          selected = byType;
          reason = `manual override: matched type ${manualId} -> ${byType.id} (${byType.type})`;
        } else {
          return { ok: false, error: `Manual device not found: ${manualId}`, manualOverride: true, hint, mission };
        }
      } else {
        selected = lookup.device;
        reason = `manual override: user selected ${selected.id} (${selected.type})`;
      }
      // Verify online unless allowOffline
      if (selected && opts.requireOnline !== false) {
        const onlineCheck = this.isOnline(selected.id);
        if (!onlineCheck.online) {
          if (opts.allowOffline) {
            reason += ` [warning: device offline lastSeen ${onlineCheck.lastSeen}]`;
          } else {
            return { ok: false, error: `Manual device ${selected.id} is offline`, device: { ...selected }, manualOverride: true, reason: reason + ` but offline`, hint };
          }
        }
      }
      const alternatives = this._rankDevices(hint, selected.id).slice(0, 3);
      this._recordSelection({ mission, hint, selected, reason, manualOverride, alternatives });
      this._emit('device:selected', { mission, hint, deviceId: selected.id, type: selected.type, reason, manualOverride });
      return { ok: true, device: { ...selected }, reason, alternatives, manualOverride, hint, mission };
    }

    // Auto selection — score each online device
    const ranked = this._rankDevices(hint, null);
    if (!ranked.length) {
      // no online devices? try any device
      const anyRanked = this._rankDevices(hint, null, { includeOffline: true });
      if (!anyRanked.length) return { ok: false, error: 'No devices registered', hint, mission };
      selected = anyRanked[0].device;
      reason = `no online devices — selected offline ${selected.type} as fallback (${anyRanked[0].score})`;
      const alternatives = anyRanked.slice(1, 4).map(r => ({ id: r.device.id, type: r.device.type, score: r.score }));
      this._recordSelection({ mission, hint, selected, reason, manualOverride, alternatives });
      return { ok: true, device: { ...selected }, reason, alternatives, manualOverride, hint, mission, offlineFallback: true };
    }
    selected = ranked[0].device;
    const score = ranked[0].score;
    // Build human reason per §27 examples
    if (hint.service) reason = `24/7 service -> Server (${selected.type}) score=${score}`;
    else if (hint.gpu) reason = `GPU task -> GPU-enabled ${selected.type} (${selected.capabilities.gpu ? 'gpu:true' : 'fallback'}) score=${score}`;
    else if (hint.heavy || hint.build) reason = `Large/heavy build -> Powerful ${selected.type} (cores=${selected.capabilities.cpuCores} ram=${selected.capabilities.ramGB}GB) score=${score}`;
    else if (hint.quick) reason = `Quick action -> ${selected.type} (low latency) score=${score}`;
    else reason = `Auto-selected ${selected.type} score=${score} for "${mission.slice(0,60)}"`;
    const alternatives = ranked.slice(1, 4).map(r => ({ id: r.device.id, type: r.device.type, score: r.score, name: r.device.name }));

    this._recordSelection({ mission, hint, selected, reason, manualOverride, alternatives });
    this._emit('device:selected', { mission, hint, deviceId: selected.id, type: selected.type, reason, manualOverride, score });
    return { ok: true, device: { ...selected }, reason, alternatives, manualOverride, hint, mission, score };
  }

  _rankDevices(hint, excludeId, opts = {}) {
    const includeOffline = !!opts.includeOffline;
    const excludeBusy = !!opts.excludeBusy;
    let pool = [...this.devices.values()];
    if (!includeOffline) pool = pool.filter(d => this.isOnline(d.id).online);
    if (excludeBusy) pool = pool.filter(d => d.status !== DeviceStatus.BUSY);
    if (excludeId) pool = pool.filter(d => d.id !== excludeId);
    if (!pool.length) return [];
    const scored = pool.map(d => ({ device: d, score: this._scoreDevice(d, hint) }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  _scoreDevice(device, hint) {
    let score = 0;
    const caps = device.capabilities;
    const res = device.resources;
    const online = this.isOnline(device.id).online;
    if (!online) score -= 50;
    // Base: cpu + ram
    score += (caps.cpuCores || 4) * 2;
    score += (caps.ramGB || 8) * 1.5;
    if (caps.storageGB) score += Math.min(caps.storageGB / 100, 5);
    // Type biases per hint — §27 examples must dominate base resource weighting
    if (hint.heavy || hint.build) {
      // Large build -> Powerful PC (explicit §27). Must outrank server even if server has higher RAM/cores
      if (device.type === DeviceType.WINDOWS_PC) score += 80;
      else if (device.type === DeviceType.LAPTOP) score += 45;
      else if (device.type === DeviceType.SERVER) score -= 10;
      else if (device.type === DeviceType.ANDROID) score -= 50;
    }
    if (hint.quick) {
      // Quick action -> Phone (§27). Must outrank PC/server despite their higher specs — quick is latency/mobility
      if (device.type === DeviceType.ANDROID) score += 85;
      else if (device.type === DeviceType.LAPTOP) score += 15;
      else if (device.type === DeviceType.WINDOWS_PC) score += 5;
      else if (device.type === DeviceType.SERVER) score -= 35;
      // quick prefers online + not busy + battery if mobile
      if (device.type === DeviceType.ANDROID && online) score += 10;
    }
    if (hint.service) {
      if (device.type === DeviceType.SERVER) score += 35;
      else if (device.type === DeviceType.WINDOWS_PC) score += 10; // pc can be 24/7 if desktop
      else if (device.type === DeviceType.ANDROID) score -= 30;
      // prefer not battery, not mobile
      if (!caps.battery) score += 5;
      if (caps.network === 'ethernet') score += 5;
    }
    if (hint.gpu) {
      if (caps.gpu) score += 40;
      else score -= 100; // hard penalty: non-GPU can't do GPU task (but not filter outright — fallback)
    }
    // Resource awareness §26: prefer lower cpu/battery not low
    if (res.cpuUsage !== null && res.cpuUsage !== undefined) {
      if (res.cpuUsage > 85) score -= 15; // high CPU -> avoid
      else if (res.cpuUsage < 50) score += 5;
    }
    if (res.memUsedPercent !== null && res.memUsedPercent > 85) score -= 10;
    if (res.battery !== null && res.battery !== undefined) {
      if (res.battery < 20 && res.charging === false) score -= 20;
      if (res.battery < 10) score -= 30;
    }
    if (res.storageFreeGB !== null && res.storageFreeGB < 5) score -= 10;
    // Status
    if (device.status === DeviceStatus.BUSY) score -= 10;
    if (device.status === DeviceStatus.IDLE) score += 3;
    // Supports hint
    if (hint.type && caps.supports) {
      if (caps.supports.includes(hint.type) || caps.supports.includes(hint.type + ' task')) score += 5;
    }
    return Math.round(score * 10) / 10;
  }

  _recordSelection(entry) {
    this.selectionHistory.push({ ts: nowIso(), mission: entry.mission?.slice(0,200) || '', hint: entry.hint, deviceId: entry.selected?.id || null, type: entry.selected?.type || null, reason: entry.reason, manualOverride: entry.manualOverride });
    if (this.selectionHistory.length > 100) this.selectionHistory = this.selectionHistory.slice(-100);
  }

  getSelectionHistory(limit = 20) {
    const out = [...this.selectionHistory].reverse().slice(0, limit);
    return { ok: true, history: out, total: this.selectionHistory.length };
  }

  // ------------------------- §29 Cross-Device Task Continuity -------------------------
  /**
   * Continue/transfer task to another device.
   * §29: locate PC, verify available, transfer context, execute, report back.
   * @param {object} task - { id, mission, checkpoints, device, status } or taskId string
   * @param {string} targetDeviceId - e.g., 'windows_pc' or device id
   * @param {object} opts - { fromDeviceId, context, requesterDeviceId }
   */
  async transferTask(task, targetDeviceId, opts = {}) {
    let taskObj = task;
    if (typeof task === 'string') {
      // lookup from transfers or create stub
      const t = this.transfers.get(task);
      taskObj = t ? t.task : { id: task, mission: String(task) };
    }
    if (!taskObj || !taskObj.id) return { ok: false, error: 'task with id required' };
    const targetLookup = this.getDevice(targetDeviceId);
    let target = null;
    let targetReason = '';
    if (!targetLookup.ok) {
      // try auto-select if target not found but is a type hint like "pc"
      const sel = this.selectDevice(taskObj.mission || taskObj.id, { manualDevice: targetDeviceId, requireOnline: true });
      if (!sel.ok) return { ok: false, error: `Target device not found: ${targetDeviceId}`, detail: sel.error };
      target = sel.device;
      targetReason = sel.reason;
    } else {
      target = targetLookup.device;
      const onlineCheck = this.isOnline(target.id);
      if (!onlineCheck.online) return { ok: false, error: `Target device ${target.id} is offline`, lastSeen: onlineCheck.lastSeen, target };
    }
    const fromId = opts.fromDeviceId || taskObj.device || taskObj.deviceId || 'unknown';
    let fromDevice = null;
    if (fromId && fromId !== 'unknown') {
      const fromLookup = this.getDevice(fromId);
      if (fromLookup.ok) fromDevice = fromLookup.device;
    }
    // Record transfer for durability
    const transferId = genId('xfer');
    const record = {
      transferId,
      taskId: String(taskObj.id),
      task: { ...taskObj },
      fromDeviceId: fromDevice ? fromDevice.id : String(fromId),
      fromDeviceType: fromDevice ? fromDevice.type : String(fromId),
      toDeviceId: target.id,
      toDeviceType: target.type,
      requesterDeviceId: opts.requesterDeviceId || fromId,
      requestedAt: nowIso(),
      status: 'transferred',
      context: opts.context || taskObj.checkpoints || null,
      reason: targetReason || `Transferred "${String(taskObj.mission || taskObj.id).slice(0,60)}" to ${target.type}`,
    };
    this.transfers.set(String(taskObj.id), record);
    // Update target device tasks
    if (!target.tasks) target.tasks = [];
    target.tasks.push(String(taskObj.id));
    target.currentTasks = target.tasks;
    target.status = DeviceStatus.BUSY;
    target.updatedAt = nowIso();
    this.devices.set(target.id, target);
    // If from device exists, remove task from it or mark moved
    if (fromDevice) {
      fromDevice.tasks = (fromDevice.tasks || []).filter(tid => String(tid) !== String(taskObj.id));
      fromDevice.currentTasks = fromDevice.tasks;
      fromDevice.updatedAt = nowIso();
      this.devices.set(fromDevice.id, fromDevice);
    }
    this.save();
    this._emit('task:transferred', { taskId: taskObj.id, from: fromDevice?.id || fromId, to: target.id, transferId });
    this._emit('device:changed', { deviceId: target.id, change: 'task_transferred', taskId: taskObj.id });
    this._emit('task:continuity', { taskId: taskObj.id, from: fromDevice?.id || fromId, to: target.id, reason: record.reason });
    this._audit({ agent: 'DeviceManager', task: taskObj.id, tool: 'transferTask', action: 'transferTask', result: `Task ${taskObj.id} transferred to ${target.id}`, device: target.id });
    return { ok: true, transfer: record, target: { ...target }, from: fromDevice ? { ...fromDevice } : null };
  }

  /**
   * Convenience: "Continue the build on my PC." — resolves target via hint and transfers.
   * @param {string|object} taskOrMission
   * @param {string} targetHint - e.g., "pc", "my pc", "windows", "server"
   */
  async continueOnDevice(taskOrMission, targetHint, opts = {}) {
    const task = typeof taskOrMission === 'string' ? { id: genId('task'), mission: taskOrMission, device: opts.fromDeviceId || 'android' } : { id: taskOrMission.id || genId('task'), mission: taskOrMission.mission || String(taskOrMission), ...taskOrMission };
    // Resolve target device via selection (manual override if hint is explicit)
    let targetId = targetHint;
    // Normalize hints like "my pc" -> "pc"
    const normHint = String(targetHint || '').toLowerCase().trim();
    let resolvedType = null;
    if (/pc|windows|desktop/.test(normHint)) resolvedType = DeviceType.WINDOWS_PC;
    else if (/laptop|macbook/.test(normHint)) resolvedType = DeviceType.LAPTOP;
    else if (/server|cloud/.test(normHint)) resolvedType = DeviceType.SERVER;
    else if (/phone|android|mobile/.test(normHint)) resolvedType = DeviceType.ANDROID;
    if (resolvedType) {
      // Find online device of that type
      const candidates = [...this.devices.values()].filter(d => d.type === resolvedType && this.isOnline(d.id).online);
      if (candidates.length) targetId = candidates[0].id;
      else {
        // fallback to type string for manual lookup
        targetId = resolvedType;
      }
    }
    return this.transferTask(task, targetId, { ...opts, requesterDeviceId: opts.requesterDeviceId || task.device });
  }

  // ------------------------- §28 Android Companion helpers -------------------------
  /**
   * Get Android companion status — remote targets the phone can control.
   * @param {string} androidDeviceId
   */
  getRemoteControlTargets(androidDeviceId) {
    const androidRes = this.getDevice(androidDeviceId);
    if (!androidRes.ok) return { ok: false, error: `Android device not found: ${androidDeviceId}` };
    if (androidRes.device.type !== DeviceType.ANDROID) return { ok: false, error: `Device ${androidDeviceId} is not Android, type=${androidRes.device.type}` };
    const controllable = [...this.devices.values()].filter(d => d.id !== androidRes.device.id && this.isOnline(d.id).online).map(d => ({ id: d.id, name: d.name, type: d.type, status: d.status, capabilities: d.capabilities, resources: { online: d.online, status: d.status, lastSeen: d.resources.lastSeen } }));
    return { ok: true, android: { ...androidRes.device }, targets: controllable, count: controllable.length };
  }

  requestRemoteControl(requesterId, targetId, action = 'control') {
    const reqRes = this.getDevice(requesterId);
    if (!reqRes.ok) return { ok: false, error: `Requester not found: ${requesterId}` };
    const tgtRes = this.getDevice(targetId);
    if (!tgtRes.ok) return { ok: false, error: `Target not found: ${targetId}` };
    const onlineCheck = this.isOnline(tgtRes.device.id);
    if (!onlineCheck.online) return { ok: false, error: `Target ${targetId} offline`, lastSeen: onlineCheck.lastSeen };
    // Policy check if available (§34)
    if (this.policyEngine && typeof this.policyEngine.assess === 'function') {
      // best-effort: remote control is at least NORMAL, maybe DANGEROUS if power action
      // For now just audit; real policy gate is in orchestrator
    }
    const req = { id: genId('rc'), requesterId: reqRes.device.id, requesterType: reqRes.device.type, targetId: tgtRes.device.id, targetType: tgtRes.device.type, action: String(action).slice(0,200), requestedAt: nowIso(), status: 'pending' };
    this._emit('device:remote:requested', req);
    this._audit({ agent: 'DeviceManager', task: null, tool: 'requestRemoteControl', action: 'requestRemoteControl', result: `${reqRes.device.id} -> ${tgtRes.device.id}: ${action}`, device: tgtRes.device.id });
    return { ok: true, request: req };
  }

  // Task assignment helpers — §26 current task state per device
  assignTask(deviceId, taskId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    const d = res.device;
    if (!d.tasks) d.tasks = [];
    if (!d.tasks.includes(String(taskId))) d.tasks.push(String(taskId));
    d.currentTasks = d.tasks;
    d.status = DeviceStatus.BUSY;
    d.updatedAt = nowIso();
    this.devices.set(d.id, d);
    this.save();
    this._emit('device:task:assigned', { deviceId: d.id, taskId: String(taskId) });
    return { ok: true, device: { ...d } };
  }
  completeTask(deviceId, taskId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    const d = res.device;
    d.tasks = (d.tasks || []).filter(t => String(t) !== String(taskId));
    d.currentTasks = d.tasks;
    if (d.tasks.length === 0) d.status = DeviceStatus.IDLE;
    d.updatedAt = nowIso();
    this.devices.set(d.id, d);
    this.save();
    this._emit('device:task:completed', { deviceId: d.id, taskId: String(taskId) });
    return { ok: true, device: { ...d } };
  }

  // ------------------------- inspection -------------------------
  getStats() {
    const all = [...this.devices.values()];
    const online = all.filter(d => this.isOnline(d.id).online);
    return {
      ok: true,
      total: all.length,
      online: online.length,
      offline: all.length - online.length,
      byType: Object.fromEntries(ALL_DEVICE_TYPES.map(t => [t, all.filter(d => d.type === t).length])),
      file: this.filePath,
      version: this.version,
      transfers: this.transfers.size,
      selectionHistory: this.selectionHistory.length,
    };
  }

  clear() {
    const count = this.devices.size;
    this.devices.clear();
    this.transfers.clear();
    this.selectionHistory = [];
    this.save();
    return { ok: true, cleared: count };
  }

  // Alias per §29 example
  locateDevice(hint) {
    if (!hint) return { ok: false, error: 'hint required' };
    const q = String(hint).toLowerCase();
    // try exact id, name, type
    for (const d of this.devices.values()) {
      if (d.id.toLowerCase() === q || d.name.toLowerCase() === q || d.type === resolveDeviceType(q)) return { ok: true, device: { ...d } };
    }
    // substring match
    const lowerHint = q;
    for (const d of this.devices.values()) {
      if (d.name.toLowerCase().includes(lowerHint) || d.type.includes(lowerHint) || d.id.toLowerCase().includes(lowerHint)) return { ok: true, device: { ...d } };
    }
    // try alias resolution
    const t = resolveDeviceType(q);
    const byType = [...this.devices.values()].filter(d => d.type === t && this.isOnline(d.id).online);
    if (byType.length) return { ok: true, device: { ...byType[0] } };
    return { ok: false, error: `No device matches hint: ${hint}` };
  }

  verifyDeviceAvailable(deviceId) {
    const res = this.getDevice(deviceId);
    if (!res.ok) return res;
    const online = this.isOnline(res.device.id);
    return { ok: online.online, device: { ...res.device }, online: online.online, lastSeen: online.lastSeen, ageMs: online.ageMs, reason: online.online ? 'available' : `offline age ${Math.floor(online.ageMs/1000)}s` };
  }
}

// Default singleton for app / orchestrator
export const deviceManager = new DeviceManager();

export function getDefaultDevicesPathFn() { return getDefaultDevicesPath(); }

export default DeviceManager;
