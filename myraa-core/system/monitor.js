// Myraa System Monitoring & Power Management — MASTER BUILD PROMPT §44, §45, §10
// Implements: CPU, Memory, GPU, Storage, Network, Battery, Processes, Devices, Application state, Build status (§44)
// Power Management (§45): battery awareness, charging awareness, resource throttling, background-task adaptation,
// sleep/wake awareness, authorized shutdown/restart, power-aware scheduling.
// Use this information to make intelligent execution decisions (§44).
// Local-first, event-driven (§50), configurable intervals, caching, graceful degradation.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nowIso() { return new Date().toISOString(); }
function genId() { return Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36); }

function execPsEncoded(script, opts = {}) {
  const timeout = opts.timeout || 3000;
  try {
    // PowerShell -EncodedCommand requires UTF16-LE base64
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    const out = execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { encoding: 'utf8', timeout, maxBuffer: 500 * 1024, windowsHide: true });
    return out;
  } catch (e) {
    // fallback to direct execSync with shell escaping (rare)
    throw e;
  }
}

// CPU usage calc: sample cpus times, diff after interval
let _prevCpuSnapshot = null;
let _prevCpuTime = 0;
function snapshotCpu() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length, cpus };
}

function toGB(bytes) { return Math.round((bytes / (1024 ** 3)) * 10) / 10; }

// ---------------------------------------------------------------------------
// SystemMonitor — §44 + §45
// ---------------------------------------------------------------------------
export class SystemMonitor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.eventBus - optional external EventEmitter
   * @param {object} opts.policyEngine - optional policy engine for authorized power actions §36
   * @param {object} opts.logger
   * @param {number} opts.intervalMs - monitoring interval (default 15000)
   * @param {object} opts.thresholds - { cpuHigh, memHigh, diskLowGB, batteryLow }
   */
  constructor({ eventBus = null, policyEngine = null, logger = console, intervalMs = 15000, thresholds = {} } = {}) {
    super();
    this.eventBus = eventBus;
    this.policyEngine = policyEngine;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.thresholds = {
      cpuHigh: thresholds.cpuHigh ?? 85, // %
      memHigh: thresholds.memHigh ?? 85, // %
      diskLowGB: thresholds.diskLowGB ?? 5, // GB free
      batteryLow: thresholds.batteryLow ?? 20, // %
      batteryCritical: thresholds.batteryCritical ?? 10,
      ...thresholds,
    };
    this._timer = null;
    this._globalBus = null;
    try { import('../eventBus.js').then(m => { this._globalBus = m; }).catch(() => {}); } catch {}
    this._lastSnapshot = null;
    this._powerHandlers = { sleep: new Set(), wake: new Set() };
    this._monitoring = false;
    // caches §10 event-driven sampling
    this._batteryCache = { value: null, ts: 0, ttlMs: 12000 };
    this._diskCache = { value: null, ts: 0, ttlMs: 10000 };
    this._cpuCache = { value: null, ts: 0 };
  }

  _emit(event, payload) {
    const data = { ts: nowIso(), event, ...payload };
    try { this.emit(event, data); } catch {}
    try { this.eventBus?.emit?.(event, data); } catch {}
    try { this._globalBus?.emit?.(event, data); } catch {}
    try { import('../eventBus.js').then(m => { try { m.emit(event, payload); } catch {} }).catch(() => {}); } catch {}
  }

  // ------------------------- §44 System Monitoring -------------------------
  getCpuUsage() {
    // §44 CPU + §10 Continuous Awareness: event-driven sampling, caching
    const now = Date.now();
    const snap = snapshotCpu();
    let usagePercent = null;
    if (_prevCpuSnapshot && (now - _prevCpuTime) > 100) {
      const idleDiff = snap.idle - _prevCpuSnapshot.idle;
      const totalDiff = snap.total - _prevCpuSnapshot.total;
      if (totalDiff > 0) usagePercent = Math.round((1 - idleDiff / totalDiff) * 100 * 10) / 10;
    }
    _prevCpuSnapshot = snap;
    _prevCpuTime = now;
    const cpus = snap.cpus;
    const sys = {
      count: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      speedMHz: cpus[0]?.speed || 0,
      usagePercent, // may be null on first call
      loadAvg: os.loadavg?.() || [],
      uptimeSec: Math.floor(os.uptime()),
    };
    // Fallback if usagePercent null: estimate via loadAvg (Linux) or return null
    if (usagePercent === null) {
      // Try to compute via second sample after short delay? For sync API, return 0-100 estimate
      // Use alternative: if Windows, try wmic load
      try {
        if (process.platform === 'win32') {
          const out = execSync('wmic cpu get loadPercentage /value', { encoding: 'utf8', timeout: 2000 });
          const m = out.match(/LoadPercentage=(\d+)/);
          if (m) sys.usagePercent = Number(m[1]);
        }
      } catch {}
    }
    return sys;
  }

  getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const proc = process.memoryUsage();
    return {
      totalBytes: total,
      freeBytes: free,
      usedBytes: used,
      totalGB: toGB(total),
      freeGB: toGB(free),
      usedGB: toGB(used),
      usedPercent: Math.round((used / total) * 100 * 10) / 10,
      freePercent: Math.round((free / total) * 100 * 10) / 10,
      process: {
        rssMB: Math.round(proc.rss / 1024 / 1024),
        heapUsedMB: Math.round(proc.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(proc.heapTotal / 1024 / 1024),
        externalMB: Math.round((proc.external || 0) / 1024 / 1024),
      },
    };
  }

  getDiskUsage(drive = null) {
    // §44 Storage — cached §10 event-driven sampling
    if (!drive && this._diskCache.value && (Date.now() - this._diskCache.ts) < this._diskCache.ttlMs) {
      return this._diskCache.value;
    }
    const result = { drives: [], totalGB: null, freeGB: null, usedPercent: null };
    try {
      if (process.platform === 'win32') {
        // Use PowerShell for more reliable JSON — via EncodedCommand to avoid quoting issues
        const ps = `Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json`;
        const out = execPsEncoded(ps, { timeout: 3000 });
        let data;
        try { data = JSON.parse(out); } catch { data = []; }
        const list = Array.isArray(data) ? data : [data];
        for (const d of list) {
          if (!d || !d.Name) continue;
          const used = Number(d.Used || 0);
          const free = Number(d.Free || 0);
          const total = used + free;
          result.drives.push({
            drive: `${d.Name}:`,
            totalBytes: total,
            freeBytes: free,
            usedBytes: used,
            totalGB: toGB(total),
            freeGB: toGB(free),
            usedPercent: total ? Math.round((used / total) * 100 * 10) / 10 : null,
          });
        }
        if (drive) {
          const filtered = result.drives.find(d => d.drive.toLowerCase() === String(drive).toLowerCase() || d.drive.toLowerCase().startsWith(String(drive).toLowerCase()));
          if (filtered) return filtered;
        }
        // aggregate C: as default
        const allFree = result.drives.reduce((a, b) => a + (b.freeBytes || 0), 0);
        const allTotal = result.drives.reduce((a, b) => a + (b.totalBytes || 0), 0);
        result.totalGB = toGB(allTotal);
        result.freeGB = toGB(allFree);
        result.usedPercent = allTotal ? Math.round(((allTotal - allFree) / allTotal) * 100 * 10) / 10 : null;
        if (!drive) { this._diskCache.value = result; this._diskCache.ts = Date.now(); }
        return result;
      } else {
        // Linux/macOS: use df -k
        const out = execSync('df -k /', { encoding: 'utf8', timeout: 2000 });
        const lines = out.trim().split('\n');
        for (const line of lines.slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            const totalKB = Number(parts[1]);
            const freeKB = Number(parts[3]);
            const total = totalKB * 1024;
            const free = freeKB * 1024;
            result.drives.push({
              drive: parts[0],
              mount: parts[5] || '/',
              totalBytes: total,
              freeBytes: free,
              usedBytes: total - free,
              totalGB: toGB(total),
              freeGB: toGB(free),
              usedPercent: total ? Math.round(((total - free) / total) * 100 * 10) / 10 : null,
            });
          }
        }
        if (result.drives[0]) {
          result.totalGB = result.drives[0].totalGB;
          result.freeGB = result.drives[0].freeGB;
          result.usedPercent = result.drives[0].usedPercent;
        }
        if (!drive) { const cacheVal = drive ? null : result; if (cacheVal) { this._diskCache.value = cacheVal; this._diskCache.ts = Date.now(); } }
        return drive ? (result.drives[0] || result) : result;
      }
    } catch (e) {
      // Fallback via fs.statfs if available (Node 19+)
      try {
        if (fs.statfsSync) {
          const stat = fs.statfsSync(drive || process.cwd());
          const total = stat.bsize * stat.blocks;
          const free = stat.bsize * stat.bfree;
          const totalGB = toGB(total);
          const freeGB = toGB(free);
          const usedPercent = total ? Math.round(((total - free) / total) * 100 * 10) / 10 : null;
          const single = { drive: drive || 'unknown', totalBytes: total, freeBytes: free, usedBytes: total - free, totalGB, freeGB, usedPercent };
          result.drives.push(single);
          result.totalGB = totalGB;
          result.freeGB = freeGB;
          result.usedPercent = usedPercent;
          return drive ? single : result;
        }
      } catch {}
      return { error: e.message, drives: [], totalGB: null, freeGB: null };
    }
  }

  getBatteryInfo() {
    // §44 Battery, §45 Battery awareness, Charging awareness — cached §10
    if (this._batteryCache.value && (Date.now() - this._batteryCache.ts) < this._batteryCache.ttlMs) {
      return this._batteryCache.value;
    }
    const cacheAndReturn = (val) => { this._batteryCache.value = val; this._batteryCache.ts = Date.now(); return val; };
    try {
      if (process.platform === 'win32') {
        // Try Get-CimInstance Win32_Battery (returns null on desktop) — via EncodedCommand to avoid quoting issues
        const ps = `Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime,DesignCapacity | ConvertTo-Json -Compress`;
        let out = '';
        try { out = execPsEncoded(ps, { timeout: 3000 }); } catch {}
        let data = null;
        try { data = JSON.parse(out.trim() || 'null'); } catch { data = null; }
        if (data && (Array.isArray(data) ? data.length > 0 : data.EstimatedChargeRemaining !== undefined)) {
          const bat = Array.isArray(data) ? data[0] : data;
          const level = bat.EstimatedChargeRemaining !== undefined ? Number(bat.EstimatedChargeRemaining) : null;
          // BatteryStatus: 1=discharging, 2=AC, 3=fully charged, 6=charging, etc.
          const status = Number(bat.BatteryStatus);
          const charging = status === 2 || status === 6 || status === 7 || status === 8;
          // Also check Win32_Battery PowerOnline via GetSystemPowerStatus API via EncodedCommand
          let powerOnline = null;
          try {
            const ps2 = `Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s); [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime; } public static SYSTEM_POWER_STATUS GetStatus(){ SYSTEM_POWER_STATUS s; GetSystemPowerStatus(out s); return s; }' -Name PowerStatus -Namespace Win32 -PassThru | Out-Null; $s=[Win32.PowerStatus]::GetStatus(); $s | Select-Object ACLineStatus,BatteryLifePercent,BatteryLifeTime | ConvertTo-Json -Compress`;
            const out2 = execPsEncoded(ps2, { timeout: 3000 });
            const s = JSON.parse(out2.trim() || '{}');
            if (s.ACLineStatus !== undefined) powerOnline = s.ACLineStatus === 1;
            if (s.BatteryLifePercent !== undefined && s.BatteryLifePercent !== 255) {
              // Prefer this more accurate
              const pLevel = Number(s.BatteryLifePercent);
              if (!Number.isNaN(pLevel) && pLevel >=0 && pLevel <=100) {
                return cacheAndReturn({
                  available: true,
                  level: pLevel,
                  charging: powerOnline ?? charging,
                  powerOnline,
                  status,
                  designCapacity: bat.DesignCapacity || null,
                  estimatedRunTime: bat.EstimatedRunTime ?? s.BatteryLifeTime ?? null,
                  source: 'GetSystemPowerStatus',
                });
              }
            }
          } catch {}
          return cacheAndReturn({
            available: true,
            level,
            charging,
            powerOnline,
            status,
            designCapacity: bat.DesignCapacity || null,
            estimatedRunTime: bat.EstimatedRunTime || null,
            source: 'Win32_Battery',
          });
        }
        // No battery found — check GetSystemPowerStatus for desktop battery flag 255 = no battery — via EncodedCommand
        try {
          const ps3 = `Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s); [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime; } public static SYSTEM_POWER_STATUS GetStatus(){ SYSTEM_POWER_STATUS s; GetSystemPowerStatus(out s); return s; }' -Name PowerStatus2 -Namespace Win32 -PassThru | Out-Null; $s=[Win32.PowerStatus2]::GetStatus(); $s | ConvertTo-Json -Compress`;
          const out3 = execPsEncoded(ps3, { timeout: 2000 });
          const s = JSON.parse(out3.trim() || '{}');
          if (s.BatteryFlag === 128 || s.BatteryLifePercent === 255) {
            return cacheAndReturn({ available: false, desktop: true, level: null, charging: null, reason: 'no battery (desktop)', raw: s });
          }
          if (s.BatteryLifePercent !== undefined && s.BatteryLifePercent !== 255) {
            return cacheAndReturn({ available: true, level: Number(s.BatteryLifePercent), charging: s.ACLineStatus === 1, powerOnline: s.ACLineStatus === 1, status: s.BatteryFlag, source: 'GetSystemPowerStatus-fallback' });
          }
        } catch {}
        return cacheAndReturn({ available: false, desktop: true, level: null, charging: null, reason: 'no battery detected' });
      } else if (process.platform === 'darwin') {
        try {
          const out = execSync('pmset -g batt', { encoding: 'utf8', timeout: 2000 });
          // e.g., " -InternalBattery-0 (id=... )  85%; charging; 2:12 remaining"
          const m = out.match(/(\d+)%.*;\s*(charging|discharging|charged|finishing charge)/i);
          if (m) {
            const level = Number(m[1]);
            const state = m[2].toLowerCase();
            const charging = state.includes('charging');
            return { available: true, level, charging, state, raw: out.trim().slice(0,200) };
          }
        } catch {}
        return { available: false, level: null, charging: null, reason: 'pmset failed' };
      } else {
        // Linux: /sys/class/power_supply
        try {
          const cap = fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim();
          const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim();
          const level = Number(cap);
          const charging = status.toLowerCase().includes('charging');
          return { available: true, level, charging, status, source: 'sysfs' };
        } catch {
          return { available: false, level: null, charging: null, reason: 'no BAT0' };
        }
      }
    } catch (e) {
      return { available: false, level: null, charging: null, error: e.message };
    }
  }

  getNetworkState() {
    const ifaces = os.networkInterfaces();
    const flat = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const a of addrs || []) flat.push({ name, address: a.address, family: a.family, internal: a.internal, mac: a.mac });
    }
    const hasExternal = flat.some(a => !a.internal && a.family === 'IPv4');
    return {
      interfaces: flat,
      hasNetwork: hasExternal,
      timestamp: nowIso(),
    };
  }

  async checkInternet({ timeout = 2500 } = {}) {
    if (process.env.MYRAA_OFFLINE === '1') return false;
    if (process.env.MYRAA_ONLINE === '1') return true;
    const urls = ['https://1.1.1.1/cdn-cgi/trace', 'https://www.google.com/generate_204'];
    for (const url of urls) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        clearTimeout(t);
        if (res && (res.ok || res.status === 204 || res.status === 200)) return true;
      } catch {}
    }
    try {
      const { lookup } = await import('dns/promises');
      await lookup('google.com');
      return true;
    } catch {}
    return false;
  }

  getProcessList(limit = 20) {
    try {
      if (process.platform === 'win32') {
        const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 4000 });
        const lines = out.trim().split('\n').slice(0, limit);
        const procs = lines.map(line => {
          // CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
          const parts = line.split('","').map(s => s.replace(/^"/,'').replace(/"$/,''));
          return { name: parts[0] || '', pid: Number(parts[1] || 0), session: parts[2] || '', mem: parts[4] || '' };
        }).filter(p => p.name);
        return { ok: true, count: procs.length, processes: procs };
      } else {
        const out = execSync('ps -eo pid,comm,pcpu,pmem --sort=-pcpu | head -n ' + (limit + 1), { encoding: 'utf8', timeout: 3000 });
        const lines = out.trim().split('\n').slice(1);
        const procs = lines.map(l => {
          const parts = l.trim().split(/\s+/);
          return { pid: Number(parts[0] || 0), name: parts[1] || '', cpu: parts[2] || '', mem: parts[3] || '' };
        });
        return { ok: true, count: procs.length, processes: procs };
      }
    } catch (e) {
      return { ok: false, error: e.message, processes: [] };
    }
  }

  getGpuInfo() {
    try {
      if (process.platform === 'win32') {
        const out = execSync('wmic path win32_VideoController get name,AdapterRAM,DriverVersion /format:list', { encoding: 'utf8', timeout: 3000 });
        const lines = out.trim().split('\n').filter(l => l.includes('='));
        const info = {};
        for (const line of lines) {
          const [k, v] = line.split('=');
          if (k && v) info[k.trim()] = v.trim();
        }
        return { ok: true, ...info, raw: out.slice(0, 500) };
      } else {
        // try lspci or nvidia-smi
        try {
          const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { encoding: 'utf8', timeout: 2000 });
          return { ok: true, gpu: out.trim(), source: 'nvidia-smi' };
        } catch {}
        return { ok: true, gpu: 'Unknown (no wmic/nvidia-smi)', source: 'fallback' };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  getAppState() {
    // §44 Application state, Build status
    const app = {
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      execPath: process.execPath,
      cwd: process.cwd(),
      env: process.env.NODE_ENV || 'unknown',
      timestamp: nowIso(),
    };
    // Build status: check if dist exists, last build time
    let build = { exists: false };
    try {
      const distPkg = path.resolve(process.cwd(), 'dist');
      const pkgJson = path.resolve(process.cwd(), 'package.json');
      if (fs.existsSync(distPkg)) {
        const stat = fs.statSync(distPkg);
        build.exists = true;
        build.mtime = stat.mtime.toISOString();
        build.path = distPkg;
      }
      if (fs.existsSync(pkgJson)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        build.version = pkg.version;
        build.name = pkg.name;
      }
    } catch {}
    // Check if Myraa is running as process
    let running = false;
    try {
      const procs = this.getProcessList(100);
      if (procs.processes) running = procs.processes.some(p => String(p.name).toLowerCase().includes('myraa'));
    } catch {}
    return { ...app, build, myraaProcessFound: running };
  }

  getSystemSnapshot() {
    const cpu = this.getCpuUsage();
    const memory = this.getMemoryUsage();
    const disk = this.getDiskUsage();
    const battery = this.getBatteryInfo();
    const network = this.getNetworkState();
    const gpu = this.getGpuInfo();
    const app = this.getAppState();
    const snapshot = {
      ts: nowIso(),
      cpu,
      memory,
      disk,
      battery,
      network,
      gpu,
      app,
      platform: os.platform(),
      hostname: os.hostname(),
    };
    this._lastSnapshot = snapshot;
    return snapshot;
  }

  // ------------------------- Power Management §45 -------------------------
  getPowerState() {
    const battery = this.getBatteryInfo();
    const snapshot = this._lastSnapshot;
    return {
      battery,
      charging: battery.charging ?? battery.powerOnline ?? null,
      level: battery.level ?? null,
      available: battery.available,
      desktop: battery.desktop || false,
      thresholds: { ...this.thresholds },
      snapshot,
      ts: nowIso(),
    };
  }

  isBatteryLow(threshold = null) {
    const bat = this.getBatteryInfo();
    if (!bat.available || bat.level === null) return false; // desktop or no battery
    const th = threshold ?? this.thresholds.batteryLow;
    return bat.level < th && bat.charging === false;
  }

  isBatteryCritical() {
    return this.isBatteryLow(this.thresholds.batteryCritical);
  }

  shouldThrottle() {
    // Resource throttling §45: if CPU>85% or Memory>85% or battery low → throttle
    const mem = this.getMemoryUsage();
    const cpu = this.getCpuUsage();
    const batteryLow = this.isBatteryLow();
    const cpuHigh = cpu.usagePercent !== null && cpu.usagePercent > this.thresholds.cpuHigh;
    const memHigh = mem.usedPercent > this.thresholds.memHigh;
    const diskLow = (() => {
      const disk = this.getDiskUsage();
      const free = disk.freeGB ?? (disk.drives?.[0]?.freeGB ?? null);
      return free !== null && free < this.thresholds.diskLowGB;
    })();
    const throttled = !!(cpuHigh || memHigh || batteryLow || diskLow);
    if (throttled) {
      this.logger.warn?.(`[Monitor] shouldThrottle=true cpuHigh=${cpuHigh} memHigh=${memHigh} batteryLow=${batteryLow} diskLow=${diskLow}`);
    }
    return throttled;
  }

  adaptBackgroundTasks(tasksOrCount = null) {
    // Background-task adaptation §45: reduce workload or defer
    const throttled = this.shouldThrottle();
    const battery = this.getBatteryInfo();
    let recommendation = 'normal';
    let maxConcurrency = null;
    if (battery.available && battery.level !== null && !battery.charging) {
      if (battery.level < this.thresholds.batteryCritical) {
        recommendation = 'defer_all_non_critical';
        maxConcurrency = 1;
      } else if (battery.level < this.thresholds.batteryLow) {
        recommendation = 'reduce_workload';
        maxConcurrency = 2;
      }
    }
    if (throttled && recommendation === 'normal') {
      recommendation = 'throttle';
      maxConcurrency = 3;
    }
    const detail = {
      throttled,
      battery,
      recommendation,
      maxConcurrency,
      reason: battery.available && battery.level < this.thresholds.batteryLow && !battery.charging
        ? `Battery ${battery.level}% not charging — ${recommendation}`
        : throttled ? 'CPU/Memory high — throttle' : 'normal',
    };
    this._emit('power:adaptation', detail);
    return detail;
  }

  powerAwareSchedule(task) {
    // Power-aware scheduling §45: decide to run now or defer
    const battery = this.getBatteryInfo();
    const isHeavy = task?.priority !== undefined ? task.priority > 5 : false;
    // Also consider task metadata heavy flag
    const heavy = isHeavy || task?.metadata?.heavy === true || String(task?.mission || '').toLowerCase().includes('build') || String(task?.mission || '').toLowerCase().includes('apk');
    if (!battery.available) return { shouldRun: true, reason: 'no battery (desktop)', deferred: false };
    if (battery.charging) return { shouldRun: true, reason: 'charging', deferred: false };
    if (battery.level !== null && battery.level < this.thresholds.batteryCritical) {
      return { shouldRun: false, deferred: true, reason: `battery critical ${battery.level}% — defer heavy=${heavy}`, recommendation: 'defer' };
    }
    if (battery.level !== null && battery.level < this.thresholds.batteryLow && heavy) {
      return { shouldRun: false, deferred: true, reason: `Battery ${battery.level}% low — defer heavy task`, recommendation: 'defer_heavy' };
    }
    return { shouldRun: true, deferred: false, reason: `battery ${battery.level}% ok` };
  }

  // Sleep/wake awareness §45
  onSleep(handler) {
    if (typeof handler === 'function') this._powerHandlers.sleep.add(handler);
    // Try to listen to Electron powerMonitor if available
    try {
      const { powerMonitor } = require('electron');
      if (powerMonitor) powerMonitor.on('suspend', handler);
    } catch {}
    return { ok: true };
  }

  onWake(handler) {
    if (typeof handler === 'function') this._powerHandlers.wake.add(handler);
    try {
      const { powerMonitor } = require('electron');
      if (powerMonitor) powerMonitor.on('resume', handler);
    } catch {}
    return { ok: true };
  }

  // Simulate sleep/wake for tests
  simulateSleep() {
    this._emit('power:suspend', { ts: nowIso(), reason: 'simulated suspend' });
    for (const h of this._powerHandlers.sleep) try { h({ ts: nowIso() }); } catch {}
  }

  simulateWake() {
    this._emit('power:resume', { ts: nowIso(), reason: 'simulated resume' });
    for (const h of this._powerHandlers.wake) try { h({ ts: nowIso() }); } catch {}
  }

  // Authorized shutdown/restart §45 — requires policy confirmation §36
  async requestPowerAction(action) {
    const act = String(action).toLowerCase();
    const allowedActions = ['shutdown', 'restart', 'sleep', 'lock'];
    if (!allowedActions.includes(act)) return { ok: false, error: `Invalid action: ${act}. Allowed: ${allowedActions.join(', ')}` };
    // Policy check: DANGEROUS requires confirmation §36
    if (this.policyEngine) {
      try {
        const assessment = await this.policyEngine.assess({ tool: 'requestPowerAction', args: { action: act }, context: {} });
        if (!assessment.allowed && assessment.needsConfirmation) {
          return { ok: false, error: `Power action '${act}' requires confirmation`, needsConfirmation: true, tier: assessment.tier };
        }
      } catch {}
    }
    // Delegate to computer handler if available
    try {
      const { requestPowerAction } = await import('../tools/computer.js');
      const res = requestPowerAction({ action: act });
      this._emit('power:requested', { action: act, token: res.token, ts: nowIso() });
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async executePowerAction(token, action) {
    // Gated execution: token required
    if (!token) return { ok: false, error: 'Power confirmation token required' };
    if (this.policyEngine) {
      try {
        const assessment = await this.policyEngine.assess({ tool: 'executePowerAction', args: { token, action }, context: { confirmed: true } });
        if (!assessment.allowed) return { ok: false, error: `Policy blocked power execute: ${assessment.reason}`, tier: assessment.tier };
      } catch {}
    }
    // Defer to computer handler unless disabled
    if (process.env.MYRAA_ALLOW_POWER_ACTIONS !== '1') {
      return { ok: true, dryRun: true, action, token, result: `[DRY-RUN] Power action '${action}' token ${token} validated — real execution disabled (set MYRAA_ALLOW_POWER_ACTIONS=1)` };
    }
    try {
      const { executePowerAction } = await import('../tools/computer.js');
      const res = executePowerAction({ token, action });
      this._emit('power:executed', { action, token, result: res.result, ts: nowIso() });
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ------------------------- monitoring loop §44, §50 -------------------------
  startMonitoring(intervalMs = null) {
    if (this._monitoring) return { ok: false, error: 'Already monitoring' };
    const ms = intervalMs || this.intervalMs;
    this._monitoring = true;
    this._timer = setInterval(async () => {
      try {
        const snap = this.getSystemSnapshot();
        this._emit('system:metrics', snap);
        // intelligent execution decisions: emit warnings
        if (snap.cpu.usagePercent !== null && snap.cpu.usagePercent > this.thresholds.cpuHigh) {
          this._emit('system:cpu:high', { usage: snap.cpu.usagePercent, threshold: this.thresholds.cpuHigh, ts: snap.ts });
        }
        if (snap.memory.usedPercent > this.thresholds.memHigh) {
          this._emit('system:memory:high', { usedPercent: snap.memory.usedPercent, threshold: this.thresholds.memHigh, ts: snap.ts });
        }
        const freeGB = snap.disk.freeGB ?? snap.disk.drives?.[0]?.freeGB ?? null;
        if (freeGB !== null && freeGB < this.thresholds.diskLowGB) {
          this._emit('system:disk:low', { freeGB, threshold: this.thresholds.diskLowGB, ts: snap.ts });
        }
        if (snap.battery.available && snap.battery.level !== null) {
          if (snap.battery.level < this.thresholds.batteryCritical) {
            this._emit('system:battery:critical', { level: snap.battery.level, charging: snap.battery.charging, ts: snap.ts });
          } else if (snap.battery.level < this.thresholds.batteryLow) {
            this._emit('system:battery:low', { level: snap.battery.level, charging: snap.battery.charging, ts: snap.ts });
          }
        }
        // Power adaptation event
        const adaptation = this.adaptBackgroundTasks();
        if (adaptation.recommendation !== 'normal') {
          this._emit('power:throttled', adaptation);
        }
        // Check internet
        const online = await this.checkInternet({ timeout: 1500 }).catch(() => null);
        if (online !== null) this._emit('device:changed', { online, ts: snap.ts });
      } catch (e) {
        this.logger.warn?.(`[Monitor] tick error: ${e.message}`);
      }
    }, ms);
    if (this._timer.unref) this._timer.unref();
    this._emit('system:monitoring:started', { intervalMs: ms, thresholds: this.thresholds });
    return { ok: true, intervalMs: ms };
  }

  stopMonitoring() {
    if (!this._monitoring) return { ok: false, error: 'Not monitoring' };
    clearInterval(this._timer);
    this._timer = null;
    this._monitoring = false;
    this._emit('system:monitoring:stopped', { ts: nowIso() });
    return { ok: true };
  }

  isMonitoring() { return this._monitoring; }

  getThresholds() { return { ...this.thresholds }; }
  setThresholds(next) {
    this.thresholds = { ...this.thresholds, ...next };
    return { ok: true, thresholds: { ...this.thresholds } };
  }

  getStats() {
    return {
      ok: true,
      monitoring: this._monitoring,
      intervalMs: this.intervalMs,
      thresholds: { ...this.thresholds },
      lastSnapshot: this._lastSnapshot ? { ts: this._lastSnapshot.ts } : null,
      platform: os.platform(),
      arch: os.arch(),
    };
  }

  destroy() {
    try { this.stopMonitoring(); } catch {}
    this.removeAllListeners();
    this._powerHandlers.sleep.clear();
    this._powerHandlers.wake.clear();
  }
}

// Default singleton for app
export const systemMonitor = new SystemMonitor();

export default SystemMonitor;
